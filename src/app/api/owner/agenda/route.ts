import { NextRequest, NextResponse } from 'next/server';
import { verifiedWebOwner } from '@/lib/owner-workspace-server';
import { ownerAppointmentDto } from '@/lib/owner-workspace-dto';
import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { androidError, type AndroidOwnerApiError } from '@/lib/android-owner-api';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const cursor=request.nextUrl.searchParams.get('cursor'), requestedVersion=request.nextUrl.searchParams.get('revision');
    const limit=Number(request.nextUrl.searchParams.get('limit') ?? '100');
    if (!Number.isInteger(limit)||limit<1||limit>100 || cursor!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(cursor) ||
        requestedVersion!==null&&(!/^\d{1,16}$/.test(requestedVersion)||!Number.isSafeInteger(Number(requestedVersion)))) return androidError('Invalid agenda request',400,'INVALID_AGENDA_REQUEST');
    const owner=await verifiedWebOwner(request);
    const admission=await checkOwnerReadRateLimit(owner.db,owner.uid);
    if(!admission.allowed)return ownerReadRateLimitResponse(admission);
    let query=owner.db.collection('appointments').where('businessId','==',owner.uid).orderBy('__name__').limit(limit+1);
    if(cursor)query=query.startAfter(cursor) as typeof query;
    const result=await owner.db.runTransaction(async tx=>{
      const version=await tx.get(owner.db.collection('ownerWorkspaceVersions').doc(owner.uid));
      const revision=version.exists?version.get('revision'):0;
      if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid revision');
      if(requestedVersion!==null && Number(requestedVersion)!==revision)return null;
      const snapshot=await tx.get(query),page=snapshot.docs.slice(0,limit);
      return {appointments:page.map(doc=>ownerAppointmentDto(doc.id,owner.uid,doc.data())),revision,nextCursor:snapshot.size>limit?page.at(-1)?.id??null:null};
    },{readOnly:true});
    return result ? NextResponse.json(result,{headers:{'Cache-Control':'no-store'}}) : androidError('Agenda changed while paging',409,'AGENDA_CHANGED');
  }catch(cause){const error=cause as AndroidOwnerApiError;return error?.status&&error.code?androidError(error.message,error.status,error.code):androidError('Agenda unavailable',503,'AGENDA_UNAVAILABLE');}
}
