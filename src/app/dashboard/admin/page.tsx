

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useAuth } from "@/hooks/useAuthRedirect"
import { useRouter } from "next/navigation"
import { getAllBusinesses, BusinessProfile, updateBusinessMembership, Membership } from "@/services/data"
import { getMembershipStatus } from "@/lib/membership-utils"
import { useToast } from "@/hooks/use-toast"
import { ShieldAlert, Users, MoreHorizontal, Loader2, MinusCircle, PlusCircle, Trash2, CheckCircle, XCircle, UserX, UserCheck, Wrench, Clock, UserCog } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { addDays, addMonths } from "date-fns"
import Link from 'next/link'

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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import DeliveryHealth from '@/components/admin/DeliveryHealth';
import { ADMIN_EMAILS } from "@/lib/config"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"


interface RegisteredUser extends BusinessProfile {
    id: string;
    email: string;
}

const UserStatusBadge = ({ user }: { user: RegisteredUser }) => {
    if (user.status === 'blocked') {
        return <Badge variant="destructive" className="bg-red-700 text-white">Bloqueado</Badge>;
    }
    return <Badge variant="secondary" className="bg-green-100 text-green-800">Activo</Badge>;
};


const MembershipStatusBadge = ({ user }: { user: RegisteredUser }) => {
    // Blocked status takes precedence over membership status for display.
    if (user.status === 'blocked') {
        return <Badge variant="destructive" className="bg-red-700 text-white">Bloqueado</Badge>;
    }
    
    const membershipInfo = getMembershipStatus(user, user.email);

    switch (membershipInfo.status) {
        case 'De por vida':
             return <Badge className="bg-purple-100 text-purple-900 border-purple-300">De por vida</Badge>;
        case 'Activa':
            return (
                 <Badge variant="secondary" className="border-green-300 bg-green-100 text-green-900">
                    Activa ({membershipInfo.daysLeft}d)
                </Badge>
            );
        case 'En Prueba':
             return (
                <Badge variant="secondary" className="border-blue-300 bg-blue-100 text-blue-900">
                    En Prueba ({membershipInfo.daysLeft}d)
                </Badge>
            );
        case 'Vencida':
            return <Badge variant="destructive">Vencida</Badge>;
        default:
             return <Badge variant="outline">Desconocido</Badge>;
    }
}

interface Stats {
    totalUsers: number;
    activeSubscriptions: number;
    trialUsers: number;
    membershipDistribution: {
        active: number;
        trial: number;
        lifetime: number;
        expired: number;
    };
}

type PaymentReview = { orderId: string; businessId: string; paymentId: string; status: string; reason: string; source?: 'reconciliation' };


