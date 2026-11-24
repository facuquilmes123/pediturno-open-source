
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ClipboardList, Users, Shuffle, GitMerge, Group, ArrowRight, ArrowLeft, PlusCircle, Trash2, Download } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { 
  AlgorithmicDrawInput as GenerateDrawInput, 
  AlgorithmicDrawOutput as GenerateDrawOutput, 
  generateAlgorithmicDraw 
} from "@/lib/tournamentDraw";
import { Label } from "./ui/label";
import { useToast } from "@/hooks/use-toast";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

type WizardStep = "courtType" | "players" | "drawType" | "result";
type PlayerMode = 'individuals' | 'pairs';
type Participant = string | { player1: string, player2: string };

// --- SVG Icons ---

const FutbolIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2l4.24 6.76L22 12l-5.76 3.24L12 22l-4.24-6.76L2 12l5.76-3.24L12 2z" />
    <path d="M8.47 8.47L12 12l3.53-3.53" />
    <path d="M15.53 8.47L12 12l-3.53-3.53" />
    <path d="M8.47 15.53L12 12l3.53 3.53" />
    <path d="M15.53 15.53L12 12l-3.53 3.53" />
    <path d="M2 12h20" />
  </svg>
);

const PadelIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 0 0-10 10" />
    <path d="M12 22a10 10 0 0 0 10-10" />
    <path d="M7 12a5 5 0 0 1 10 0" />
  </svg>
);

const TenisIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M4.2 19.8a10 10 0 1 0 15.6-15.6" />
    <path d="M19.8 4.2a10 10 0 1 0-15.6 15.6" />
  </svg>
);

// --- Steps Components ---

const courtTypes = [
  { id: 'futbol', name: 'Fútbol', icon: FutbolIcon },
  { id: 'padel', name: 'Pádel', icon: PadelIcon },
  { id: 'tenis', name: 'Tenis', icon: TenisIcon },
  { id: 'otras', name: 'Otro', icon: ClipboardList },
];

interface CourtTypeStepProps {
  onSelect: (courtType: GenerateDrawInput['courtType']) => void;
}

const CourtTypeStep = ({ onSelect }: CourtTypeStepProps) => (
  <div>
    <h3 className="font-semibold text-lg mb-4 text-center">1. Elige el deporte</h3>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {courtTypes.map(({ id, name, icon: Icon }) => (
        <button
          type="button"
          key={id} 
          className="rounded-xl border bg-card text-card-foreground text-left cursor-pointer hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none"
          onClick={() => onSelect(id as GenerateDrawInput['courtType'])}
          aria-label={`Elegir ${name}`}
        >
          <CardContent className="p-6 flex flex-col items-center justify-center">
            <Icon className="h-12 w-12 text-primary mb-3" />
            <span className="font-semibold text-md">{name}</span>
          </CardContent>
        </button>
      ))}
    </div>
  </div>
);

interface PlayersStepProps {
  onNext: (data: { participants?: string[], predefinedPairs?: { player1: string, player2: string }[] }) => void;
  onBack: () => void;
  courtType: GenerateDrawInput['courtType'];
}

