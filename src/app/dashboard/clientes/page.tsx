

"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getClients, Client } from "@/services/data"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuthRedirect"
import { useToast } from "@/hooks/use-toast"
import { Users, Mail, Edit, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import dynamic from 'next/dynamic';
import { cn } from "@/lib/utils"

const ClientEditModal = dynamic(() => import('@/components/ClientEditModal'), {
    loading: () => <div className="p-4"><Skeleton className="h-10 w-24" /></div>,
    ssr: false
});

export default function ClientesPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [clients, setClients] = useState<Client[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);

    const loadClients = useCallback(async () => {
        if (!user) return;
        try {
            setIsLoading(true);
            const clientList = await getClients(user.uid);
            setClients(clientList);

        } catch (error) {
            console.error("Failed to load clients:", error);
            toast({
                variant: "destructive",
                title: "Error al cargar",
                description: "No se pudieron obtener los datos de los clientes."
            });
        } finally {
            setIsLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        if (user) {
          loadClients();
        }
    }, [user, loadClients]);
    
    const handleOpenEditModal = (client: Client) => {
        setSelectedClient(client);
        setIsEditModalOpen(true);
    }
    
    const handleCloseEditModal = () => {
        setSelectedClient(null);
        setIsEditModalOpen(false);
    }

    const handleClientUpdate = () => {
        loadClients(); // Re-fetch clients to show updated data
        handleCloseEditModal();
    }

    const handleExportClients = () => {
        if (clients.length === 0) {
            toast({ description: "No hay clientes para exportar." });
            return;
        }

        const headers = ['Nombre', 'Teléfono', 'Email', 'Último Turno'];
        const data = clients.map(client => [
            client.name,
            client.phone,
            client.email || '',
            client.lastAppointment ? client.lastAppointment.toLocaleDateString('es-ES') : 'N/A'
        ]);

        const csvContent = [
            headers.join(','),
            ...data.map(row => row.map(field => `"${field.replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.href) {
            URL.revokeObjectURL(link.href);
        }
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', 'clientes.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
            title: "¡Éxito!",
            description: "La lista de clientes se ha descargado como clientes.csv."
        });
    };

    return (
        <>
        <div className="flex flex-col gap-8">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-secondary rounded-full">
                        <Users className="h-8 w-8 text-foreground"/>
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Mis Clientes</h1>
                        <p className="text-muted-foreground">
                            Visualiza y gestiona la información de tus clientes.
                        </p>
                    </div>
                </div>
                 <Button onClick={handleExportClients} variant="outline" size="sm" disabled={isLoading || clients.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Exportar Clientes
                </Button>
            </div>

             <Card>
                <CardHeader>
                <CardTitle>Listado de Clientes</CardTitle>
                <CardDescription>
                    Aquí puedes ver todos tus clientes únicos basados en sus reservas.
                </CardDescription>
                </CardHeader>
                <CardContent>
                <div className="overflow-x-auto">
                    <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                        <TableHead>Cliente</TableHead>
                        <TableHead className="hidden md:table-cell">Contacto</TableHead>
                        <TableHead className="hidden md:table-cell">Último Turno</TableHead>
                        <TableHead className="text-right hidden md:table-cell">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i} className="border-0">
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Skeleton className="h-10 w-10 rounded-full" />
                                        <Skeleton className="h-5 w-24" />
                                    </div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                    <Skeleton className="h-5 w-32 mb-1" />
                                    <Skeleton className="h-4 w-40" />
                                </TableCell>
                                <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-28" /></TableCell>
                                <TableCell className="text-right hidden md:table-cell"><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                            </TableRow>
                        ))
                        ) : clients.length > 0 ? (
                        clients.map((client) => (
                            <TableRow key={client.id} className="border-x-0 hover:bg-accent/50 transition-colors">
                                <TableCell className="font-medium align-top">
                                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                                        <div className="flex items-center gap-4">
                                            <Avatar>
                                                <AvatarImage src={client.avatar} alt={client.name} data-ai-hint="person face" />
                                                <AvatarFallback>{client.name.substring(0, 2)}</AvatarFallback>
                                            </Avatar>
                                            <span className="font-semibold">{client.name}</span>
                                        </div>
                                        {/* Mobile-only info & actions */}
                                        <div className="flex flex-col gap-3 pl-14 md:hidden">
                                            <div className="flex flex-col gap-2 items-start">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{client.phone}</span>
                                                    <Button asChild variant="outline" size="icon" className="h-7 w-7">
                                                        <a href={`https://wa.me/${client.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label="Enviar WhatsApp">
                                                            <Image src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="WhatsApp" width={16} height={16} />
                                                        </a>
                                                    </Button>
                                                </div>
                                                {client.email && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm text-muted-foreground truncate max-w-[180px]">{client.email}</span>
                                                        <Button asChild variant="outline" size="icon" className="h-7 w-7">
                                                            <a href={`mailto:${client.email}`} aria-label="Enviar Email">
                                                                <Mail className="h-4 w-4" />
                                                            </a>
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                            <Button variant="outline" size="sm" className="w-full" onClick={() => handleOpenEditModal(client)}>
                                                <Edit className="mr-2 h-4 w-4" />
                                                Editar
                                            </Button>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                    <div className="flex flex-col gap-2 items-start">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{client.phone}</span>
                                            <Button asChild variant="outline" size="icon" className="h-7 w-7">
                                                <a href={`https://wa.me/${client.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label="Enviar WhatsApp">
                                                    <Image src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="WhatsApp" width={16} height={16} />
                                                </a>
                                            </Button>
                                        </div>
                                        {client.email && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-muted-foreground truncate max-w-[180px]">{client.email}</span>
                                                <Button asChild variant="outline" size="icon" className="h-7 w-7">
                                                    <a href={`mailto:${client.email}`} aria-label="Enviar Email">
                                                        <Mail className="h-4 w-4" />
                                                    </a>
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                    {client.lastAppointment ? client.lastAppointment.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'}
                                </TableCell>
                                 <TableCell className="text-right hidden md:table-cell">
                                    <Button variant="outline" size="icon" onClick={() => handleOpenEditModal(client)}>
                                        <Edit className="h-4 w-4" />
                                        <span className="sr-only">Editar Cliente</span>
                                    </Button>
                                 </TableCell>
                            </TableRow>
                        ))
                        ) : (
                        <TableRow>
                            <TableCell colSpan={4} className="h-36 text-center">
                            <h3 className="font-semibold">Aún no tienes clientes.</h3>
                            <p className="text-muted-foreground text-sm mt-1">Tus clientes aparecerán aquí después de su primer turno.</p>
                            </TableCell>
                        </TableRow>
                        )}
                    </TableBody>
                    </Table>
                </div>
                </CardContent>
                 {!isLoading && clients.length > 0 && (
                    <CardFooter>
                        <div className="text-xs text-muted-foreground">
                        Mostrando <strong>{clients.length}</strong> {clients.length === 1 ? 'cliente' : 'clientes'}.
                        </div>
                    </CardFooter>
                )}
            </Card>
        </div>
        
        {isEditModalOpen && selectedClient && (
            <ClientEditModal
                isOpen={isEditModalOpen}
                onOpenChange={setIsEditModalOpen}
                client={selectedClient}
                onClientUpdate={handleClientUpdate}
            />
        )}
        </>
    )
}
