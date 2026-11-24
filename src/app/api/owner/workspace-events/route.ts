import { verifiedWebOwner } from '@/lib/owner-workspace-server';
import { ownerWorkspaceEventResponse } from '@/lib/owner-workspace-events';
import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { androidError, type AndroidOwnerApiError } from '@/lib/android-owner-api';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request){
 try{const owner=await verifiedWebOwner(request);const admission=await checkOwnerReadRateLimit(owner.db,owner.uid);if(!admission.allowed)return ownerReadRateLimitResponse(admission);return ownerWorkspaceEventResponse(owner.db,owner.uid,request.signal);}
 catch(cause){const error=cause as AndroidOwnerApiError;return error?.status&&error.code?androidError(error.message,error.status,error.code):androidError('Workspace updates unavailable',503,'WORKSPACE_UNAVAILABLE');}
}
