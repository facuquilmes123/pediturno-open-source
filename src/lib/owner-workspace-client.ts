import { auth } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import type { Appointment, BusinessProfile } from '@/services/data';
type RevisionListener = { next: (revision:string)=>void; error:(error:Error)=>void };
type Channel = { owner:User; listeners:Set<RevisionListener>; last?:string; controller?:AbortController; timer?:ReturnType<typeof setTimeout>; stopped:boolean; failures:number; connect:()=>void; stop:()=>void };
const channels = new Map<string,Channel>();
function verify(owner:User,ownerId:string){if(owner.uid!==ownerId||auth?.currentUser!==owner)throw new Error('Tu sesión cambió. Volvé a cargar tus datos.');}
class OwnerReadError extends Error { constructor(readonly status:number,readonly code:string){super(status===401?'Tu sesión venció. Volvé a ingresar.':'No se pudieron actualizar tus datos. Volvé a intentar.');} }
export async function ownerWorkspaceRead(path:string,ownerId:string,signal?:AbortSignal):Promise<Response>{
 const owner=auth?.currentUser;if(!owner)throw new Error('Iniciá sesión para cargar tus datos.');verify(owner,ownerId);
 let retries=0,waited=0;
 for(;;){
  verify(owner,ownerId);const token=await owner.getIdToken();verify(owner,ownerId);
  const response=await fetch(path,{cache:'no-store',headers:{Authorization:'Bearer '+token},signal});verify(owner,ownerId);
  if(response.status===429){const value=response.headers.get('Retry-After');await response.body?.cancel();if(!value||!/^\d+$/.test(value))throw new OwnerReadError(429,'READ_LIMIT');const delay=Math.max(1,Number(value));if(retries>=2||waited+delay>60)throw new OwnerReadError(429,'READ_LIMIT');retries++;waited+=delay;await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},delay*1000);if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});});continue;}
  if(!response.ok){const data=await response.json().catch(()=>({}));verify(owner,ownerId);throw new OwnerReadError(response.status,typeof data.code==='string'?data.code:'READ_FAILED');}
  return response;
 }
}
const profileReads=new Map<string,{owner:User;promise:Promise<BusinessProfile|null>}>();
export async function readOwnerProfile(ownerId:string,revisionHint=''):Promise<BusinessProfile|null>{
 const owner=auth?.currentUser;if(!owner)throw new Error('Iniciá sesión para cargar tus datos.');verify(owner,ownerId);
 const key=ownerId+':'+revisionHint,existing=profileReads.get(key);if(existing?.owner===owner)return existing.promise;
 const promise=(async()=>{
  const response=await ownerWorkspaceRead('/api/owner/profile',ownerId),data=await response.json();verify(owner,ownerId);
  if(data.profile===null)return null;
  const profile=data.profile;if(!profile||profile.id!==ownerId||typeof profile.name!=='string')throw new Error('Perfil inválido.');
  const restore=(value:unknown)=>{if(value===null||value===undefined)return value;if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('Fecha de perfil inválida.');return new Date(value);};
  for(const field of ['createdAt','lastModified'])if(field in profile)profile[field]=restore(profile[field]);
  for(const field of ['membership','googlePlayMembership'])if(profile[field])for(const date of ['startsAt','expiresAt'])if(date in profile[field])profile[field][date]=restore(profile[field][date]);
  if(profile.mercadopago&&'connectedAt' in profile.mercadopago)profile.mercadopago.connectedAt=restore(profile.mercadopago.connectedAt);
  return profile as BusinessProfile;
 })();profileReads.set(key,{owner,promise});try{return await promise;}finally{if(profileReads.get(key)?.promise===promise)profileReads.delete(key);}
}
export async function readOwnerAppointments(ownerId:string,watchMode=false):Promise<Appointment[]>{
 const owner=auth?.currentUser;if(!owner)throw new Error('Iniciá sesión para cargar la agenda.');verify(owner,ownerId);
 for(let restart=0;restart<2;restart++){
  const rows:Appointment[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null,revision:number|undefined;
  try{do{
   const url='/api/owner/agenda?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):'')+(revision===undefined?'':'&revision='+revision);
   const response=await ownerWorkspaceRead(url,ownerId),page=await response.json();verify(owner,ownerId);
   if(!Array.isArray(page.appointments)||page.appointments.length>100||!Number.isSafeInteger(page.revision)||page.revision<0||revision!==undefined&&revision!==page.revision||!(page.nextCursor===null||typeof page.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(page.nextCursor)))throw new Error('Respuesta de agenda inválida.');
   revision=page.revision;
   for(const row of page.appointments){
    if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(row.id)||ids.has(row.id)||row.businessId!==ownerId)throw new Error('Respuesta de agenda inválida.');ids.add(row.id);
    const restore=(v:unknown)=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw new Error('Fecha de agenda inválida.');return new Date(v);};
    if(row.date===null&&!watchMode)continue;
    const item={...row,date:row.date===null?new Date():restore(row.date)};
    for(const field of ['occupiedStartAt','occupiedEndAt'])if(row[field]!==undefined&&row[field]!==null)item[field]=restore(row[field]);
    rows.push(item);
   }
   cursor=page.nextCursor;if(cursor){if(!page.appointments.length||cursors.has(cursor))throw new Error('Paginación de agenda inválida.');cursors.add(cursor);}
  }while(cursor);verify(owner,ownerId);return watchMode?rows:rows.sort((a,b)=>b.date.getTime()-a.date.getTime()||(a.id!<b.id!?1:a.id===b.id?0:-1));
  }catch(error){if(error instanceof OwnerReadError&&error.status===409&&error.code==='AGENDA_CHANGED'&&restart===0)continue;throw error;}
 }
 throw new Error('La agenda cambió. Volvé a cargarla.');
}
export function subscribeOwnerWorkspace(ownerId:string,listener:RevisionListener):()=>void{
 const owner=auth?.currentUser;if(!owner)throw new Error('Iniciá sesión para actualizar tus datos.');verify(owner,ownerId);
 let entry=channels.get(ownerId);if(entry?.owner!==owner){entry?.stop();entry=undefined;}
 if(!entry){
  const current:Channel={owner,listeners:new Set(),stopped:false,failures:0,connect:()=>{},stop:()=>{}};entry=current;channels.set(ownerId,current);
  const suspend=()=>{current.controller?.abort();if(current.timer)clearTimeout(current.timer);current.timer=undefined;};
  current.stop=()=>{if(current.stopped)return;current.stopped=true;suspend();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',focus);if(channels.get(ownerId)===current)channels.delete(ownerId);};
  const visible=()=>document.visibilityState!=='hidden';
  const schedule=()=>{if(auth?.currentUser!==owner){current.stop();return;}if(current.stopped||!visible())return;const delay=Math.min(30000,1000*2**Math.min(current.failures,5));current.timer=setTimeout(current.connect,delay);};
  current.connect=()=>{if(current.stopped||!visible()||current.controller&&!current.controller.signal.aborted)return;const controller=new AbortController();current.controller=controller;
   void(async()=>{let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{verify(owner,ownerId);const token=await owner.getIdToken();verify(owner,ownerId);const response=await fetch('/api/owner/workspace-events',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal});verify(owner,ownerId);
     if(!response.ok||!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)throw new Error('No se pudieron actualizar tus datos.');
     reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',received=false;
     while(!controller.signal.aborted){const chunk=await reader.read();verify(owner,ownerId);if(current.stopped||controller.signal.aborted)break;if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r/g,'');if(buffer.length>65536)throw new Error('Aviso de actualización inválido.');let split:number;
      while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);const data=frame.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');if(!data)continue;const event=JSON.parse(data);if(typeof event.revision!=='string'||!/^[a-f0-9]{64}$/.test(event.revision))throw new Error('Aviso de actualización inválido.');received=true;current.last=event.revision;current.failures=0;for(const target of [...current.listeners])target.next(event.revision);}
     }
    if(!received&&!controller.signal.aborted)throw new Error('No se recibieron avisos de actualización.');
    }catch(error){if(!controller.signal.aborted&&!current.stopped){current.failures++;for(const target of [...current.listeners])target.error(error instanceof Error?error:new Error('Actualización no disponible.'));}}
    finally{await reader?.cancel().catch(()=>{});if(current.controller===controller){current.controller=undefined;schedule();}}
   })();
  };
  function visibility(){if(visible())current.connect();else suspend();}
  function focus(){if(visible())current.connect();}
  document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',focus);
 }
 const current=entry;current.listeners.add(listener);if(current.last)queueMicrotask(()=>{if(current.listeners.has(listener)&&!current.stopped)listener.next(current.last!);});current.connect();
 return()=>{current.listeners.delete(listener);if(!current.listeners.size)current.stop();};
}
export function subscribeOwnerProfile(ownerId:string,next:(profile:BusinessProfile|null)=>void,onError:(error:Error)=>void=()=>{}){
 let active=true,sequence=0;
 const stop=subscribeOwnerWorkspace(ownerId,{next:revision=>{const version=++sequence;void readOwnerProfile(ownerId,revision).then(profile=>{if(active&&version===sequence)next(profile);}).catch(error=>{if(active&&version===sequence)onError(error instanceof Error?error:new Error('Perfil no disponible.'));});},error:onError});
 return()=>{active=false;sequence++;stop();};
}
export function subscribeOwnerAppointments(ownerId:string,next:(rows:Appointment[])=>void,onError:(error:Error)=>void=()=>{}){
 let active=true,last:string|undefined,running=false,dirty=false;
 const refresh=async()=>{if(running){dirty=true;return;}running=true;try{do{dirty=false;const rows=await readOwnerAppointments(ownerId,true);if(active&&!dirty)next(rows);}while(active&&dirty);}catch(error){last=undefined;if(active)onError(error instanceof Error?error:new Error('Agenda no disponible.'));}finally{running=false;}};
 const stop=subscribeOwnerWorkspace(ownerId,{next:revision=>{if(last===revision)return;last=revision;void refresh();},error:onError});
 return()=>{active=false;stop();};
}