export default function AdminPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [users, setUsers] = useState<RegisteredUser[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [paymentReviews, setPaymentReviews] = useState<PaymentReview[] | null>(null);
    const [paymentReviewsError, setPaymentReviewsError] = useState(false);
    const [paymentReviewsMore, setPaymentReviewsMore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState<string | null>(null);
    
    const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<RegisteredUser | null>(null);

    const [modalTitle, setModalTitle] = useState("");
    const [modalUsers, setModalUsers] = useState<RegisteredUser[]>([]);
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);

    const isAdmin = user?.email ? ADMIN_EMAILS.includes(user.email) : false;

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        try {
            const businessUsers = await getAllBusinesses();
            setUsers(businessUsers as RegisteredUser[]);
        } catch (error) {
            console.error("Failed to fetch users:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudieron cargar los usuarios.",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);
    
    useEffect(() => {
        if (!loading && users.length > 0) {
            const calculatedStats: Stats = {
                totalUsers: users.length,
                activeSubscriptions: 0,
                trialUsers: 0,
                membershipDistribution: { active: 0, trial: 0, lifetime: 0, expired: 0 },
            };

            users.forEach(u => {
                const membershipInfo = getMembershipStatus(u, u.email);
                switch (membershipInfo.status) {
                    case 'Activa':
                        calculatedStats.membershipDistribution.active++;
                        break;
                    case 'En Prueba':
                        calculatedStats.membershipDistribution.trial++;
                        break;
                    case 'De por vida':
                        calculatedStats.membershipDistribution.lifetime++;
                        break;
                    case 'Vencida':
                        calculatedStats.membershipDistribution.expired++;
                        break;
                }
            });
            
            calculatedStats.activeSubscriptions = calculatedStats.membershipDistribution.active;
            calculatedStats.trialUsers = calculatedStats.membershipDistribution.trial;
            setStats(calculatedStats);
        }
    }, [users, loading]);

    useEffect(() => {
        if (loading) return;
        
        if (!isAdmin) {
            router.push('/dashboard');
        } else {
            fetchUsers();
        }
    }, [user, loading, isAdmin, router, fetchUsers]);

    useEffect(() => {
        if (!isAdmin || !user) return;
        let cancelled = false;
        user.getIdToken().then(token => fetch('/api/admin/payment-reviews', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        })).then(async response => {
            if (!response.ok) throw new Error('Payment review query failed');
            return response.json() as Promise<{ reviews: PaymentReview[]; more: boolean }>;
        }).then(result => {
            if (!cancelled) {
                setPaymentReviews(result.reviews);
                setPaymentReviewsMore(result.more);
                setPaymentReviewsError(false);
            }
        }).catch(() => { if (!cancelled) setPaymentReviewsError(true); });
        return () => { cancelled = true; };
    }, [isAdmin, user]);
    
    const handleOpenUserModal = (title: string, filterFn: (user: RegisteredUser) => boolean) => {
        setModalTitle(title);
        setModalUsers(users.filter(filterFn));
        setIsUserModalOpen(true);
    };

    const handleUpdateMembership = async (userId: string, newMembership: Partial<Membership>) => {
        setIsUpdating(userId);
        try {
            await updateBusinessMembership(userId, newMembership);
            toast({
                title: "¡Éxito!",
                description: `La membresía del usuario ha sido actualizada.`
            });
            await fetchUsers();
        } catch (error) {
             console.error("Failed to update membership:", error);
            toast({ variant: "destructive", title: "Error", description: "No se pudo actualizar la membresía." });
        } finally {
            setIsUpdating(null);
        }
    };
    
    const handleUpdateStatus = async (userId: string, status: 'active' | 'blocked') => {
        setIsUpdating(userId);
        try {
            if (!user) throw new Error('Authentication required');
            const token = await user.getIdToken();
            const response = await fetch('/api/admin/business-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ businessId: userId, status }),
            });
            if (!response.ok) throw new Error('Status update failed');
            toast({
                title: "¡Éxito!",
                description: `El usuario ha sido ${status === 'blocked' ? 'bloqueado' : 'desbloqueado'}.`
            });
            await fetchUsers();
        } catch (error) {
             console.error("Failed to update status:", error);
            toast({ variant: "destructive", title: "Error", description: "No se pudo actualizar el estado del usuario." });
        } finally {
            setIsUpdating(null);
        }
    }
    
    const handleDeleteUser = async () => {
        if (!userToDelete || !user?.email) return;

        setIsUpdating(userToDelete.id);
        
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/admin/delete-user', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    userIdToDelete: userToDelete.id,
                }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                toast({
                    title: "¡Éxito!",
                    description: result.message,
                });
                await fetchUsers(); // Refresh the user list
            } else {
                throw new Error(result.message || 'Error desconocido del servidor');
            }
        } catch (error: any) {
            console.error("Failed to delete user:", error);
            toast({
                variant: "destructive",
                title: "Error al eliminar usuario",
                description: error.message || "No se pudo completar la eliminación del usuario.",
            });
        } finally {
            setIsUpdating(null);
            setIsDeleteAlertOpen(false);
            setUserToDelete(null);
        }
    }
    
    const adjustTrialDays = (currentUser: RegisteredUser, days: number) => {
        const membershipInfo = getMembershipStatus(currentUser, currentUser.email);

        if (membershipInfo.status === 'Activa' || membershipInfo.status === 'De por vida') {
             toast({ 
                variant: 'destructive', 
                title: 'Acción no válida', 
                description: `No se puede ajustar la prueba para una membresía '${membershipInfo.status}'.`
            });
            return;
        }

        const baseDate = membershipInfo.endDate || new Date();
        const newExpiryDate = addDays(baseDate, days);
        const newMembership: Membership = { type: 'trial', expiresAt: newExpiryDate };
        
        handleUpdateMembership(currentUser.id, newMembership);
    }

    const activateForOneMonth = (userId: string) => {
        const now = new Date();
        const expiresAt = addMonths(now, 1);
        handleUpdateMembership(userId, { type: 'pro', startsAt: now, expiresAt });
    };

    const activateForLife = (userId: string) => {
        handleUpdateMembership(userId, { type: 'lifetime', expiresAt: null, startsAt: new Date() });
    };

    const resetToTrial = (userId: string) => {
        const now = new Date();
        const expiresAt = addDays(now, 30);
        handleUpdateMembership(userId, { type: 'trial', startsAt: now, expiresAt });
    };

    const deleteAlertContent = useMemo(() => {
        if (!userToDelete) return { title: '', description: <></> };
        return {
            title: '¿Eliminar Cuenta Permanente?',
            description: (
                 <>
                    Esta acción es <strong>irreversible</strong> y no se puede deshacer. Se eliminará la cuenta de autenticación de <strong>{userToDelete?.email}</strong> y TODOS sus datos asociados (perfil, servicios, clientes, turnos, etc.).
                </>
            ),
        };
    }, [userToDelete]);

    if (loading || !isAdmin) {
         return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    const chartData = stats ? [
        { name: 'Activas', value: stats.membershipDistribution.active, fill: 'hsl(var(--chart-1))' },
        { name: 'En Prueba', value: stats.membershipDistribution.trial, fill: 'hsl(var(--chart-2))' },
        { name: 'Vencidas', value: stats.membershipDistribution.expired, fill: 'hsl(var(--chart-3))' },
        { name: 'De por Vida', value: stats.membershipDistribution.lifetime, fill: 'hsl(var(--chart-4))' },
    ] : [];

    const chartConfig = {
      value: { label: 'Usuarios' },
      Activas: { label: 'Activas', color: 'hsl(var(--chart-1))' },
      'En Prueba': { label: 'En Prueba', color: 'hsl(var(--chart-2))' },
      Vencidas: { label: 'Vencidas', color: 'hsl(var(--chart-3))' },
      'De por Vida': { label: 'De por Vida', color: 'hsl(var(--chart-4))' },
    }
    


    return (
        <>
            <div className="flex flex-col gap-8">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-destructive/10 rounded-full">
                            <ShieldAlert className="h-6 w-6 text-destructive"/>
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Panel de Administración</h1>
                            <p className="text-muted-foreground">
                                Gestión y visualización de todos los usuarios registrados en la plataforma.
                            </p>
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Wrench className="mr-2 h-4 w-4" />
                                <span>Herramientas</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuItem asChild>
                                <Link href="/dashboard/admin/troubleshooting">
                                    Solucionar Problemas
                                </Link>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                
                {(paymentReviewsError || (paymentReviews && paymentReviews.length > 0)) && (
                    <Card className="border-amber-500/70">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-5 w-5" /> Pagos que requieren revisión</CardTitle>
                            <CardDescription>Confirmá el estado actual en Mercado Pago antes de ajustar una membresía. Ninguna devolución se ejecuta automáticamente desde este panel.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            {paymentReviewsError ? <p>No se pudo cargar la lista de pagos pendientes de revisión.</p> : paymentReviews?.map(review => (
                                 <p key={`${review.orderId}:${review.paymentId}:${review.status}`} className="break-all rounded border p-2">
                                     {review.source === 'reconciliation'
                                         ? `Error de conciliación · ${review.orderId ? `orden ${review.orderId}` : `pago ${review.paymentId}`} · ${review.reason}`
                                         : `Orden ${review.orderId} · negocio ${review.businessId} · pago ${review.paymentId || 'sin ID'} · ${review.status}${review.reason ? ` (${review.reason})` : ''}`}
                                 </p>
                            ))}
                            {paymentReviewsMore && <p>Hay más de 100 casos; consultá el registro de órdenes para completar la revisión.</p>}
                        </CardContent>
                    </Card>
                )}

                {user && <DeliveryHealth user={user} />}

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => handleOpenUserModal("Todos los Usuarios", () => true)}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Usuarios Totales</CardTitle>
                            <Users className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats?.totalUsers ?? <Skeleton className="h-8 w-16" />}</div>
                            <p className="text-xs text-muted-foreground">Cuentas registradas en la plataforma.</p>
                        </CardContent>
                    </Card>
                    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => handleOpenUserModal("Planes vencidos", u => getMembershipStatus(u, u.email).status === 'Vencida')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Planes vencidos</CardTitle>
                            <Clock className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats?.membershipDistribution.expired ?? <Skeleton className="h-8 w-16" />}</div>
                            <p className="text-xs text-muted-foreground">Negocios sin un plan vigente.</p>
                        </CardContent>
                    </Card>
                    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => handleOpenUserModal("Usuarios con plan Pro vigente", u => getMembershipStatus(u, u.email).status === 'Activa')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Planes Pro vigentes</CardTitle>
                            <CheckCircle className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats?.activeSubscriptions ?? <Skeleton className="h-8 w-16" />}</div>
                            <p className="text-xs text-muted-foreground">Usuarios con un plan Pro vigente.</p>
                        </CardContent>
                    </Card>
                    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => handleOpenUserModal("Usuarios en Período de Prueba", u => getMembershipStatus(u, u.email).status === 'En Prueba')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Usuarios en Prueba</CardTitle>
                            <Clock className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats?.trialUsers ?? <Skeleton className="h-8 w-16" />}</div>
                            <p className="text-xs text-muted-foreground">Usuarios en su período de prueba de 15 días.</p>
                        </CardContent>
                    </Card>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle>Usuarios Registrados</CardTitle>
                            <CardDescription>
                                Lista de todos los negocios que han creado una cuenta.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Cuenta (Email)</TableHead>
                                            <TableHead>Negocio</TableHead>
                                            <TableHead>Página</TableHead>
                                            <TableHead>Membresía</TableHead>
                                            <TableHead>Estado</TableHead>
                                            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            Array.from({ length: 5 }).map((_, i) => (
                                            <TableRow key={i}>
                                                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                                <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                                                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                                <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                                                <TableCell className="text-right"><Skeleton className="h-8 w-8" /></TableCell>
                                            </TableRow>
                                            ))
                                        ) : users.length > 0 ? (
                                            users.map((u) => (
                                            <TableRow key={u.id}>
                                                <TableCell className="font-medium">{u.email || 'No especificado'}</TableCell>
                                                <TableCell>{u.name || 'N/A'}</TableCell>
                                                <TableCell>
                                                    {u.slug ? (
                                                        <Badge variant="secondary">{u.slug}</Badge>
                                                    ) : (
                                                        <Badge variant="outline">Sin página</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <MembershipStatusBadge user={u} />
                                                </TableCell>
                                                <TableCell>
                                                    <UserStatusBadge user={u} />
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {isUpdating === u.id ? (
                                                        <Loader2 className="h-5 w-5 animate-spin ml-auto" />
                                                    ) : (
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="icon">
                                                                    <MoreHorizontal className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                <DropdownMenuItem onClick={() => activateForOneMonth(u.id)}>
                                                                    <CheckCircle className="mr-2"/> Activar por 1 mes
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => activateForLife(u.id)}>
                                                                    <CheckCircle className="mr-2"/> Activar de por vida
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => resetToTrial(u.id)}>
                                                                    <XCircle className="mr-2"/> Volver a Prueba
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator/>
                                                                <DropdownMenuItem onClick={() => adjustTrialDays(u, 1)}>
                                                                    <PlusCircle className="mr-2"/> Añadir 1 Día de Prueba
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => adjustTrialDays(u, -1)}>
                                                                    <MinusCircle className="mr-2"/> Quitar 1 Día de Prueba
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator/>
                                                                {u.status !== 'blocked' ? (
                                                                    <DropdownMenuItem onClick={() => handleUpdateStatus(u.id, 'blocked')} className="text-orange-600 focus:text-orange-600">
                                                                        <UserX className="mr-2"/> Bloquear Usuario
                                                                    </DropdownMenuItem>
                                                                ) : (
                                                                    <DropdownMenuItem onClick={() => handleUpdateStatus(u.id, 'active')} className="text-green-600 focus:text-green-600">
                                                                        <UserCheck className="mr-2"/> Desbloquear Usuario
                                                                    </DropdownMenuItem>
                                                                )}
                                                                <DropdownMenuSeparator/>
                                                                <DropdownMenuItem 
                                                                    className="text-destructive focus:text-destructive"
                                                                    onClick={() => { setUserToDelete(u); setIsDeleteAlertOpen(true); }}
                                                                >
                                                                    <Trash2 className="mr-2"/> Eliminar Cuenta (Permanente)
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                            ))
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center h-24">
                                                    No hay usuarios registrados.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Distribución de Membresías</CardTitle>
                            <CardDescription>Proporción de usuarios por tipo de membresía.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex items-center justify-center">
                            {stats ? (
                                <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[250px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                                        <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5}>
                                            {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} className="focus:outline-none" />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                    </ResponsiveContainer>
                                </ChartContainer>
                            ) : (
                                <div className="flex items-center justify-center h-[250px]">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle>{deleteAlertContent.title}</AlertDialogTitle>
                    <AlertDialogDescription>
                       {deleteAlertContent.description}
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel disabled={!!isUpdating}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault();
                            handleDeleteUser();
                        }}
                        disabled={!!isUpdating}
                        className="bg-destructive hover:bg-destructive/90"
                    >
                        {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Sí, eliminar permanentemente
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            <Dialog open={isUserModalOpen} onOpenChange={setIsUserModalOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{modalTitle}</DialogTitle>
                        <DialogDescription>
                            Listado de usuarios que cumplen con este criterio.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Negocio</TableHead>
                                    <TableHead>Membresía</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {modalUsers.length > 0 ? (
                                    modalUsers.map(u => (
                                        <TableRow key={u.id}>
                                            <TableCell className="font-medium">{u.email}</TableCell>
                                            <TableCell>{u.name}</TableCell>
                                            <TableCell><MembershipStatusBadge user={u} /></TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center h-24">
                                            No se encontraron usuarios.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

    

    
