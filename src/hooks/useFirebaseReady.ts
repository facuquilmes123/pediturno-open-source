"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureFirebaseReady } from "@/lib/firebase";

export const FIREBASE_READY_ERROR = "No pudimos verificar la conexión segura. Revisá tu conexión y volvé a intentar.";

export function useFirebaseReady() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setReady(false);
    setError(null);
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void ensureFirebaseReady().then(() => {
      if (active) setReady(true);
    }).catch(() => {
      if (active) setError(FIREBASE_READY_ERROR);
    });
    return () => { active = false; };
  }, [attempt]);
  return { ready, error, retry };
}
