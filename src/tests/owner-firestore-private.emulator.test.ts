// @vitest-environment node
import fs from 'node:fs';
import { beforeAll,afterAll,expect,it,vi } from 'vitest';
import { Firestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment,assertFails,type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { NextRequest } from 'next/server';
const fixture=vi.hoisted(()=>({owner:vi.fn()}));
vi.mock('@/lib/android-owner-api',async original=>({...await original<typeof import('@/lib/android-owner-api')>(),requireAndroidOwner:fixture.owner}));
import { authorizeImageUpload,imageUploadInput } from '@/lib/image-upload-permits';
import { PATCH } from '@/app/api/v1/owner/clients/[clientId]/route';
const projectId='demo-pediturno-permits';let db:Firestore,env:RulesTestEnvironment;
beforeAll(async()=>{
 for(const value of [process.env.FIRESTORE_EMULATOR_HOST,process.env.FIREBASE_STORAGE_EMULATOR_HOST])if(!/^127\.0\.0\.1:\d+$/.test(value??''))throw Error('Own emulators required');
 if(process.env.PEDITURNO_EXPECT_LOOPBACK_GUARD==='1')expect((globalThis as any).__PEDITURNO_OWN_EMULATOR_NETWORK_ONLY__).toBe(true);
 if(process.env.GOOGLE_CLOUD_PROJECT!==projectId)throw Error('Wrong test project');
 db=new Firestore({projectId,host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST!.split(':'),[storageHost,storagePort]=process.env.FIREBASE_STORAGE_EMULATOR_HOST!.split(':');
 env=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:fs.readFileSync('firestore.rules','utf8')},storage:{host:storageHost,port:Number(storagePort),rules:fs.readFileSync('storage.rules','utf8')}});
 await db.doc('businesses/owner').set({status:'active',businessType:'services',name:'Synthetic'});
 for(const collection of ['services','canchas','spaces','appointments','clients','ownerWorkspaceVersions'])await db.doc(collection+'/qa-private').set({businessId:'owner',name:'Synthetic',phone:'111111',revision:1});
},30000);
afterAll(async()=>{if(env)await env.cleanup();if(db)await db.terminate();});
it('denies all direct owner, neighbor and anonymous reads and queries before the API gate can be bypassed',async()=>{
 for(const identity of ['owner','neighbor',null]){
  const direct=identity?env.authenticatedContext(identity).firestore():env.unauthenticatedContext().firestore();
  for(const collection of ['businesses','services','canchas','spaces','appointments','clients','ownerWorkspaceVersions']){
   await assertFails(direct.doc(collection+'/'+(collection==='businesses'?'owner':'qa-private')).get());
   await assertFails(direct.collection(collection).where('businessId','==','owner').get());
  }
 }
},30000);
it('denies direct writes even by the owner while preserving the real authenticated server editor',async()=>{
 const direct=env.authenticatedContext('owner').firestore();
 await assertFails(direct.doc('clients/qa-private').update({name:'Bypass'}));await assertFails(direct.doc('clients/new').set({businessId:'owner',name:'Bypass',phone:'111111'}));
 fixture.owner.mockResolvedValue({uid:'owner',db,business:{status:'active',businessType:'services'}});
 const response=await PATCH(new NextRequest('https://qa.invalid/api/v1/owner/clients/qa-private',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Validated API'})}),{params:Promise.resolve({clientId:'qa-private'})});
 expect(response.status).toBe(200);expect((await db.doc('clients/qa-private').get()).get('name')).toBe('Validated API');
});
it('keeps Storage receipt uploads working when every client Firestore read is forbidden',async()=>{
 const grant=await authorizeImageUpload(db,'owner','private_rules_image',imageUploadInput({category:'logos',contentType:'image/jpeg',byteSize:5}));
 const storage=env.authenticatedContext('owner').storage('gs://'+projectId+'.appspot.com');
 const target=storage.ref(grant.storagePath),image=new Uint8Array([1,2,3,4,5]);
 await target.put(image,{contentType:'image/jpeg',customMetadata:{imagePermitId:grant.permitId}});
 await assertFails(target.put(image,{contentType:'image/jpeg',customMetadata:{imagePermitId:grant.permitId}}));
 await assertFails(storage.ref('businesses/owner/logos/no-permit.jpg').put(image,{contentType:'image/jpeg'}));
 expect((await db.doc('bookingRateLimits/image-permit-v1_'+grant.permitId).get()).get('status')).toBe('pending');
},30000);
