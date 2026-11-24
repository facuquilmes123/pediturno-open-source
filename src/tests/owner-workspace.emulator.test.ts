// @vitest-environment node
// Real client -> route -> Firestore transactions. Synthetic authentication; no production network.
import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
const f=vi.hoisted(()=>({auth:{currentUser:null as any},db:null as any,verify:vi.fn(),now:600100}));
vi.mock('@/lib/firebase',()=>({auth:f.auth}));
vi.mock('@/lib/firebase-admin',()=>({initializeAdminApp:vi.fn(),getAdminFirestore:()=>f.db}));
vi.mock('firebase-admin/auth',()=>({getAuth:()=>({verifyIdToken:f.verify})}));
vi.mock('@/lib/owner-read-rate-limit',async original=>{const api=await original<typeof import('@/lib/owner-read-rate-limit')>();return {...api,checkOwnerReadRateLimit:api.createOwnerReadLimiter(()=>f.now)};});
import { GET as agenda } from '@/app/api/owner/agenda/route';
import { GET as profile } from '@/app/api/owner/profile/route';
import { GET as events } from '@/app/api/owner/workspace-events/route';
import { markOwnerAgendaChanged } from '@/lib/owner-workspace-server';
import { readOwnerAppointments,readOwnerProfile } from '@/lib/owner-workspace-client';
const owner='qa-agenda-owner',neighbor='qa-agenda-neighbor',projectId='demo-pediturno-p103';
const db=new Firestore({projectId,host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});f.db=db;
function req(path:string,token='synthetic'){return new NextRequest('https://qa.invalid'+path,{headers:token?{Authorization:'Bearer '+token}:{}});}
beforeAll(async()=>{
 if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||process.env.GOOGLE_CLOUD_PROJECT!==projectId)throw Error('Own loopback demo required');
 f.auth.currentUser={uid:owner,getIdToken:async()=>'synthetic'};
 const batch=db.batch();for(let i=0;i<205;i++)batch.set(db.doc('appointments/qa-agenda-'+String(i).padStart(4,'0')),{businessId:owner,client:'Sintético',date:Timestamp.fromMillis(2000000000000+i*86400000),time:'10:00',status:'Confirmado',depositPaid:900,priceAtBooking:3000,privatePaymentToken:'MUST_NOT_LEAK'});
 batch.set(db.doc('appointments/qa-neighbor'),{businessId:neighbor,date:Timestamp.now(),client:'No debe salir'});
 batch.set(db.doc('businesses/'+owner),{businessType:'services',name:'QA',status:'blocked',membership:{type:'lifetime'},googlePlayMembership:{type:'pro',status:'revoked',expiresAt:Timestamp.fromMillis(1000),purchaseToken:'MUST_NOT_LEAK'},mercadopago:{isConnected:true,accessToken:'MUST_NOT_LEAK'}});
 await batch.commit();
},30000);
beforeEach(()=>{f.verify.mockImplementation(async(token:string)=>{if(token!=='synthetic')throw Error('revoked');return {uid:owner};});});
afterAll(async()=>{vi.unstubAllGlobals();await db.terminate();});
it('authenticates before reads and serves a blocked owner profile without privileged secrets',async()=>{
 expect((await profile(req('/api/owner/profile',''))).status).toBe(401);expect((await agenda(req('/api/owner/agenda','revoked'))).status).toBe(401);expect(f.verify).toHaveBeenCalledWith('revoked',true);
 const response=await profile(req('/api/owner/profile?uid='+neighbor));expect(response.status).toBe(200);const data=await response.json();expect(data.profile).toMatchObject({id:owner,name:'QA',status:'blocked',membership:{type:'lifetime'},googlePlayMembership:{status:'revoked'}});expect(JSON.stringify(data)).not.toContain('MUST_NOT_LEAK');
});
it('returns all 205 rows through the real caller, with snapshot paging and owner isolation',async()=>{
 vi.stubGlobal('fetch',async(url:string,options:RequestInit)=>{f.now+=5000;return (url.includes('/profile')?profile:agenda)(new NextRequest('https://qa.invalid'+url+'&businessId='+neighbor,options));});
 const rows=await readOwnerAppointments(owner);expect(rows).toHaveLength(205);expect(new Set(rows.map(r=>r.id)).size).toBe(205);expect(rows[0].date).toBeInstanceOf(Date);expect(rows[0]).toMatchObject({businessId:owner,depositPaid:900,priceAtBooking:3000});expect(JSON.stringify(rows)).not.toContain('MUST_NOT_LEAK');
 const p=await readOwnerProfile(owner);expect(p?.googlePlayMembership?.expiresAt).toBeInstanceOf(Date);
});
it('rejects paging across a mutation, rolls the marker back with failed transactions and increments atomically',async()=>{
 const first=await (await agenda(req('/api/owner/agenda?limit=100'))).json();expect(first.revision).toBe(0);
 await expect(db.runTransaction(async tx=>{markOwnerAgendaChanged(tx,db,owner);throw Error('controlled abort');})).rejects.toThrow('controlled abort');expect((await db.doc('ownerWorkspaceVersions/'+owner).get()).exists).toBe(false);
 await db.runTransaction(async tx=>{markOwnerAgendaChanged(tx,db,owner);tx.update(db.doc('appointments/qa-agenda-0000'),{status:'Completado'});});
 const conflict=await agenda(req('/api/owner/agenda?cursor='+first.nextCursor+'&revision=0'));expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:'AGENDA_CHANGED'});
 await Promise.all(Array.from({length:4},()=>db.runTransaction(async tx=>{markOwnerAgendaChanged(tx,db,owner);})));expect((await db.doc('ownerWorkspaceVersions/'+owner).get()).get('revision')).toBe(5);
});
it('delivers a real initial revision and a committed agenda change without leaking payloads',async()=>{
 f.now+=5000;const controller=new AbortController();const request=new Request('https://qa.invalid/api/owner/workspace-events',{headers:{Authorization:'Bearer synthetic'},signal:controller.signal});
 const response=await events(request);expect(response.status).toBe(200);const reader=response.body!.getReader();
 try{const first=new TextDecoder().decode((await reader.read()).value);expect(first).toMatch(/"revision":"[a-f0-9]{64}"/);expect(first).not.toContain(owner);
  await db.runTransaction(async tx=>markOwnerAgendaChanged(tx,db,owner));const second=new TextDecoder().decode((await reader.read()).value);expect(second).toContain('revision');expect(second).not.toEqual(first);
 }finally{controller.abort();await reader.cancel();}
});
it('rejects bad paging before authentication and limits real per-owner admission persistently',async()=>{
 const count=f.verify.mock.calls.length;for(const qs of ['limit=101','limit=0','limit=2.5','cursor=a/b','revision=-1','revision=9007199254740993'])expect((await agenda(req('/api/owner/agenda?'+qs))).status).toBe(400);expect(f.verify).toHaveBeenCalledTimes(count);
 f.now+=60000;for(let i=0;i<12;i++)expect((await profile(req('/api/owner/profile'))).status).toBe(200);const response=await agenda(req('/api/owner/agenda'));expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('5');
},30000);
