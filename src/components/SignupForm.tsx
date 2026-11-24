

"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, getAdditionalUserInfo } from "firebase/auth"
import { auth, ensureFirebaseReady } from "@/lib/firebase"
import { useFirebaseReady } from "@/hooks/useFirebaseReady"
import { FirebaseReadinessNotice } from "@/components/FirebaseReadinessNotice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BriefcaseBusiness, Loader2, Trophy } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { updateBusinessProfile } from "@/services/data"
import type { ProductVertical } from "@/lib/verticals"

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" {...props}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.42-4.55H24v8.51h12.8c-.57 2.76-2.26 5.14-4.64 6.79l7.98 6.19C45.02 39.1 48 32.16 48 24c0-.11 0-.22-.02-.33z"></path>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.98-6.19c-2.11 1.42-4.82 2.26-7.91 2.26-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
      <path fill="none" d="M0 0h48v48H0z"></path>
    </svg>
)

interface SignupFormProps {
    onSuccess: () => void;
    initialVertical?: ProductVertical;
}

export default function SignupForm({ onSuccess, initialVertical = "services" }: SignupFormProps) {
  const connection = useFirebaseReady()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [captchaAnswer, setCaptchaAnswer] = useState("")
  const [captchaNumbers, setCaptchaNumbers] = useState({ num1: 0, num2: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [vertical, setVertical] = useState<ProductVertical>(initialVertical)
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    generateNewCaptcha()
  }, [])

  const generateNewCaptcha = () => {
    setCaptchaNumbers({
      num1: Math.floor(Math.random() * 10) + 1,
      num2: Math.floor(Math.random() * 10) + 1,
    })
  }
  
  const handleSuccessfulAuth = async (user: any) => {
    const businessData = {
        email: user.email ?? '',
        name: user.displayName ?? user.email?.split('@')[0] ?? '',
        logo: user.photoURL ?? '',
        businessType: vertical,
    };
    await updateBusinessProfile(user.uid, businessData);
    router.push("/dashboard");
    onSuccess();
  }


  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (password.length < 6) {
        toast({ variant: "destructive", title: "Contraseña muy corta", description: "La contraseña debe tener al menos 6 caracteres." });
        return;
    }

    if (password !== confirmPassword) {
      toast({ variant: "destructive", title: "Error", description: "Las contraseñas no coinciden." });
      return
    }

    const correctAnswer = captchaNumbers.num1 + captchaNumbers.num2;
    if (parseInt(captchaAnswer) !== correctAnswer) {
        toast({ variant: "destructive", title: "Error", description: "La respuesta del anti-bot es incorrecta." });
        generateNewCaptcha();
        setCaptchaAnswer("");
        return;
    }

    setIsLoading(true)
    try {
      await ensureFirebaseReady()
      if (!auth) throw new Error("Auth not initialized");
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await handleSuccessfulAuth(userCredential.user);
    } catch (error: any) {
      console.error(error)
      const errorCode = error.code;
      let description = "Ocurrió un error inesperado. Por favor, intenta de nuevo."
      if (errorCode === 'auth/email-already-in-use') {
          description = "Este correo electrónico ya está registrado. Intenta iniciar sesión."
      } else if (errorCode === 'auth/invalid-email') {
          description = "El formato del correo electrónico no es válido."
      }

      toast({
        variant: "destructive",
        title: "Error al registrarse",
        description: description,
      })
      generateNewCaptcha();
      setCaptchaAnswer("");
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignUp = async () => {
    if (!connection.ready) return
    setIsGoogleLoading(true);
    const provider = new GoogleAuthProvider();
    try {
        if (!auth) throw new Error("Auth not initialized");
        const result = await signInWithPopup(auth, provider);
        const additionalInfo = getAdditionalUserInfo(result);
       
        if (additionalInfo?.isNewUser) {
            await handleSuccessfulAuth(result.user);
        } else {
            router.push("/dashboard"); 
            onSuccess();
        }
    } catch (error: any) {
        console.error(error);
        toast({
            variant: "destructive",
            title: "Error con Google",
            description: "No se pudo iniciar sesión con Google. Inténtalo más tarde.",
        });
    } finally {
        setIsGoogleLoading(false);
    }
  }

  return (
    <div className="grid gap-4">
        <FirebaseReadinessNotice {...connection} />
        <Button variant="outline" className="w-full" onClick={handleGoogleSignUp} disabled={isLoading || isGoogleLoading || !connection.ready}>
        {isGoogleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-6 w-6" />}
        Continuar con Google
        </Button>
        <div className="relative">
            <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                O continuar con
                </span>
            </div>
        </div>
        <form onSubmit={handleSignUp} className="grid gap-4">
            <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">¿Qué vas a gestionar?</legend>
                <div className="grid grid-cols-3 gap-2">
                    <button
                        type="button"
                        aria-pressed={vertical === "services"}
                        onClick={() => setVertical("services")}
                        className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${vertical === "services" ? "border-primary bg-primary/10" : "border-border text-muted-foreground"}`}
                    >
                        <BriefcaseBusiness className="mb-1 h-4 w-4 text-primary" />
                        <span className="block text-sm font-semibold">Servicios</span>
                    </button>
                    <button
                        type="button"
                        aria-pressed={vertical === "sports_facility"}
                        onClick={() => setVertical("sports_facility")}
                        className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${vertical === "sports_facility" ? "border-emerald-500 bg-emerald-500/10" : "border-border text-muted-foreground"}`}
                    >
                        <Trophy className="mb-1 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="block text-sm font-semibold">Canchas</span>
                    </button>
                    <button
                        type="button"
                        aria-pressed={vertical === "spaces"}
                        onClick={() => setVertical("spaces")}
                        className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${vertical === "spaces" ? "border-amber-500 bg-amber-500/10" : "border-border text-muted-foreground"}`}
                    >
                        <BriefcaseBusiness className="mb-1 h-4 w-4 text-amber-600" />
                        <span className="block text-sm font-semibold">Espacios</span>
                    </button>
                </div>
            </fieldset>
            <div className="grid gap-2">
                <Label htmlFor="email-signup">Email</Label>
                <Input
                id="email-signup"
                type="email"
                placeholder="tu@email.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={isGoogleLoading}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="password-signup">Contraseña (mín. 6 caracteres)</Label>
                <Input 
                id="password-signup" 
                type="password" 
                required 
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={isGoogleLoading}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="confirm-password">Confirmar Contraseña</Label>
                <Input 
                id="confirm-password" 
                type="password" 
                required 
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={isGoogleLoading}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="captcha">Anti-bot: ¿Cuánto es {captchaNumbers.num1} + {captchaNumbers.num2}?</Label>
                <Input
                    id="captcha"
                    type="number"
                    required
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    disabled={isGoogleLoading}
                />
            </div>
            <Button className="w-full mt-2" type="submit" disabled={isLoading || isGoogleLoading || !connection.ready}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear Cuenta Gratis
            </Button>
        </form>
    </div>
  )
}
