import 'server-only';
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { AndroidOwnerApiError } from '@/lib/android-owner-api';
type Listener={next:(revision:string)=>void;error:()=>void};
type Channel={listeners:Set<Listener>;stops:Array<()=>void>;business?:string;agenda?:string;revision?:string};
/** Only two small documents per active UID; no private payload or entire-agenda watch. */
export function createOwnerWorkspaceEventHub(maxOwners=200,maxStreams=3){
 const channels=new Map<string,Channel>();
 function subscribe(db:Firestore,uid:string,listener:Listener){
  let channel=channels.get(uid);
  if(channel&&channel.listeners.size>=maxStreams)throw new AndroidOwnerApiError(429,'WORKSPACE_STREAM_LIMIT','Too many active workspace views');
  if(!channel){
   if(channels.size>=maxOwners)throw new AndroidOwnerApiError(503,'WORKSPACE_STREAM_UNAVAILABLE','Workspace updates unavailable');
   channel={listeners:new Set(),stops:[]};channels.set(uid,channel);
  }
  const current=channel;current.listeners.add(listener);
  const remove=()=>{current.listeners.delete(listener);if(!current.listeners.size){if(channels.get(uid)===current)channels.delete(uid);for(const stop of current.stops.splice(0))stop();}};
  if(current.listeners.size===1){
   const update=(kind:'business'|'agenda')=>(snapshot:DocumentSnapshot)=>{
    if(!current.listeners.size)return;
    current[kind]=snapshot.updateTime?.toDate().toISOString()+':'+(snapshot.updateTime?.nanoseconds??0);
    if(current.business===undefined||current.agenda===undefined)return;
    const revision=createHash('sha256').update(current.business+'|'+current.agenda).digest('hex');
    if(current.revision===revision)return;current.revision=revision;
    for(const target of [...current.listeners])target.next(revision);
   };
   const fail=()=>{for(const target of [...current.listeners])target.error();};
   const attach=(path:string,kind:'business'|'agenda')=>{const stop=db.doc(path).onSnapshot(update(kind),fail);if(current.listeners.size)current.stops.push(stop);else stop();};
   try{attach('businesses/'+uid,'business');if(current.listeners.size)attach('ownerWorkspaceVersions/'+uid,'agenda');}
   catch(cause){remove();throw cause;}
  }else if(current.revision){listener.next(current.revision);}
  return remove;
 }
 return {subscribe,activeOwners:()=>channels.size};
}
const hub=createOwnerWorkspaceEventHub();
export function ownerWorkspaceEventResponse(db:Firestore,uid:string,signal:AbortSignal):Response{
 let controller:ReadableStreamDefaultController<Uint8Array>|undefined, pending:string|undefined, stopped=false;
 let release=()=>{};let heartbeat:ReturnType<typeof setInterval>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
 const encoder=new TextEncoder();
 const stop=()=>{if(stopped)return;stopped=true;release();if(heartbeat)clearInterval(heartbeat);if(deadline)clearTimeout(deadline);signal.removeEventListener('abort',stop);try{controller?.close();}catch{/* Already cancelled. */}};
 release=hub.subscribe(db,uid,{next:revision=>{if(stopped)return;if(controller)controller.enqueue(encoder.encode('data: '+JSON.stringify({revision})+'\n\n'));else pending=revision;},error:stop});
 if(stopped)release();
 const body=new ReadableStream<Uint8Array>({start(c){controller=c;if(stopped){c.close();return;}if(pending)c.enqueue(encoder.encode('data: '+JSON.stringify({revision:pending})+'\n\n'));heartbeat=setInterval(()=>{if(!stopped)c.enqueue(encoder.encode(': keepalive\n\n'));},10000);deadline=setTimeout(stop,55000);if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});},cancel:stop});
 return new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'}});
}
