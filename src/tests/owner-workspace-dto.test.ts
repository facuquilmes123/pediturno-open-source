// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { ownerProfileDto,ownerAppointmentDto } from '@/lib/owner-workspace-dto';
import { getBusinessPlan } from '@/lib/membership-entitlement';
describe('owner web projections preserve contracts without provider secrets',()=>{
 it('preserves both membership ledgers and dates without granting a revoked purchase',()=>{
  const legacy={type:'pro',startsAt:Timestamp.fromMillis(1000),expiresAt:Timestamp.fromMillis(10000)};
  const play={type:'pro',source:'GOOGLE_PLAY',productId:'pediturno_servicios_pro_monthly',purchaseHash:'a'.repeat(64),status:'revoked',expiresAt:Timestamp.fromMillis(20000),purchaseToken:'synthetic-private'};
  const p=ownerProfileDto('owner',{status:'active',businessType:'services',membership:legacy,googlePlayMembership:play,secret:'synthetic-private',mercadopago:{isConnected:true,depositType:'fixed',depositValue:900,accessToken:'synthetic-private',refreshToken:'synthetic-private'}});
  expect(p).not.toHaveProperty('secret');expect(JSON.stringify(p)).not.toContain('synthetic-private');expect(p.mercadopago).toEqual({isConnected:true,depositType:'fixed',depositValue:900});
  expect(getBusinessPlan(p,5000)).toMatchObject({plan:'pro',source:'LEGACY',expiresAt:new Date(10000).toISOString()});expect(getBusinessPlan(p,15000)).toMatchObject({plan:'free',source:'FREE'});
 });
 it('preserves all web settings and a missing profile date without inventing one',()=>{const p=ownerProfileDto('owner',{name:'QA',description:'QA',address:{city:'Quilmes',private:'secret'},socialLinks:[{id:'a',type:'instagram',url:'https://example.test',title:'QA',private:'secret'}],bookingSettings:{autoConfirm:false,remindersEnabled:true,notificationEmail:'qa@example.test'},createdAt:Timestamp.fromMillis(1000)});expect(p.id).toBe('owner');expect(p.address).toEqual({city:'Quilmes'});expect(p.socialLinks).toEqual([{id:'a',type:'instagram',url:'https://example.test',title:'QA'}]);expect(p).not.toHaveProperty('lastModified');expect(p.createdAt).toBe(new Date(1000).toISOString());expect(p.bookingSettings).toMatchObject({autoConfirm:false,remindersEnabled:true});});
 it('preserves agenda money, review and occupied intervals but not locks or payment tokens',()=>{const p=ownerAppointmentDto('a','owner',{businessId:'forged',date:Timestamp.fromMillis(1000),occupiedStartAt:Timestamp.fromMillis(2000),occupiedEndAt:Timestamp.fromMillis(3000),depositPaid:900,depositAmount:900,paymentReviewRequired:true,paymentStatus:'reversal_review',priceAtBooking:3000,preparationMinutesAtBooking:30,cleanupMinutesAtBooking:20,bookingSlotIds:['private-lock'],paymentId:'private-payment'});expect(p).toMatchObject({id:'a',businessId:'owner',date:new Date(1000).toISOString(),depositPaid:900,priceAtBooking:3000,paymentReviewRequired:true,preparationMinutesAtBooking:30});expect(p).not.toHaveProperty('paymentId');expect(p).not.toHaveProperty('bookingSlotIds');});
 it('represents missing legacy dates explicitly and rejects corrupt date values',()=>{expect(ownerAppointmentDto('a','owner',{}).date).toBeNull();expect(()=>ownerAppointmentDto('a','owner',{date:'corrupt'})).toThrow();});
});
