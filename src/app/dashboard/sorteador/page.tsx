
"use client";

import { useState } from "react";
import { Award } from "lucide-react";
import DrawWizard from "@/components/DrawWizard";

export default function SorteadorPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-secondary rounded-full">
            <Award className="h-6 w-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Sorteador de Torneos
            </h1>
            <p className="text-muted-foreground">
              Crea y sortea equipos, parejas o jugadores para tus torneos.
            </p>
          </div>
        </div>
      </div>
      <DrawWizard />
    </div>
  );
}