const PlayersStep = ({ onNext, onBack, courtType }: PlayersStepProps) => {
    const { toast } = useToast();
    const canHavePairs = courtType === 'padel' || courtType === 'tenis';
    const [playerMode, setPlayerMode] = useState<PlayerMode>(canHavePairs ? 'individuals' : 'individuals');
    
    // Unified state for participants
    const [participants, setParticipants] = useState<Participant[]>(['', '']);

    const handleParticipantChange = (index: number, value: string, subIndex?: 'player1' | 'player2') => {
        const newParticipants = [...participants];
        if (playerMode === 'pairs') {
            const pair = { ...(newParticipants[index] as { player1: string, player2: string }) };
            if (subIndex) {
                 pair[subIndex] = value;
                 newParticipants[index] = pair;
            }
        } else {
            newParticipants[index] = value;
        }
        setParticipants(newParticipants);
    };
    
    const addParticipant = () => {
        const newItem: Participant = playerMode === 'pairs' ? { player1: '', player2: '' } : '';
        setParticipants([...participants, newItem]);
    };

    const removeParticipant = (index: number) => {
        if (participants.length <= 2) {
             toast({
                variant: 'destructive',
                title: 'Mínimo 2 participantes/parejas',
                description: 'Necesitas al menos 2 para un sorteo.'
            });
            return;
        }
        const newParticipants = participants.filter((_, i) => i !== index);
        setParticipants(newParticipants);
    };

    const handleNext = () => {
        if (playerMode === 'individuals') {
            const validParticipants = (participants as string[]).map(p => p.trim()).filter(p => p.length > 0);
            if (validParticipants.length < 2) {
                toast({ variant: 'destructive', title: 'Participantes insuficientes', description: 'Necesitas al menos 2 participantes.' });
                return;
            }
            onNext({ participants: validParticipants });
        } else { // pairs mode
            const validPairs = (participants as { player1: string, player2: string }[])
                .map(p => ({ player1: p.player1.trim(), player2: p.player2.trim() }))
                .filter(p => p.player1.length > 0 && p.player2.length > 0);
            if (validPairs.length < 2) {
                toast({ variant: 'destructive', title: 'Parejas insuficientes', description: 'Necesitas al menos 2 parejas completas.' });
                return;
            }
            onNext({ predefinedPairs: validPairs });
        }
    };
    
    const handleModeChange = (newMode: PlayerMode) => {
        setPlayerMode(newMode);
        if (newMode === 'pairs') {
            setParticipants([{player1: '', player2: ''}, {player1: '', player2: ''}]);
        } else {
            setParticipants(['', '']);
        }
    };

    const participantLabel = courtType === 'futbol' ? 'equipo' : (playerMode === 'pairs' ? 'pareja' : 'jugador');
    const title = courtType === 'futbol' ? '2. Ingresa los equipos' : (playerMode === 'pairs' ? '2. Ingresa las parejas' : '2. Ingresa los jugadores');

    let canGoNext = false;
    if (playerMode === 'individuals') {
        canGoNext = (participants as string[]).filter(p => p.trim().length > 0).length >= 2;
    } else { // pairs mode
        canGoNext = (participants as { player1: string, player2: string }[]).filter(p => p.player1.trim().length > 0 && p.player2.trim().length > 0).length >= 2;
    }


    return (
         <div>
            <h3 className="font-semibold text-lg mb-4">{title}</h3>
            
            {canHavePairs && (
                 <div className="mb-6">
                    <Label className="text-base font-semibold">¿Qué vas a ingresar?</Label>
                    <RadioGroup value={playerMode} onValueChange={(val) => handleModeChange(val as PlayerMode)} className="mt-2 grid grid-cols-2 gap-4">
                        <Label htmlFor="mode-individuals" className={cn("flex flex-col items-center justify-center rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors", playerMode === 'individuals' && "bg-accent/80 border-primary")}>
                             <RadioGroupItem value="individuals" id="mode-individuals" className="sr-only" />
                             <Users className="mb-2"/>
                             Jugadores Individuales
                        </Label>
                        <Label htmlFor="mode-pairs" className={cn("flex flex-col items-center justify-center rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors", playerMode === 'pairs' && "bg-accent/80 border-primary")}>
                            <RadioGroupItem value="pairs" id="mode-pairs" className="sr-only" />
                            <Group className="mb-2"/>
                            Parejas ya formadas
                        </Label>
                    </RadioGroup>
                </div>
            )}

            <div className="grid gap-3">
                 <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                    {participants.map((participant, index) => (
                        <div key={index} className="flex items-start gap-2">
                            <Label htmlFor={playerMode === 'individuals' ? `participant-${index}` : `p1-participant-${index}`} className="text-sm text-muted-foreground w-10 text-right pt-2">
                                {index + 1}.
                            </Label>
                             <div className="flex-grow grid gap-2">
                                {playerMode === 'individuals' ? (
                                    <Input 
                                        id={`participant-${index}`}
                                        value={participant as string}
                                        onChange={(e) => handleParticipantChange(index, e.target.value)}
                                        placeholder={`Nombre del ${participantLabel} ${index + 1}`}
                                    />
                                ) : (
                                    <div className="grid grid-cols-2 gap-2">
                                         <Input 
                                            id={`p1-participant-${index}`}
                                            value={(participant as { player1: string, player2: string }).player1}
                                            onChange={(e) => handleParticipantChange(index, e.target.value, 'player1')}
                                            placeholder={`Jugador 1`}
                                        />
                                         <Input 
                                            id={`p2-participant-${index}`}
                                            value={(participant as { player1: string, player2: string }).player2}
                                            onChange={(e) => handleParticipantChange(index, e.target.value, 'player2')}
                                            placeholder={`Jugador 2`}
                                        />
                                    </div>
                                )}
                             </div>
                            <Button variant="ghost" size="icon" aria-label={`Eliminar ${participantLabel} ${index + 1}`} onClick={() => removeParticipant(index)} disabled={participants.length <= 2}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                 </div>

                <Button variant="outline" onClick={addParticipant} className="mt-4">
                    <PlusCircle className="mr-2 h-4 w-4"/>
                    Añadir {participantLabel}
                </Button>
            </div>
            <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4"/>
                    Volver
                </Button>
                <Button onClick={handleNext} disabled={!canGoNext}>
                    Siguiente <ArrowRight className="ml-2 h-4 w-4"/>
                </Button>
            </div>
        </div>
    )
}

interface DrawTypeStepProps {
    formData: Partial<GenerateDrawInput>;
    onGenerate: (options: Partial<GenerateDrawInput>) => void;
    onBack: () => void;
}

const DrawTypeStep = ({ formData, onGenerate, onBack }: DrawTypeStepProps) => {
    const isPredefinedPairs = !!formData.predefinedPairs;
    const [drawType, setDrawType] = useState<GenerateDrawInput['drawType']>(isPredefinedPairs ? 'individuals' : 'individuals');
    const [numGroups, setNumGroups] = useState(2);
    const [randomizePairs, setRandomizePairs] = useState(true);

    const playersCount = formData.participants?.length || formData.predefinedPairs?.length || 0;

    const handleGenerate = () => {
        let options: Partial<GenerateDrawInput> = { drawType };
        if (drawType === 'groups') {
            if (numGroups < 2 || numGroups > playersCount / 2) {
                // Add toast notification
                return;
            }
            options.numGroups = numGroups;
        }
        if (drawType === 'pairs') {
             options.randomizePairs = randomizePairs;
        }
        onGenerate(options);
    };
    
    const canCreateGroups = playersCount >= 4;
    const canCreatePairs = (formData.participants?.length || 0) >= 2;

    return (
        <div>
            <h3 className="font-semibold text-lg mb-4">3. Elige el formato del sorteo</h3>
            <RadioGroup value={drawType} onValueChange={(value) => setDrawType(value as any)} className="gap-4">
                 <Label htmlFor="individuals" className={cn("flex flex-col items-start gap-2 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors", drawType === 'individuals' && "bg-accent/80 border-primary")}>
                    <div className="flex items-center gap-3">
                        <RadioGroupItem value="individuals" id="individuals" />
                        <div className="flex items-center gap-2 font-bold"><GitMerge /> Eliminación Directa</div>
                    </div>
                    <p className="text-sm text-muted-foreground ml-8">Crea un cuadro de enfrentamientos directos. Ideal para torneos individuales o con equipos/parejas ya formadas.</p>
                </Label>
                
                <Label htmlFor="pairs" className={cn("flex flex-col items-start gap-2 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors", drawType === 'pairs' && "bg-accent/80 border-primary", !canCreatePairs && "opacity-50 cursor-not-allowed")}>
                    <div className="flex items-center gap-3">
                        <RadioGroupItem value="pairs" id="pairs" disabled={!canCreatePairs} />
                        <div className="flex items-center gap-2 font-bold"><Shuffle /> Formar Parejas</div>
                    </div>
                     <p className="text-sm text-muted-foreground ml-8">Agrupa a los jugadores en parejas al azar. ¡Perfecto para Pádel y Tenis!</p>
                </Label>

                 <Label htmlFor="groups" className={cn("flex flex-col items-start gap-2 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors", drawType === 'groups' && "bg-accent/80 border-primary", !canCreateGroups && "opacity-50 cursor-not-allowed")}>
                    <div className="flex items-center gap-3">
                        <RadioGroupItem value="groups" id="groups" disabled={!canCreateGroups} />
                        <div className="flex items-center gap-2 font-bold"><Group /> Crear Grupos</div>
                    </div>
                    <p className="text-sm text-muted-foreground ml-8">Divide a los participantes en un número determinado de grupos.</p>
                     {drawType === 'groups' && canCreateGroups && (
                        <div className="ml-8 mt-4 grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="num-groups">Número de grupos</Label>
                            <Input 
                                type="number" 
                                id="num-groups" 
                                value={numGroups}
                                onChange={(e) => setNumGroups(Math.max(2, parseInt(e.target.value, 10)))}
                                min="2"
                                max={Math.floor(playersCount / 2)}
                                className="w-24"
                            />
                        </div>
                    )}
                </Label>
            </RadioGroup>
            <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={onBack}>Volver</Button>
                <Button onClick={handleGenerate}>
                    Generar Sorteo <ArrowRight className="ml-2 h-4 w-4"/>
                </Button>
            </div>
        </div>
    )
}

// --- Result Components ---

type Team = { id: string; name: string };
type Match = { id: string; teams: (Team | string)[] };

const Matchup = ({ match }: { match: Match }) => (
    <li className="relative flex flex-col justify-center">
        <div className="relative z-10 flex flex-col space-y-2">
            <div className="flex h-10 items-center rounded-md border bg-background px-3 text-sm font-medium">
                {typeof match.teams[0] === 'string' ? match.teams[0] : match.teams[0].name}
            </div>
            <div className="flex h-10 items-center rounded-md border bg-background px-3 text-sm font-medium">
                {typeof match.teams[1] === 'string' ? match.teams[1] : match.teams[1].name}
            </div>
        </div>
        {/* Bracket Lines */}
        <div className="absolute left-full top-1/2 h-full w-6">
            <div className="absolute top-1/4 h-px w-full bg-border -translate-y-px"></div>
            <div className="absolute bottom-1/4 h-px w-full bg-border translate-y-px"></div>
            <div className="absolute left-0 top-1/4 h-1/2 w-px bg-border"></div>
        </div>
        <div className="absolute left-[calc(100%+1.5rem)] top-1/2 w-6 h-px bg-border -translate-y-1/2"></div>
    </li>
);

const Bye = ({ team }: { team: Team }) => (
    <li className="relative flex flex-col justify-center">
        <div className="relative z-10 flex h-10 items-center rounded-md border bg-secondary px-3 text-sm font-semibold">
            {team.name}
        </div>
        <div className="absolute left-full top-1/2 w-6 h-px bg-border -translate-y-1/2"></div>
        <div className="absolute left-[calc(100%+1.5rem)] top-1/2 w-6 h-px bg-border -translate-y-1/2"></div>
        <div className="absolute left-[calc(100%+3rem)] top-1/2 flex h-10 items-center rounded-md border bg-background px-3 text-sm font-medium w-48">
            {team.name}
        </div>
    </li>
);

interface ResultStepProps {
    result: GenerateDrawOutput | null;
    onReset: () => void;
    onReshuffle: () => void;
}

const ResultStep = ({ result, onReset, onReshuffle }: ResultStepProps) => {
    if (!result) {
        return (
            <div className="text-center">
                <p>No se pudo generar el sorteo. Inténtalo de nuevo.</p>
                <Button onClick={onReset} className="mt-4">Volver</Button>
            </div>
        );
    }
    
    const { type, value } = result.draw;
    const handleExport = () => {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sorteo-pediturno-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="font-bold text-xl">¡Sorteo Generado con Éxito!</h3>
                    <p className="text-xs text-muted-foreground">Sorteo aleatorio de grupos, parejas o cruces iniciales. Exportá el resultado para conservarlo.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={handleExport} size="sm" className="gap-2">
                        <Download className="h-4 w-4" />
                        Exportar JSON
                    </Button>
                    <Button onClick={onReshuffle} size="sm" variant="outline" className="gap-2">
                        <Shuffle className="h-4 w-4 text-primary" />
                        Re-sortear
                    </Button>
                </div>
            </div>

            {type === 'groups' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {value.map(group => (
                        <Card key={group.id}>
                            <CardHeader>
                                <CardTitle>{group.name}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {group.teams.map(team => (
                                        <li key={team.id} className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                            <span>{(team as Team).name}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {type === 'pairs' && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {value.map((pair, index) => (
                        <Card key={pair.id} className="bg-secondary/50">
                            <CardHeader>
                               <CardTitle className="text-base">
                                   {pair.players.length > 1 ? `Pareja ${index + 1}` : `Equipo ${index + 1}`}
                               </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2 font-medium">
                                     {pair.players.map(player => (
                                        <li key={player.id}>{player.name}</li>
                                     ))}
                                </ul>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
            
            {type === 'direct-elimination' && (
                 <div className="flex justify-center overflow-x-auto p-4">
                    <div className="flex space-x-24">
                        <ul className="space-y-12">
                            {value.map(match => (
                                typeof match.teams[1] === 'string' && match.teams[1] === 'BYE' ? (
                                    <Bye key={match.id} team={match.teams[0] as Team} />
                                ) : (
                                    <Matchup key={match.id} match={match as Match} />
                                )
                            ))}
                        </ul>
                         {/* Placeholder for next round */}
                        <ul className="space-y-24 pt-12">
                           {Array.from({ length: Math.ceil(value.length / 2) }).map((_, i) => (
                               <li key={i} className="relative flex flex-col justify-center">
                                  <div className="relative z-10 flex h-10 items-center rounded-md border bg-background px-3 text-sm font-medium w-48">
                                     Ganador Partido {i*2 + 1}
                                  </div>
                               </li>
                           ))}
                        </ul>
                    </div>
                </div>
            )}

            <div className="text-center mt-8">
                <Button onClick={onReset} variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Crear un nuevo sorteo
                </Button>
            </div>
        </div>
    )
}

// --- Main Wizard Component ---

export default function DrawWizard() {
  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();
  const [step, setStep] = useState<WizardStep>("courtType");
  const [formData, setFormData] = useState<Partial<GenerateDrawInput>>({});
  const [result, setResult] = useState<GenerateDrawOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleNextStep = (data: Partial<GenerateDrawInput>) => {
    const newFormData = { ...formData, ...data };
    setFormData(newFormData);

    if (step === "courtType") {
      setStep("players");
    } else if (step === "players") {
      setStep("drawType");
    } else if (step === "drawType") {
      handleSubmit(newFormData);
    }
  };

  const handlePrevStep = () => {
    if (step === "players") {
      setStep("courtType");
    } else if (step === "drawType") {
      setStep("players");
    } else if (step === "result") {
        setResult(null);
        setStep("drawType");
    }
  };
  
  const handleReset = () => {
      setStep("courtType");
      setFormData({});
      setResult(null);
  }
  
  const handleSubmit = async (finalData: Partial<GenerateDrawInput>) => {
      setIsLoading(true);
      try {
          // Instant, 100% fair algorithmic draw without external AI or network calls
          const response = generateAlgorithmicDraw(finalData as GenerateDrawInput);
          setResult(response);
          setStep("result");
      } catch (error) {
          console.error("Failed to generate draw:", error);
          toast({
              variant: "destructive",
              title: "Error en el sorteo",
              description: "No se pudo generar el sorteo. Revisa los datos de los participantes.",
          });
      } finally {
          setIsLoading(false);
      }
  }

  const renderStep = () => {
    switch (step) {
      case "courtType":
        return <CourtTypeStep onSelect={(courtType) => handleNextStep({ courtType })} />;
      case "players":
        return <PlayersStep onNext={(data) => handleNextStep(data)} onBack={handlePrevStep} courtType={formData.courtType!} />;
      case "drawType":
        return <DrawTypeStep formData={formData} onGenerate={(options) => handleNextStep(options)} onBack={handlePrevStep} />;
      case "result":
        return <ResultStep result={result} onReset={handleReset} onReshuffle={() => handleSubmit(formData)} />;
      default:
        return <CourtTypeStep onSelect={(courtType) => handleNextStep({ courtType })} />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asistente de Sorteo</CardTitle>
        <CardDescription>
          Sigue los pasos para configurar y generar tu sorteo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={shouldReduceMotion ? false : { opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={shouldReduceMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
          >
            {isLoading ? (
                <div className="flex flex-col justify-center items-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="mt-4 text-muted-foreground">Generando sorteo...</p>
                </div>
            ) : (
                renderStep()
            )}
          </motion.div>
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
