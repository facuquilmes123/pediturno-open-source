// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOwnerWorkspaceEventHub, ownerWorkspaceEventResponse } from '@/lib/owner-workspace-events';
function database(){
 const watches=new Map<string,{next:(snapshot:any)=>void,error:()=>void,stop:ReturnType<typeof vi.fn>}>();
 const db={doc:vi.fn((path:string)=>({onSnapshot:vi.fn((next,error)=>{const stop=vi.fn();watches.set(path,{next,error,stop});return stop;})}))};
 const emit=(path:string,millis:number)=>watches.get(path)!.next({updateTime:{toDate:()=>new Date(millis),nanoseconds:millis}});
 return {db:db as any,watches,emit};
}
afterEach(()=>vi.useRealTimers());
describe('bounded owner workspace revision hub',()=>{
 it('shares exactly two private watches, waits for both and releases the last subscriber',()=>{
  const {db,watches,emit}=database(),hub=createOwnerWorkspaceEventHub(),a={next:vi.fn(),error:vi.fn()},b={next:vi.fn(),error:vi.fn()};
  const offA=hub.subscribe(db,'qa',a),offB=hub.subscribe(db,'qa',b);
  expect(db.doc).toHaveBeenCalledTimes(2);expect(hub.activeOwners()).toBe(1);
  emit('businesses/qa',1000);expect(a.next).not.toHaveBeenCalled();emit('ownerWorkspaceVersions/qa',2000);
  expect(a.next).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/));expect(a.next.mock.calls).toEqual(b.next.mock.calls);
  emit('ownerWorkspaceVersions/qa',2000);expect(a.next).toHaveBeenCalledTimes(1);
  emit('ownerWorkspaceVersions/qa',3000);expect(a.next).toHaveBeenCalledTimes(2);
  offA();expect([...watches.values()].every(w=>!w.stop.mock.calls.length)).toBe(true);offB();offB();
  expect(hub.activeOwners()).toBe(0);for(const watch of watches.values())expect(watch.stop).toHaveBeenCalledTimes(1);
 });
 it('caps streams per account and total watched owners before creating additional watches',()=>{
  const {db}=database(),hub=createOwnerWorkspaceEventHub(1,2),listener={next:vi.fn(),error:vi.fn()};
  const a=hub.subscribe(db,'qa',listener),b=hub.subscribe(db,'qa',{...listener});
  expect(()=>hub.subscribe(db,'qa',{...listener})).toThrow(/Too many/);expect(()=>hub.subscribe(db,'other',{...listener})).toThrow(/unavailable/);expect(db.doc).toHaveBeenCalledTimes(2);a();b();
 });
 it('cleans synchronous provider errors even before subscription returns',()=>{
  const stop=vi.fn(),hub=createOwnerWorkspaceEventHub();let release=()=>{};
  const listener={next:vi.fn(),error:()=>release()};
  const db={doc:vi.fn(()=>({onSnapshot:(_next:any,error:any)=>{error();return stop;}}))} as any;
  // The response adapter has to release again after the synchronous callback.
  let failed=false;release=hub.subscribe(db,'qa',{...listener,error:()=>{failed=true;release();}});if(failed)release();
  expect(hub.activeOwners()).toBe(0);expect(stop).toHaveBeenCalled();
 });
 it('sends only a revision and cleans all timers and watches on abort',async()=>{
  vi.useFakeTimers();const {db,watches,emit}=database(),abort=new AbortController();
  const response=ownerWorkspaceEventResponse(db,'stream-qa',abort.signal),reader=response.body!.getReader();
  expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('content-type')).toContain('text/event-stream');
  emit('businesses/stream-qa',1000);emit('ownerWorkspaceVersions/stream-qa',2000);
  const frame=new TextDecoder().decode((await reader.read()).value);expect(frame).toMatch(/^data: \{"revision":"[a-f0-9]{64}"\}\n\n$/);expect(frame).not.toContain('stream-qa');
  abort.abort();expect((await reader.read()).done).toBe(true);for(const w of watches.values())expect(w.stop).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('bounds each response lifetime even when a tab forgets to disconnect',async()=>{
  vi.useFakeTimers();const {db,watches}=database(),response=ownerWorkspaceEventResponse(db,'deadline-qa',new AbortController().signal),reader=response.body!.getReader();
  await vi.advanceTimersByTimeAsync(55000);while(!(await reader.read()).done){}for(const w of watches.values())expect(w.stop).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
});
