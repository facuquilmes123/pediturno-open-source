// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { deleteApp, getApp } from 'firebase-admin/app';
import { Query, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { createSitemapBusinessReader } from '@/lib/sitemap-businesses';

const project='demo-pediturno-sitemap',nowBase=Date.parse('2030-01-01T00:00:00Z');
const db=getAdminFirestore();
beforeAll(async()=>{
 if(process.env.FIREBASE_PROJECT_ID!==project||process.env.GOOGLE_CLOUD_PROJECT!==project||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Own loopback demo project required');
 for(let start=0;start<520;start+=400){const batch=db.batch();for(let i=start;i<Math.min(start+400,520);i++)batch.set(db.doc('businesses/free-'+String(i).padStart(4,'0')),{slug:'free-'+i,status:'active',businessType:'services',lastModified:Timestamp.fromMillis(nowBase),email:'SYNTHETIC_PRIVATE',mercadopago:{accessToken:'SYNTHETIC_PRIVATE'},membership:{type:'pro',expiresAt:Timestamp.fromMillis(0),paymentId:'SYNTHETIC_PRIVATE'}});await batch.commit();}
 const b=db.batch();
 for(const [id,data]of Object.entries({court:{businessType:'sports_facility',membership:{type:'trial',expiresAt:Timestamp.fromMillis(nowBase+1000)}},space:{businessType:'spaces',membership:{type:'lifetime'}},qa:{businessType:'services',qaFixture:true},blocked:{businessType:'services',status:'deletion_requested'},bad:{businessType:'services',slug:'../private'}}))b.set(db.doc('businesses/'+id),{slug:id,status:'active',...data});
 await b.commit();
},60000);
afterAll(async()=>{vi.restoreAllMocks();await deleteApp(getApp());});
it('real Firestore projection preserves all 520 Gratis businesses, coalesces hosts, expires memberships and refreshes deletions',async()=>{
 let now=nowBase;const reads=vi.spyOn(Query.prototype,'get');const read=createSitemapBusinessReader(undefined,()=>now);
 const results=await Promise.all(Array.from({length:100},(_,i)=>read(i%2?'services':'sports_facility')));
 expect(reads).toHaveBeenCalledTimes(1);expect(results[1]).toHaveLength(520);expect(results[0]).toHaveLength(1);
 expect((await read('spaces'))[0].url).toBe('https://espacios.pediturno.com/space');
 const snapshot=await reads.mock.results[0].value;expect(snapshot.docs.length).toBeGreaterThan(520);
 for(const doc of snapshot.docs){const data=doc.data();expect(data).not.toHaveProperty('email');expect(data).not.toHaveProperty('mercadopago');expect(data.membership||{}).not.toHaveProperty('paymentId');}
 expect(JSON.stringify(results)).not.toContain('SYNTHETIC_PRIVATE');
 now+=1000;expect(await read('sports_facility')).toEqual([]);expect(reads).toHaveBeenCalledTimes(1);
 await db.doc('businesses/free-0000').update({status:'deletion_requested'});await db.doc('businesses/new').set({status:'active',businessType:'services',slug:'new-public'});
 now=nowBase+300000;const refreshed=await read('services');expect(refreshed).toHaveLength(520);expect(refreshed.map(x=>x.url)).not.toContain('https://pediturno.com/free-0');expect(refreshed.map(x=>x.url)).toContain('https://pediturno.com/new-public');expect(reads).toHaveBeenCalledTimes(2);
},60000);
