// @vitest-environment node
// Actual Web caller -> actual route -> actual Firestore. Authentication is a synthetic boundary.
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
const fixture = vi.hoisted(() => ({ auth: { currentUser: null as any }, owner: vi.fn(), now: 600100 }));
vi.mock('@/lib/firebase', () => ({ db: {}, storage: null, auth: fixture.auth }));
vi.mock('@/lib/android-owner-api', async original => ({ ...(await original<typeof import('@/lib/android-owner-api')>()), requireAndroidOwner: fixture.owner }));
vi.mock('@/lib/owner-read-rate-limit', async original => { const api=await original<typeof import('@/lib/owner-read-rate-limit')>(); return {...api,checkOwnerReadRateLimit:api.createOwnerReadLimiter(()=>fixture.now)}; });
import { GET } from '@/app/api/owner/catalog/route';
import { getServices, getCanchas, getSpaces } from '@/services/data';
const projectId='demo-pediturno-p103', owner='qa-catalog-owner', neighbor='qa-catalog-neighbor';
const db=new Firestore({projectId,host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
const hours={1:{slots:[{start:'09:00',end:'18:00'}],isAlternating:true}};
const base={businessId:owner,name:'Catalog QA',status:'Activo',photo:'https://example.test/photo',workingHours:hours,unavailableDates:[Timestamp.fromDate(new Date('2030-06-03T03:00:00Z'))],bookingBufferMinutes:null,privateMarker:'MUST_NOT_LEAK'};
beforeAll(async()=>{
 if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||process.env.GOOGLE_CLOUD_PROJECT!==projectId)throw Error('Own loopback demo required');
 const batch=db.batch();
 for(let i=0;i<205;i++)batch.set(db.doc('services/qa-catalog-'+String(i).padStart(4,'0')),{...base,duration:'45',price:'1.234,50'});
 for(let i=0;i<101;i++)batch.set(db.doc('canchas/qa-catalog-'+String(i).padStart(4,'0')),{...base,duration:90,price:'2000',sport:'padel'});
 batch.set(db.doc('spaces/qa-catalog-space'),{...base,category:'quincho',description:'Solo datos ficticios',capacity:30,packages:[{durationMinutes:240,price:'5000'}],preparationMinutes:30,cleanupMinutes:20,photos:['https://example.test/one','https://example.test/two']});
 for(const kind of ['services','canchas','spaces'])batch.set(db.doc(kind+'/qa-catalog-neighbor'),{...base,businessId:neighbor});
 await batch.commit();
});
afterAll(async()=>{vi.unstubAllGlobals();await db.terminate();});
it('all three real catalog callers preserve full editor contracts, paginate and isolate owner',async()=>{
 fixture.auth.currentUser={uid:owner,getIdToken:async()=>'synthetic-only'};
 fixture.owner.mockResolvedValue({uid:owner,db,business:{status:'active',businessType:'sports_facility'}});
 vi.stubGlobal('fetch',async(url:string,options:RequestInit)=>GET(new NextRequest('https://qa.invalid'+url+'&businessId='+neighbor,options)));
 const services=await getServices(owner),canchas=await getCanchas(owner),spaces=await getSpaces(owner);
 expect(services).toHaveLength(205);expect(canchas).toHaveLength(101);expect(spaces).toHaveLength(1);
 expect(services[0]).toMatchObject({duration:'45',price:'1.234,50',workingHours:hours,bookingBufferMinutes:null});
 expect(canchas[0]).toMatchObject({duration:90,sport:'padel'});
 expect(spaces[0]).toMatchObject({category:'quincho',description:'Solo datos ficticios',capacity:30,packages:[{durationMinutes:240,price:'5000'}],preparationMinutes:30,cleanupMinutes:20,photos:['https://example.test/one','https://example.test/two']});
 for(const item of [...services,...canchas,...spaces]){expect(item.businessId).toBe(owner);expect(item.unavailableDates).toEqual([new Date('2030-06-03T03:00:00Z')]);expect(item).not.toHaveProperty('privateMarker');}
 expect(fixture.owner).toHaveBeenCalledTimes(6);expect(fixture.owner).toHaveBeenCalledWith(expect.anything(),{allowOtherBusinessTypes:true});
 // Cross-process persistent burst: the following six fill twelve admissions.
 for(let i=0;i<6;i++)expect((await GET(new NextRequest('https://qa.invalid/api/owner/catalog?kind=services&cursor=qa-catalog-0100'))).status).toBe(200);
 const denied=await GET(new NextRequest('https://qa.invalid/api/owner/catalog?kind=services'));expect(denied.status).toBe(429);expect(denied.headers.get('Retry-After')).toBe('5');
 fixture.now+=5000;expect((await GET(new NextRequest('https://qa.invalid/api/owner/catalog?kind=services'))).status).toBe(200);
 // Malformed arguments never reach the authenticated Firestore boundary.
 const calls=fixture.owner.mock.calls.length;
 for(const qs of ['kind=businesses','kind=services&limit=101','kind=services&limit=1.5','kind=services&cursor=a/b'])expect((await GET(new NextRequest('https://qa.invalid/api/owner/catalog?'+qs))).status).toBe(400);
 expect(fixture.owner).toHaveBeenCalledTimes(calls);
},60000);
