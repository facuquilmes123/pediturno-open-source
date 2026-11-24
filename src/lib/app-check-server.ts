import { getAppCheck } from "firebase-admin/app-check";
import { initializeAdminApp } from "@/lib/firebase-admin";

const APP_CHECK_HEADER = "x-firebase-appcheck";

function localBypassAllowed(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS === "true";
}

/**
 * Verifies a Firebase App Check token before a public route reads data.
 * Limited-use tokens are consumed only for state-changing endpoints.
 */
export async function verifyPublicAppCheck(request: Request, options: { consume?: boolean } = {}): Promise<boolean> {
  if (localBypassAllowed()) return true;

  const token = request.headers.get(APP_CHECK_HEADER);
  if (!token || token.length > 4096) return false;

  try {
    const result = await getAppCheck(initializeAdminApp()).verifyToken(token, { consume: options.consume === true });
    return !options.consume || result.alreadyConsumed !== true;
  } catch {
    // Do not disclose verifier configuration or token details to callers.
    return false;
  }
}
