"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth"
import { getVerticalFromBusinessType, getVerticalOrigin, type ProductVertical } from '@/lib/verticals'
import { auth, ensureFirebaseReady } from "@/lib/firebase"
import { useFirebaseReady } from "@/hooks/useFirebaseReady"
import { FirebaseReadinessNotice } from "@/components/FirebaseReadinessNotice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Mail, Lock, User, Sparkles, ArrowLeft, CheckCircle2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { updateBusinessProfile, getBusinessProfile } from "@/services/data"

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" {...props}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.42-4.55H24v8.51h12.8c-.57 2.76-2.26 5.14-4.64 6.79l7.98 6.19C45.02 39.1 48 32.16 48 24c0-.11 0-.22-.02-.33z"></path>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.98-6.19c-2.11 1.42-4.82 2.26-7.91 2.26-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
    <path fill="none" d="M0 0h48v48H0z"></path>
  </svg>
)

interface AuthFormProps {
  onSuccess: () => void;
  initialTab?: "login" | "register";
  initialVertical?: ProductVertical;
}

type PendingSignup = {
  name: string;
  vertical: ProductVertical;
  verificationSentAt?: number;
};

const pendingSignupKey = (uid: string) => `pediturno_pending_signup:${uid}`;

function readPendingSignup(uid: string): PendingSignup | null {
  try {
    const value = sessionStorage.getItem(pendingSignupKey(uid));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PendingSignup>;
    if (typeof parsed.name !== "string" || !["services", "sports_facility", "spaces"].includes(parsed.vertical || "")) return null;
    return parsed as PendingSignup;
  } catch {
    return null;
  }
}

function writePendingSignup(uid: string, value: PendingSignup) {
  sessionStorage.setItem(pendingSignupKey(uid), JSON.stringify(value));
}

