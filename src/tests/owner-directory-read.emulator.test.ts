// @vitest-environment node
// Real persistence and route handlers; owner verification is an explicit synthetic boundary.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
const fixture = vi.hoisted(() => ({ owner: vi.fn(), time: 60_100 }));
vi.mock('@/lib/android-owner-api', async original => ({
  ...(await original<typeof import('@/lib/android-owner-api')>()), requireAndroidOwner: fixture.owner,
}));
vi.mock('@/lib/owner-read-rate-limit', async original => {
  const limiterApi = await original<typeof import('@/lib/owner-read-rate-limit')>();
  return { ...limiterApi, checkOwnerReadRateLimit: limiterApi.createOwnerReadLimiter(() => fixture.time) };
});
import { GET as bootstrap } from '@/app/api/v1/owner/bootstrap/route';
import { GET as dashboard } from '@/app/api/v1/owner/dashboard/route';
import { GET as clients } from '@/app/api/v1/owner/clients/route';
import { GET as services } from '@/app/api/v1/owner/services/route';
import { GET as agenda } from '@/app/api/v1/owner/agenda/route';
import { GET as availability } from '@/app/api/v1/owner/availability/route';
import { GET as history } from '@/app/api/v1/owner/clients/[clientId]/history/route';
import { createHash } from 'node:crypto';

const projectId='demo-pediturno-p103', owners=['qa-directory-a','qa-directory-b'];
const db=new Firestore({projectId,host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
const business={status:'active',businessType:'services',name:'Synthetic directory',timeZone:'America/Argentina/Buenos_Aires'};
const counter=(uid:string)=>db.collection('bookingRateLimits').doc('owner-read-v1_'+createHash('sha256').update(uid).digest('hex'));
let currentOwner=owners[0];
const routes: Array<[string,(r:NextRequest)=>Promise<Response>]>=[
  ['bootstrap',bootstrap],['dashboard',dashboard],['clients',clients],['services',services],['agenda',agenda],['availability',availability],
  ['history',r=>history(r,{params:Promise.resolve({clientId:'client-'+currentOwner})})],
];
function request(name:string){return new NextRequest(`https://qa.invalid/${name}?date=2030-06-03&serviceId=service-${currentOwner}&businessId=forged-neighbor`);}

describe.runIf(process.env.GOOGLE_CLOUD_PROJECT===projectId)('Heavy read admission preserves the existing directory pagination contract',()=>{
  beforeAll(async()=>{
    if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'') || process.env.GOOGLE_CLOUD_PROJECT!==projectId) throw Error('Own loopback demo emulator required');
    for(const uid of owners){
      await db.doc('businesses/'+uid).set(business);
      await db.doc('clients/client-'+uid).set({businessId:uid,name:uid+' client',phone:'54000111'});
      await db.doc('services/service-'+uid).set({businessId:uid,name:uid+' service',duration:'30',price:'100',status:'Activo'});
      await db.doc('appointments/appointment-'+uid).set({businessId:uid,clientId:'client-'+uid,clientPhone:'54000111',serviceId:'service-'+uid,
        date:Timestamp.fromDate(new Date('2030-06-03T13:00:00Z')),time:'10:00',status:'Confirmado',durationMinutes:30,priceAtBooking:100});
    }
    for(let start=0;start<1300;start+=400){
      const batch=db.batch();
      for(let i=start;i<Math.min(start+400,1300);i++)batch.create(db.doc('clients/client-bulk-'+String(i).padStart(4,'0')),
        {businessId:owners[0],name:owners[0]+' client '+i,phone:'54000'+String(i).padStart(6,'0')});
      await batch.commit();
    }
  });
  afterAll(async()=>{await db.terminate();});
  it('charges every page and resumes a 1301-client directory after 429 without truncating or crossing UID',async()=>{
    fixture.owner.mockImplementation(async()=>({uid:currentOwner,db,business,authTime:null}));
    for(const [name,handler] of routes){
      const response=await handler(request(name));expect(response.status,name).toBe(200);
      const data=await response.json();
      if(name==='clients')expect(data.clients.every((row:{name:string})=>row.name.startsWith(currentOwner))).toBe(true);
      if(name==='services')expect(data.services).toEqual([expect.objectContaining({name:currentOwner+' service'})]);
    }
    expect((await counter(currentOwner).get()).get('count')).toBe(7);
    const seen=new Set<string>();let cursor:string|null=null;let pages=0;let rejected=0;
    do{
      const url=request('clients').nextUrl;if(cursor)url.searchParams.set('cursor',cursor);
      const response=await clients(new NextRequest(url));
      if(response.status===429){
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const seconds=Number(response.headers.get('Retry-After'));expect(seconds).toBeGreaterThan(0);
        fixture.time+=seconds*1000;rejected++;expect(rejected).toBeLessThan(4);continue;
      }
      expect(response.status).toBe(200);const page=await response.json();
      for(const row of page.clients){expect(row.name.startsWith(currentOwner)).toBe(true);expect(seen.has(row.id)).toBe(false);seen.add(row.id);}
      cursor=page.nextCursor;pages++;expect(pages).toBeLessThanOrEqual(20);
    }while(cursor);
    expect(pages).toBe(14);expect(seen.size).toBe(1301);expect(rejected).toBeGreaterThan(0);
    expect((await counter(currentOwner).get()).get('count')).toBe(21);
    // Forged cursors and repeated pages do not bypass admission. Fill this burst.
    for(let i=0;i<12;i++){
      const r=await clients(new NextRequest('https://qa.invalid/clients?cursor=forged'));
      if(r.status===429)break;
      expect(r.status).toBe(200);
    }
    const spy=vi.spyOn(db,'collection');spy.mockClear();
    const denied=await clients(new NextRequest('https://qa.invalid/clients?cursor=forged'));
    expect(denied.status).toBe(429);expect(spy).not.toHaveBeenCalled();spy.mockRestore();
    currentOwner=owners[1];expect((await clients(request('clients'))).status).toBe(200);
    expect((await counter(currentOwner).get()).get('count')).toBe(1);
    currentOwner=owners[0];fixture.time=120_100;
    expect((await clients(request('clients'))).status).toBe(200);
    expect((await counter(currentOwner).get()).get('count')).toBe(1);
    expect((await db.collection('bookingRateLimits').get()).size).toBe(2);
  },60_000);
});
