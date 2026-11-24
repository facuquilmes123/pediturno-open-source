"use client";

import type { AppCheck } from "firebase/app-check";
import { clientAppCheck, ensureFirebaseReady } from "@/lib/firebase";

const APP_CHECK_HEADER = "X-Firebase-AppCheck";

function localBypassAllowed(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS === "true";
}

async function getClientAppCheck(): Promise<AppCheck> {
  await ensureFirebaseReady();
  if (!clientAppCheck) throw new Error("App Check is not configured");
  return clientAppCheck;
}

/**
 * Gets an App Check header immediately before calling a protected public API.
 * POST requests use a limited-use token because the server consumes it to
 * reject replayed booking submissions.
 */
export async function publicAppCheckHeaders(options: { consume?: boolean } = {}): Promise<Record<string, string>> {
  if (localBypassAllowed()) return {};

  const [appCheck, { getLimitedUseToken, getToken }] = await Promise.all([
    getClientAppCheck(),
    import("firebase/app-check"),
  ]);
  const result = options.consume
    ? await getLimitedUseToken(appCheck)
    : await getToken(appCheck);
  if (!result.token) throw new Error("App Check token unavailable");
  return { [APP_CHECK_HEADER]: result.token };
}