export default function AuthForm({
  onSuccess,
  initialTab = "login",
  initialVertical = "services",
}: AuthFormProps) {
  const connection = useFirebaseReady()
  const [activeTab, setActiveTab] = useState<"login" | "register">(initialTab)
  const [isLoading, setIsLoading] = useState(false)
  const [isResetMode, setIsResetMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [verificationUser, setVerificationUser] = useState<FirebaseUser | null>(null)
  const [verificationCooldown, setVerificationCooldown] = useState(0)
  const [completionUser, setCompletionUser] = useState<FirebaseUser | null>(null)

  // Login form states
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")

  // Registration form states
  const [registerName, setRegisterName] = useState("")
  const [registerEmail, setRegisterEmail] = useState("")
  const [registerPassword, setRegisterPassword] = useState("")
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("")
  const registerVertical = initialVertical
  const isSports = initialVertical === "sports_facility"
  const isSpaces = initialVertical === "spaces"
  const [wrongPortal, setWrongPortal] = useState<ProductVertical | null>(null)

  // Password reset state
  const [resetEmail, setResetEmail] = useState("")

  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (!connection.ready || !auth) return;
    let active = true;
    let latestUid: string | null = null;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      latestUid = user?.uid || null;
      if (!user) return;
      const pending = readPendingSignup(user.uid);
      if (!pending) return;
      void getBusinessProfile(user.uid).then((profile) => {
        if (!active || latestUid !== user.uid || profile) return;
        setVerificationUser(user);
        const elapsedSeconds = pending.verificationSentAt
          ? Math.floor((Date.now() - pending.verificationSentAt) / 1000)
          : 60;
        setVerificationCooldown(user.emailVerified ? 0 : Math.max(0, 60 - elapsedSeconds));
      }).catch(() => {
        // The login form will retry the profile lookup on the next explicit action.
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [connection.ready]);

  useEffect(() => {
    if (!verificationUser || verificationCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setVerificationCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verificationCooldown, verificationUser]);

  const mapAuthError = (error: any): string => {
    if (error?.code?.startsWith("app-check/") || ["auth/invalid-app-credential", "auth/app-not-authorized", "auth/missing-app-credential"].includes(error?.code)) {
      return "No pudimos verificar el acceso seguro. Revisá tu conexión y volvé a intentar."
    }
    switch (error?.code) {
      case "auth/invalid-email":
        return "El formato del correo electrónico no es válido."
      case "auth/user-disabled":
        return "Esta cuenta ha sido inhabilitada."
      case "auth/user-not-found":
        return "No existe una cuenta registrada con este correo."
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Correo electrónico o contraseña incorrectos."
      case "auth/email-already-in-use":
        return "Ya existe una cuenta con este correo. Inicia sesión en su lugar."
      case "auth/weak-password":
        return "La contraseña debe tener un mínimo de 6 caracteres."
      case "auth/too-many-requests":
        return "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo."
      case "auth/popup-closed-by-user":
        return ""
      default:
        return error?.message || "Ocurrió un error. Por favor inténtalo más tarde."
    }
  }

  const checkUserStatusAndRedirect = async (
    user: FirebaseUser,
    options: { createProfileIfMissing?: boolean; vertical?: ProductVertical } = {},
  ) => {
    const profile = await getBusinessProfile(user.uid)

    if (!profile) {
      const pending = readPendingSignup(user.uid)
      if (!user.emailVerified && pending) {
        setVerificationUser(user)
        const elapsedSeconds = pending.verificationSentAt
          ? Math.floor((Date.now() - pending.verificationSentAt) / 1000)
          : 60
        setVerificationCooldown(Math.max(0, 60 - elapsedSeconds))
        return
      }

      if (!options.createProfileIfMissing && !pending) {
        setCompletionUser(user)
        setRegisterEmail(user.email || "")
        setRegisterName(user.displayName || user.email?.split("@")[0] || "")
        setActiveTab("register")
        toast({
          title: "Completá la creación de tu cuenta",
          description: "Tu acceso ya existe. Confirmá el nombre para crear el negocio en este portal sin registrarte otra vez.",
        })
        return
      }

      const signup = pending || {
        name: user.displayName ?? user.email?.split("@")[0] ?? "Mi Negocio",
        vertical: options.vertical ?? initialVertical,
      }
      const { created } = await updateBusinessProfile(user.uid, {
        email: user.email ?? "",
        name: signup.name,
        logo: user.photoURL ?? "",
        businessType: signup.vertical,
      })
      if (created) {
        const { heroAssignment, trackPublicEvent } = await import('@/lib/public-analytics')
        trackPublicEvent('business_created', { vertical: signup.vertical, variant: heroAssignment(signup.vertical) })
      }
      if (pending) sessionStorage.removeItem(pendingSignupKey(user.uid))
    } else if (profile.status === "blocked") {
      if (auth) await signOut(auth)
      toast({
        variant: "destructive",
        title: "Cuenta Bloqueada",
        description: "Tu cuenta ha sido suspendida.",
      })
      return
    }

    if (profile && profile.businessType !== 'hybrid' && getVerticalFromBusinessType(profile.businessType) !== initialVertical) {
      if (auth) await signOut(auth)
      setWrongPortal(getVerticalFromBusinessType(profile.businessType))
      return
    }
    router.push("/dashboard")
    onSuccess()
  }

  const finishVerifiedSignup = async () => {
    if (!verificationUser) return
    setIsLoading(true)
    try {
      await ensureFirebaseReady()
      await verificationUser.reload()
      if (!verificationUser.emailVerified) {
        toast({
          variant: "destructive",
          title: "El correo todavía no está verificado",
          description: "Abrí el enlace que enviamos a tu correo y después volvé a comprobar.",
        })
        return
      }

      await verificationUser.getIdToken(true)
      const pending = readPendingSignup(verificationUser.uid)
      if (!pending) {
        toast({
          variant: "destructive",
          title: "No pudimos recuperar el alta",
          description: "Volvé a Crear cuenta para elegir el nombre y la modalidad del negocio.",
        })
        return
      }

      await checkUserStatusAndRedirect(verificationUser, {
        createProfileIfMissing: true,
        vertical: pending.vertical,
      })
      sessionStorage.removeItem(pendingSignupKey(verificationUser.uid))
      toast({ title: "Correo verificado", description: "Tu cuenta ya está lista para configurar Pediturno." })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "No pudimos comprobar el correo",
        description: mapAuthError(error),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const resendVerification = async () => {
    if (!verificationUser || verificationCooldown > 0) return
    setIsLoading(true)
    try {
      await ensureFirebaseReady()
      await sendEmailVerification(verificationUser, { url: `${getVerticalOrigin(initialVertical)}/?login=1` })
      const pending = readPendingSignup(verificationUser.uid)
      if (pending) writePendingSignup(verificationUser.uid, { ...pending, verificationSentAt: Date.now() })
      setVerificationCooldown(60)
      toast({ title: "Correo reenviado", description: "Revisá también la carpeta de spam." })
    } catch (error: any) {
      toast({ variant: "destructive", title: "No pudimos reenviar el correo", description: mapAuthError(error) })
    } finally {
      setIsLoading(false)
    }
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginEmail || !loginPassword) {
      toast({
        variant: "destructive",
        title: "Campos incompletos",
        description: "Por favor ingresa tu correo y contraseña.",
      })
      return
    }

    setIsLoading(true)
    try {
      await ensureFirebaseReady()
      if (!auth) throw new Error("Firebase Auth no inicializado")
      const cred = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword)
      await checkUserStatusAndRedirect(cred.user)
    } catch (error: any) {
      const msg = mapAuthError(error)
      if (msg) {
        toast({
          variant: "destructive",
          title: "Error al iniciar sesión",
          description: msg,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!registerName.trim() || (!completionUser && (!registerEmail.trim() || !registerPassword))) {
      toast({
        variant: "destructive",
        title: "Campos incompletos",
        description: "Por favor completa todos los campos requeridos.",
      })
      return
    }

    if (!completionUser && registerPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "Contraseña débil",
        description: "La contraseña debe tener al menos 6 caracteres.",
      })
      return
    }

    if (!completionUser && registerPassword !== registerConfirmPassword) {
      toast({
        variant: "destructive",
        title: "Las contraseñas no coinciden",
        description: "Asegúrate de escribir la misma contraseña en ambos campos.",
      })
      return
    }

    setIsLoading(true)
    try {
      await ensureFirebaseReady()
      if (!auth) throw new Error("Firebase Auth no inicializado")
      const user = completionUser || (await createUserWithEmailAndPassword(auth, registerEmail.trim(), registerPassword)).user
      
      // Update display name
      await updateProfile(user, { displayName: registerName.trim() })

      const pending: PendingSignup = {
        name: registerName.trim(),
        vertical: registerVertical,
      }
      writePendingSignup(user.uid, pending)
      setCompletionUser(null)
      setVerificationCooldown(0)

      if (user.emailVerified) {
        await checkUserStatusAndRedirect(user, { createProfileIfMissing: true, vertical: registerVertical })
      } else {
        setVerificationUser(user)
        try {
          await sendEmailVerification(user, { url: `${getVerticalOrigin(initialVertical)}/?login=1` })
          writePendingSignup(user.uid, { ...pending, verificationSentAt: Date.now() })
          setVerificationCooldown(60)
          toast({ title: "Verificá tu correo", description: "Te enviamos un enlace para activar la cuenta." })
        } catch (verificationError: any) {
          setVerificationCooldown(0)
          toast({
            variant: "destructive",
            title: "La cuenta se creó, pero el correo no salió",
            description: `${mapAuthError(verificationError)} Podés reenviarlo desde esta pantalla.`,
          })
        }
      }
    } catch (error: any) {
      const msg = mapAuthError(error)
      if (msg) {
        toast({
          variant: "destructive",
          title: "Error al registrarse",
          description: msg,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail.trim()) {
      toast({
        variant: "destructive",
        title: "Ingresa tu correo",
        description: "Por favor escribe el correo con el que te registraste.",
      })
      return
    }

    setIsLoading(true)
    try {
      await ensureFirebaseReady()
      if (!auth) throw new Error("Firebase Auth no inicializado")
      await sendPasswordResetEmail(auth, resetEmail.trim(), { url: `${getVerticalOrigin(initialVertical)}/?login=1` })
      setResetSent(true)
      toast({
        title: "Correo enviado",
        description: "Te enviamos las instrucciones para restablecer tu contraseña.",
      })
    } catch (error: any) {
      const msg = mapAuthError(error)
      toast({
        variant: "destructive",
        title: "Error al recuperar contraseña",
        description: msg,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    if (!connection.ready) return
    setIsLoading(true)
    const provider = new GoogleAuthProvider()
    try {
      if (!auth) throw new Error("Auth not initialized")
      const result = await signInWithPopup(auth, provider)
      const isRegistration = activeTab === "register"

      await checkUserStatusAndRedirect(result.user, {
        createProfileIfMissing: isRegistration,
        vertical: registerVertical,
      })
    } catch (error: any) {
      if (error.code !== "auth/popup-closed-by-user") {
        console.error(error)
        toast({
          variant: "destructive",
          title: "Error con Google",
          description: "No se pudo iniciar sesión con Google. Inténtalo más tarde.",
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (wrongPortal) {
    const destination = getVerticalOrigin(wrongPortal)
    const destinationName = wrongPortal === 'sports_facility' ? 'Canchas' : wrongPortal === 'spaces' ? 'Espacios' : 'Servicios'
    return <div className="space-y-4 py-4 text-center" role="status">
      <p className="font-semibold">Tu cuenta pertenece a Pediturno {destinationName}</p>
      <p className="text-sm text-muted-foreground">Abrí el portal de tu cuenta e ingresá allí. Tus datos y reservas se conservan.</p>
      <Button asChild className="w-full"><a href={`${destination}/?login=1`}>Ir a {destinationName}</a></Button>
      <Button variant="ghost" onClick={() => setWrongPortal(null)}>Usar otra cuenta</Button>
    </div>
  }

  if (verificationUser) {
    return (
      <div className="space-y-5 py-4 text-center" aria-live="polite">
        <FirebaseReadinessNotice {...connection} />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Mail className="h-7 w-7" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-xl font-bold">{verificationUser.emailVerified ? "Finalizá tu cuenta" : "Verificá tu correo"}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {verificationUser.emailVerified
              ? <>Tu correo <strong className="text-foreground">{verificationUser.email}</strong> ya está verificado. Confirmá para crear el negocio y activar la prueba.</>
              : <>Abrí el enlace que enviamos a <strong className="text-foreground">{verificationUser.email}</strong>. Recién después crearemos el negocio y activaremos la prueba.</>}
          </p>
        </div>
        <Button type="button" className="w-full" onClick={finishVerifiedSignup} disabled={isLoading || !connection.ready}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Ya verifiqué mi correo
        </Button>
        {!verificationUser.emailVerified && (
          <Button type="button" variant="outline" className="w-full" onClick={resendVerification} disabled={isLoading || !connection.ready || verificationCooldown > 0}>
            Reenviar correo{verificationCooldown > 0 ? ` (${verificationCooldown}s)` : ""}
          </Button>
        )}
        <button
          type="button"
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
          onClick={async () => {
            if (auth) await signOut(auth)
            setVerificationUser(null)
            setCompletionUser(null)
            setActiveTab("login")
          }}
        >
          Usar otra cuenta
        </button>
      </div>
    )
  }

  // View: Password Reset Mode
  if (isResetMode) {
    return (
      <div className="space-y-4 py-2">
        <FirebaseReadinessNotice {...connection} />
        {resetSent ? (
          <div className="text-center py-6 space-y-4">
            <div className="mx-auto w-12 h-12 bg-emerald-100 dark:bg-emerald-950/50 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h4 className="font-semibold text-lg">Revisa tu casilla de correo</h4>
            <p className="text-sm text-muted-foreground">
              Hemos enviado un enlace seguro a <strong>{resetEmail}</strong> para que puedas crear una nueva contraseña.
            </p>
            <p className="text-xs text-muted-foreground">
              Si no lo encuentras en unos minutos, revisa tu carpeta de correo no deseado (Spam).
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsResetMode(false)
                setResetSent(false)
              }}
              className="mt-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Iniciar Sesión
            </Button>
          </div>
        ) : (
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-email">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="ejemplo@tunegocio.com"
                  className="pl-9"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full font-semibold" disabled={isLoading || !connection.ready}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enviar Enlace de Recuperación
            </Button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setIsResetMode(false)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center"
              >
                <ArrowLeft className="mr-1 h-3 w-3" /> Volver al Inicio de Sesión
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
        <FirebaseReadinessNotice {...connection} />
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "login" | "register")} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="login" className="font-semibold">Iniciar Sesión</TabsTrigger>
          <TabsTrigger value="register" className="font-semibold">Crear Cuenta</TabsTrigger>
        </TabsList>

        {/* Tab: Iniciar Sesión */}
        <TabsContent value="login">
          <div className="mb-4 rounded-xl border border-border/80 bg-secondary/40 px-3.5 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{isSpaces ? "Acceso para salones y espacios" : isSports ? "Acceso para canchas y complejos" : "Acceso para servicios y profesionales"}</p>
            <p className="mt-1">{isSpaces ? "Ingresá para administrar tus espacios, paquetes y reservas." : isSports ? "Ingresá para administrar las canchas, horarios y reservas de tu complejo." : "Ingresá para administrar los servicios, horarios y turnos de tu negocio."}</p>
          </div>
          <form onSubmit={handleEmailLogin} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  placeholder="ejemplo@tunegocio.com"
                  className="pl-9"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Contraseña</Label>
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(true)
                    setResetEmail(loginEmail)
                  }}
                  className="text-xs text-foreground hover:underline font-medium"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-9"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full font-semibold mt-2" disabled={isLoading || !connection.ready}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Iniciar Sesión
            </Button>
          </form>
        </TabsContent>

        {/* Tab: Crear Cuenta */}
        <TabsContent value="register">
          <form onSubmit={handleEmailRegister} className="space-y-3">
            {completionUser && (
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-3 text-sm" role="status">
                <p className="font-semibold text-foreground">Tu acceso ya está creado</p>
                <p className="mt-1 text-muted-foreground">
                  Completá el nombre para crear el negocio. No necesitás registrarte ni elegir otra contraseña.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="register-name">Nombre de tu Negocio o Personal</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="register-name"
                  type="text"
                  placeholder={isSpaces ? "Ej. Salón Los Álamos" : isSports ? "Ej. Complejo Los Pinos" : "Ej. Estética San Martín"}
                  className="pl-9"
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="rounded-xl border bg-secondary/40 p-3 text-sm" role="note">
              <p className="font-semibold">{isSpaces ? 'Cuenta para salones y espacios' : isSports ? 'Cuenta para canchas y complejos' : 'Cuenta para servicios y profesionales'}</p>
              <p className="mt-1 text-muted-foreground">Servicios incluye Gratis hasta 40 turnos por mes. Canchas y Espacios conservan su prueba de 15 días. No requiere tarjeta.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="register-email">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="register-email"
                  type="email"
                  placeholder="contacto@tunegocio.com"
                  className="pl-9"
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  autoComplete="email"
                  disabled={!!completionUser}
                  required
                />
              </div>
              {completionUser && <p className="text-[11px] text-muted-foreground">Este correo corresponde a la sesión que acabás de iniciar.</p>}
            </div>

            {!completionUser && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="register-password">Contraseña</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="register-password"
                      type="password"
                      placeholder="Mínimo 6 carácteres"
                      className="pl-9"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="register-confirm">Confirmar</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="register-confirm"
                      type="password"
                      placeholder="Repite la contraseña"
                      className="pl-9"
                      value={registerConfirmPassword}
                      onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full font-semibold mt-2" disabled={isLoading || !connection.ready}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {completionUser ? "Completar cuenta" : "Crear cuenta gratis"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      {!completionUser && (
        <>
          {/* Divider */}
          <div className="relative my-3">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground font-medium">O continúa con</span>
            </div>
          </div>

          {/* Google Login Alternative */}
          <Button 
            variant="outline" 
            className="w-full h-11 text-sm font-medium hover:bg-secondary/80 transition-colors" 
            onClick={handleGoogleLogin} 
            disabled={isLoading || !connection.ready}
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-5 w-5" />}
            {activeTab === "login" ? "Ingresar con Google" : "Crear cuenta con Google"}
          </Button>
        </>
      )}
    </div>
  )
}
