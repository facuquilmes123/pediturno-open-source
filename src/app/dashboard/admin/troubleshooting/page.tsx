
"use client"

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { deleteAllBusinessData, seedDataForUser } from '@/services/data';
import { Loader2, ShieldCheck, Trash2, AlertTriangle, Database, User, Bell } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, useAuthRedirect } from '@/hooks/useAuthRedirect';

export default function TroubleshootingPage() {
    const { user, loading: authLoading } = useAuth();
    useAuthRedirect();

    const [isLoadingDelete, setIsLoadingDelete] = useState(false);
    const [isLoadingSeed, setIsLoadingSeed] = useState(false);
    const [isLoadingTestPush, setIsLoadingTestPush] = useState(false);

    const [seedUserId, setSeedUserId] = useState('');
    const [seedUserEmail, setSeedUserEmail] = useState('');
    const { toast } = useToast();
    
    useEffect(() => {
        // Set the current user's ID as default for seeding and simulating if they are logged in
        if (user) {
            setSeedUserId(user.uid);
            setSeedUserEmail(user.email || '');
        }
    }, [user]);

    if (process.env.NODE_ENV === 'production') {
        return <div className="p-6"><h1 className="text-2xl font-semibold">Herramientas de mantenimiento</h1><p>Las operaciones de prueba y borrado masivo no están disponibles en producción.</p></div>;
    }
    
    const handleDeleteAllData = async () => {
        setIsLoadingDelete(true);
        try {
            const result = await deleteAllBusinessData();
             if (result.success) {
                toast({
                    title: "¡Operación Exitosa!",
                    description: result.message,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Error al eliminar",
                    description: result.message,
                });
            }
        } catch (error) {
             console.error(error);
            toast({
                variant: "destructive",
                title: "Error inesperado",
                description: "Ocurrió un error al intentar eliminar todos los datos.",
            });
        } finally {
            setIsLoadingDelete(false);
        }
    }

    const handleSeedData = async () => {
        if (!seedUserId || !seedUserEmail) {
            toast({ variant: "destructive", title: "Datos incompletos", description: "Por favor, ingresa el ID y el Email del usuario." });
            return;
        }
        setIsLoadingSeed(true);
        try {
            const result = await seedDataForUser(seedUserId, seedUserEmail);
             if (result.success) {
                toast({
                    title: "¡Datos Creados!",
                    description: result.message,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Error al crear datos",
                    description: result.message,
                });
            }
        } catch (error) {
             console.error(error);
            toast({
                variant: "destructive",
                title: "Error inesperado",
                description: "Ocurrió un error al intentar crear los datos de prueba.",
            });
        } finally {
            setIsLoadingSeed(false);
        }
    };

    const handleSendTestPush = async () => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debes estar autenticado para enviar una notificación de prueba.' });
            return;
        }
        setIsLoadingTestPush(true);
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            if (!response.ok) throw new Error('Push test failed');
            toast({
                title: '¡Notificación Enviada!',
                description: 'Se envió una notificación de prueba a tus dispositivos suscritos. Puede tardar unos segundos en llegar.',
            });
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Error al enviar notificación',
                description: 'No se pudo enviar la notificación. Asegúrate de haber aceptado los permisos en este navegador.',
            });
        } finally {
            setIsLoadingTestPush(false);
        }
    };


    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4 border-b pb-4">
                <div className="p-3 bg-secondary rounded-full">
                    <ShieldCheck className="h-6 w-6 text-foreground"/>
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Solución de Problemas</h1>
                    <p className="text-muted-foreground">
                        Herramientas para realizar acciones administrativas de alto nivel.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bell />
                        Probar Notificaciones Push
                    </CardTitle>
                    <CardDescription>
                        Esta herramienta envía una notificación de prueba a tu dispositivo actual para verificar que las notificaciones push estén funcionando correctamente. Asegúrate de haber aceptado los permisos primero.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={handleSendTestPush} disabled={isLoadingTestPush || authLoading || !user}>
                        {isLoadingTestPush && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Enviar Notificación de Prueba
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Database />
                        Poblar Datos de Prueba
                    </CardTitle>
                    <CardDescription>
                        Esta herramienta elimina todos los datos de un usuario y los reemplaza con datos de prueba simulados (perfil, servicios, clientes) y una membresía vencida. Es útil para depuración.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="grid gap-2">
                        <Label htmlFor="seed-user-id">ID del Usuario (de Firebase Auth)</Label>
                        <Input
                            id="seed-user-id"
                            value={seedUserId}
                            onChange={(e) => setSeedUserId(e.target.value)}
                            placeholder="Ej: HfGbIGUuReQirdOoluyBLzGXw1V2"
                        />
                    </div>
                     <div className="grid gap-2">
                        <Label htmlFor="seed-user-email">Email del Usuario</Label>
                        <Input
                            id="seed-user-email"
                            type="email"
                            value={seedUserEmail}
                            onChange={(e) => setSeedUserEmail(e.target.value)}
                            placeholder="Ej: admin2@example.com"
                        />
                    </div>
                     <Button onClick={handleSeedData} disabled={isLoadingSeed}>
                        {isLoadingSeed && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <User className="mr-2 h-4 w-4" />
                        Poblar Datos para este Usuario
                    </Button>
                </CardContent>
            </Card>


             <Card className="border-destructive">
                <CardHeader>
                    <CardTitle className="text-destructive flex items-center gap-2">
                        <AlertTriangle />
                        Zona de Peligro
                    </CardTitle>
                    <CardDescription>
                        Las acciones en esta sección son irreversibles y pueden causar la pérdida de datos. Úsalas con extrema precaución.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                     <p className="font-semibold">Reinicializar base de datos de usuarios</p>
                    <p className="text-sm text-muted-foreground mb-4">
                       Esta acción eliminará TODOS los perfiles de negocio, servicios, clientes y turnos de la base de datos. Las cuentas de usuario (login) no se eliminarán. Esto es útil para empezar de cero después de un período de pruebas.
                    </p>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                         <Button variant="destructive" disabled={isLoadingDelete}>
                            {isLoadingDelete && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar Todos los Datos de Negocios
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta acción no se puede deshacer. Se eliminarán permanentemente los datos de <strong>TODOS</strong> los negocios, incluyendo perfiles, servicios, clientes y turnos. ¿Deseas continuar?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDeleteAllData}
                            className="bg-destructive hover:bg-destructive/90"
                           >
                            Sí, eliminar todo
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                </CardContent>
            </Card>
        </div>
    );
}
