"use client";

import { Button } from "@/components/ui/button";

export function FirebaseReadinessNotice({ ready, error, retry }: {
  ready: boolean;
  error: string | null;
  retry: () => void;
}) {
  if (ready) return null;
  return <div className="rounded-xl border bg-secondary/40 p-3 text-sm" role={error ? "alert" : "status"}>
    <p>{error || "Preparando tu acceso seguro…"}</p>
    {error && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>Volver a intentar</Button>}
  </div>;
}
