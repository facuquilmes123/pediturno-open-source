import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { attest, toast } = vi.hoisted(() => ({ toast:vi.fn(), attest: vi.fn().mockRejectedValue(new Error('attestation unavailable')) }));
vi.mock('@/lib/app-check-client', () => ({publicAppCheckHeaders:attest}));
vi.mock('next/navigation', () => ({useSearchParams:()=>({get:()=>null})}));
vi.mock('next/dynamic', () => ({default:()=>()=>null}));
vi.mock('@/hooks/use-toast', () => ({useToast:()=>({toast})}));
vi.mock('@/components/ui/calendar', () => ({Calendar:({onSelect}:any)=><button onClick={()=>onSelect(new Date(Date.now()+86400000))}>Elegir fecha QA</button>}));
vi.mock('add-to-calendar-button-react', () => ({AddToCalendarButton:()=>null}));
import BookingClientPage from '@/app/[slug]/BookingClientPage';
describe('public availability failure',()=>{
 beforeEach(()=>{attest.mockRejectedValue(new Error('attestation unavailable'));});
 afterEach(()=>vi.unstubAllGlobals());
 it('does not advertise free slots when attestation failed and offers an explicit retry',async()=>{
  const hours=Object.fromEntries(Array.from({length:7},(_,day)=>[day,{slots:[{start:'09:00',end:'19:00'}]}]));
  render(<BookingClientPage businessData={{id:'qa',name:'QA',slug:'qa',businessType:'services',status:'active',theme:'menta',bookingSettings:{bookingLeadTimeHours:0,appointmentBufferMinutes:0}} as any} services={[{id:'qa-service',name:'Servicio QA',status:'Activo',duration:'30',price:100,workingHours:hours} as any]} businessId="qa"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Seleccionar servicio Servicio QA'}));
  fireEvent.click(await screen.findByRole('button',{name:'Elegir fecha QA'}));
  expect(await screen.findByRole('button',{name:'Reintentar horarios'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'09:00'})).not.toBeInTheDocument();
  expect(screen.queryByText('Horarios listos')).not.toBeInTheDocument();
 });
 it('recovers after retry without treating the earlier failure as an empty agenda',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({appointments:[]})}));
  const hours=Object.fromEntries(Array.from({length:7},(_,day)=>[day,{slots:[{start:'09:00',end:'19:00'}]}]));
  render(<BookingClientPage businessData={{id:'qa',name:'QA',slug:'qa',businessType:'services',status:'active',theme:'menta',bookingSettings:{bookingLeadTimeHours:0,appointmentBufferMinutes:0}} as any} services={[{id:'qa-service',name:'Servicio QA',status:'Activo',duration:'30',price:100,workingHours:hours} as any]} businessId="qa"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Seleccionar servicio Servicio QA'}));
  fireEvent.click(await screen.findByRole('button',{name:'Elegir fecha QA'}));
  const retry=await screen.findByRole('button',{name:'Reintentar horarios'});
  attest.mockResolvedValue({});fireEvent.click(retry);
  expect(await screen.findByRole('button',{name:'09:00'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:'Reintentar horarios'})).not.toBeInTheDocument();
 });
 it('keeps the booking draft and idempotency key when reCAPTCHA App Check fails before the POST, then retries safely',async()=>{
  const fetchMock=vi.fn(async(input:any,init?:RequestInit)=>{
   if(String(input).startsWith('/api/public/availability'))return {ok:true,json:async()=>({appointments:[]})};
   return {ok:true,json:async()=>({id:'qa-booking'})};
  });
  vi.stubGlobal('fetch',fetchMock);
  vi.stubGlobal('crypto',{randomUUID:vi.fn(()=>'qa-stable-idempotency-key')});
  attest.mockImplementation((options?:{consume?:boolean})=>options?.consume
   ? Promise.reject(new Error('FirebaseError: AppCheck: ReCAPTCHA error. (appCheck/recaptcha-error)'))
   : Promise.resolve({}));
  localStorage.setItem('pediturno-client-data',JSON.stringify({name:'Cliente QA',phone:'+541111111111',email:'qa@example.test'}));
  const hours=Object.fromEntries(Array.from({length:7},(_,day)=>[day,{slots:[{start:'09:00',end:'19:00'}]}]));
  render(<BookingClientPage businessData={{id:'qa',name:'QA',slug:'qa',businessType:'services',status:'active',theme:'menta',bookingSettings:{bookingLeadTimeHours:0,appointmentBufferMinutes:0}} as any} services={[{id:'qa-service',name:'Servicio QA',status:'Activo',duration:'30',price:100,workingHours:hours} as any]} businessId="qa"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Seleccionar servicio Servicio QA'}));
  fireEvent.click(await screen.findByRole('button',{name:'Elegir fecha QA'}));
  fireEvent.click(await screen.findByRole('button',{name:'09:00'}));
  fireEvent.click(await screen.findByRole('button',{name:'Continuar con la Reserva'}));
  expect(await screen.findByDisplayValue('Cliente QA')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar Reserva'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos verificar tu dispositivo para reservar. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.');
  expect(screen.getByDisplayValue('Cliente QA')).toBeVisible();
  expect(screen.getByRole('button',{name:'09:00'})).toBeVisible();
  expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);

  attest.mockResolvedValue({});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar Reserva'}));
  await waitFor(()=>expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1));
  const [,request]=fetchMock.mock.calls.find(([,init])=>init?.method==='POST')!;
  const body=JSON.parse(String(request.body));
  expect(body).toMatchObject({client:'Cliente QA',clientPhone:'+541111111111',clientEmail:'qa@example.test',idempotencyKey:'qa-stable-idempotency-key'});
  expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
 });

});
