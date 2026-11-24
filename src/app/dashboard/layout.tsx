
"use client"

import { getVerticalFromHost, getVerticalFromBusinessType, getVerticalOrigin } from '@/lib/verticals';

import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset,
  useSidebar,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  LayoutDashboard,
  Calendar,
  Briefcase,
  User,
  LogOut,
  Settings,
  Navigation,
  HelpCircle,
  Users,
  ShieldCheck,
  Mail,
  ShieldAlert,
  UserCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelLeft,
  Trophy,
  Award,
  Building2,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AuthProvider, useAuth } from "@/hooks/useAuthRedirect"
import { Skeleton } from "@/components/ui/skeleton"
import { auth } from "@/lib/firebase"
import { signOut } from "firebase/auth"
import Image from "next/image"
import { useEffect, useState, ReactNode, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import MembershipStatusDisplay from "@/components/MembershipStatusDisplay"
import { ThemeToggle } from "@/components/ui/ThemeToggle"
import { TooltipProvider } from "@/components/ui/tooltip"
import dynamic from 'next/dynamic'
import { getMembershipStatus } from "@/lib/membership-utils"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { ADMIN_EMAILS } from "@/lib/config"
import { initializePushNotifications, unsubscribePushNotifications } from "@/lib/push-client"
import { DashboardProvider, useDashboard } from "@/context/DashboardContext"

const ExpiredMembershipModal = dynamic(() => import('@/components/ExpiredMembershipModal'), { ssr: false });
const NotificationPermissionBanner = dynamic(() => import('@/components/NotificationPermissionBanner'), { ssr: false });
const PwaInstallBanner = dynamic(() => import('@/components/PwaInstallBanner'), { ssr: false });

const MainDashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: authLoading, error: authError, retry: retryAuth } = useAuth();
  const { businessProfile, isProfileLoading } = useDashboard();
  
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);
  const { state, isMobile } = useSidebar();
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);

  const isSports = businessProfile?.businessType === 'sports_facility';
  const isSpaces = businessProfile?.businessType === 'spaces';
  const isHybrid = businessProfile?.businessType === 'hybrid';

  const menuItems = useMemo(() => [
    { href: "/dashboard", icon: <LayoutDashboard />, label: "Inicio", tooltip: "Ver el resumen del negocio" },
    { href: "/dashboard/calendario", icon: <Calendar />, label: "Calendario", tooltip: "Gestionar turnos" },
    ...((isSports || isHybrid) ? [
      { href: "/dashboard/canchas", icon: <Trophy />, label: "Canchas", tooltip: "Administrar canchas y complejos" },
      { href: "/dashboard/sorteador", icon: <Award />, label: "Sorteador", tooltip: "Sorteador de torneos, llaves y fixtures" },
    ] : []),
    ...(isSpaces ? [
      { href: "/dashboard/espacios", icon: <Building2 />, label: "Espacios", tooltip: "Administrar espacios, paquetes y disponibilidad" },
    ] : []),
    ...((!isSports || isHybrid) ? [
      { href: "/dashboard/servicios", icon: <Briefcase />, label: "Servicios", tooltip: "Administrar servicios" },
    ] : []),
    { href: "/dashboard/clientes", icon: <Users />, label: "Clientes", tooltip: "Ver lista de clientes" },
    { href: "/dashboard/mi-negocio", icon: <UserCircle />, label: "Mi Negocio", tooltip: "Configurar página pública" },
    { href: "/dashboard/membresia", icon: <ShieldCheck />, label: "Membresía", tooltip: "Gestionar membresía y pagos" },
    { href: "/dashboard/ajustes", icon: <Settings />, label: "Ajustes", tooltip: "Ajustes de reserva" },
  ], [isSports, isHybrid, isSpaces]);


  useEffect(() => {
    if (!authLoading && !authError && !user) {
      router.push('/');
    }
  }, [user, authLoading, authError, router]);

  useEffect(() => {
    if (isProfileLoading || authLoading) return;

    if (user && businessProfile) {
        const membershipStatus = getMembershipStatus(businessProfile, user.email);
        const isExpired = membershipStatus.status === 'Vencida';
        setShowExpiredModal(isExpired);

        if (isExpired && pathname !== '/dashboard/membresia') {
            router.push('/dashboard/membresia');
        }
        
        initializePushNotifications(user.uid);
    }
  }, [isProfileLoading, authLoading, user, businessProfile, pathname, router]);


  const handleSignOut = async () => {
    if (!auth) {
        console.error("Firebase Auth is not initialized.");
        return;
    }
    try {
      if (user) await unsubscribePushNotifications(user.uid).catch(() => undefined)
      await signOut(auth)
      router.push('/')
    } catch (error) {
      console.error("Error signing out:", error)
    }
  }


  const handleMenuClick = () => {
    setIsMobileSheetOpen(false);
  };

  const isGoogleProvider = user?.providerData.some(p => p.providerId === 'google.com');
  const logo = businessProfile?.logo && !businessProfile.logo.includes('placehold.co') ? businessProfile.logo : null;
  const userImage = isGoogleProvider ? user?.photoURL : logo;
  
  const isAdmin = user?.email ? ADMIN_EMAILS.includes(user.email) : false;
  const membershipStatus = businessProfile && user ? getMembershipStatus(businessProfile, user.email) : null;
  const isMembershipExpired = membershipStatus?.status === 'Vencida';
  const isAllowedPage = pathname === '/dashboard/membresia';
  const shouldBlockContent = isMembershipExpired && !isAllowedPage;


  if (authError) {
    return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 text-center" role="alert">
      <h1 className="text-2xl font-bold">No pudimos preparar tu acceso</h1>
      <p className="text-muted-foreground">{authError}</p>
      <Button onClick={retryAuth}>Volver a intentar</Button>
    </main>;
  }

  if (authLoading || isProfileLoading ) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
         <Skeleton className="h-16 w-16 rounded-full" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (businessProfile && businessProfile.businessType !== 'hybrid' && typeof window !== 'undefined'
      && ['pediturno.com', 'canchas.pediturno.com', 'espacios.pediturno.com'].includes(window.location.hostname)
      && getVerticalFromHost(window.location.hostname) !== getVerticalFromBusinessType(businessProfile.businessType)) {
    const product = getVerticalFromBusinessType(businessProfile.businessType);
    return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">Tu cuenta es de Pediturno {product === 'sports_facility' ? 'Canchas' : product === 'spaces' ? 'Espacios' : 'Servicios'}</h1>
      <p className="text-muted-foreground">Ingresá desde el portal de tu producto para continuar. Tus datos y reservas se conservan.</p>
      <Button asChild><a href={`${getVerticalOrigin(product)}/?login=1`}>Abrir mi portal</a></Button>
    </main>;
  }
  
  return (
    <>
    <div className="flex min-h-screen w-full">
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2 p-2">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-sidebar-foreground">
              <Image src="/favicon.ico" alt="Logo" width={24} height={24} className="rounded" />
              <span className="text-lg font-bold group-data-[collapsible=icon]:hidden">Pediturno</span>
            </Link>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {menuItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.href}
                  tooltip={item.tooltip}
                >
                  <Link href={item.href}>
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
             {isAdmin && (
              <>
                <SidebarSeparator />
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith('/dashboard/admin')}
                    tooltip="Panel de Administrador"
                  >
                    <Link href="/dashboard/admin">
                      <ShieldAlert />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            )}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
           <SidebarMenu>
             <SidebarMenuItem>
               <SidebarMenuButton asChild tooltip="Soporte por correo">
                 <a href="mailto:contacto@pediturno.com?subject=Soporte%20Pediturno">
                   <Mail />
                   <span>Soporte por correo</span>
                 </a>
               </SidebarMenuButton>
             </SidebarMenuItem>
             <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    >
                      <Avatar className="h-8 w-8 rounded-lg">
                        <AvatarImage src={userImage || undefined} alt={user?.displayName || "Usuario"} />
                        <AvatarFallback className="rounded-lg">
                          {user?.displayName ? user.displayName.charAt(0).toUpperCase() : <User />}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                        <span className="truncate font-semibold">{user?.displayName || "Mi Cuenta"}</span>
                        <span className="truncate text-xs">{user?.email}</span>
                      </div>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                    side={isMobile ? "bottom" : "right"}
                    align="end"
                    sideOffset={4}
                  >
                    <DropdownMenuLabel className="p-0 font-normal">
                      <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                        <Avatar className="h-8 w-8 rounded-lg">
                          <AvatarImage src={userImage || undefined} alt={user?.displayName || "Usuario"} />
                          <AvatarFallback className="rounded-lg">
                            {user?.displayName ? user.displayName.charAt(0).toUpperCase() : <User />}
                          </AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-semibold">{user?.displayName || "Mi Cuenta"}</span>
                          <span className="truncate text-xs">{user?.email}</span>
                        </div>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/mi-negocio">
                        <UserCircle className="mr-2 h-4 w-4" />
                        <span>Mi Negocio</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/membresia">
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        <span>Membresía</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/ajustes">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Ajustes</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Cerrar sesión</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
             </SidebarMenuItem>
           </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:px-6">
          <div className="md:hidden">
            <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <PanelLeft className="h-5 w-5" />
                  <span className="sr-only">Toggle Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 flex flex-col">
                <div className="flex h-14 items-center border-b px-4">
                  <Link href="/dashboard" className="flex items-center gap-2 font-semibold" onClick={handleMenuClick}>
                    <Image src="/favicon.ico" alt="Logo" width={24} height={24} className="rounded" />
                    <span className="text-lg font-bold">Pediturno</span>
                  </Link>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {menuItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={handleMenuClick}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        pathname === item.href
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  ))}
                  {isAdmin && (
                    <Link
                      href="/dashboard/admin"
                      onClick={handleMenuClick}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        pathname.startsWith('/dashboard/admin')
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <ShieldAlert className="h-5 w-5" />
                      Admin
                    </Link>
                  )}
                </div>
                <div className="border-t p-4">
                  <a href="mailto:contacto@pediturno.com?subject=Soporte%20Pediturno" className="mb-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Mail className="h-5 w-5" />
                    Soporte por correo
                  </a>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={userImage || undefined} alt="Avatar" />
                      <AvatarFallback>
                        {user?.displayName ? user.displayName.charAt(0).toUpperCase() : <User />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate text-sm font-medium">{user?.displayName || "Mi Cuenta"}</p>
                      <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="hidden md:flex">
            <SidebarTrigger />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/dashboard/membresia">
              <MembershipStatusDisplay profile={businessProfile} userEmail={user?.email} isLoading={isProfileLoading} />
            </Link>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full hidden md:block">
                  {isProfileLoading ? (
                    <Skeleton className="h-10 w-10 rounded-full" />
                  ) : (
                    <Avatar>
                      <AvatarImage src={userImage || undefined} alt="User avatar" />
                      <AvatarFallback>
                        {!userImage ? <HelpCircle className="h-5 w-5 text-muted-foreground" /> : (user?.email?.substring(0, 2).toUpperCase() || 'U')}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!isGoogleProvider && !logo && (
                  <>
                    <DropdownMenuItem onClick={() => setIsProfileModalOpen(true)} className="text-primary focus:bg-primary/10 focus:text-primary">
                      <UserCircle className="mr-2 h-4 w-4" />
                      Completar perfil
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {businessProfile?.slug && (
                  <DropdownMenuItem asChild>
                    <a href={`/${businessProfile.slug}`} target="_blank" rel="noopener noreferrer">
                      <Navigation className="mr-2 h-4 w-4" />
                      Ver mi página
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 relative">
          {pathname !== '/dashboard/ajustes' && <PwaInstallBanner />}
          {pathname !== '/dashboard/ajustes' && <NotificationPermissionBanner />}
          {shouldBlockContent ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
              <h2 className="text-2xl font-bold mb-2">Membresía Vencida</h2>
              <p className="text-muted-foreground max-w-md mb-6">
                Tu período de prueba o suscripción ha vencido. Para seguir usando todas las funciones de Pediturno, por favor renueva tu membresía.
              </p>
              <Button asChild>
                <Link href="/dashboard/membresia">Ver Planes de Membresía</Link>
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
      </SidebarInset>
    </div>
    <AlertDialog open={isProfileModalOpen} onOpenChange={setIsProfileModalOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¡Completa tu perfil!</AlertDialogTitle>
          <AlertDialogDescription>
            Para una mejor experiencia y personalización, te recomendamos que cargues el logo de tu negocio.
            Este logo se mostrará en tu página pública y aquí en tu panel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Más tarde</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Link href="/dashboard/mi-negocio">Ir a Mi Página</Link>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {showExpiredModal && <ExpiredMembershipModal isOpen={showExpiredModal} onOpenChange={setShowExpiredModal} />}
    </>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <SidebarProvider>
        <TooltipProvider>
          <DashboardProvider>
            <MainDashboardLayout>{children}</MainDashboardLayout>
          </DashboardProvider>
        </TooltipProvider>
      </SidebarProvider>
    </AuthProvider>
  )
}
