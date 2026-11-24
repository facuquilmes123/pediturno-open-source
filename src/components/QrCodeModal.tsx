

"use client"

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Download, ExternalLink, Share2 } from 'lucide-react';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';

interface QrCodeModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    url: string;
    logo?: string;
    businessName?: string;
}

const QrCodeModal = ({ isOpen, onOpenChange, url, logo, businessName }: QrCodeModalProps) => {
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSharingSupported, setIsSharingSupported] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            setIsSharingSupported(true);
        }
    }, []);

    useEffect(() => {
        if (isOpen && url) {
            setIsLoading(true);
            
            const generateQrCode = async () => {
                try {
                    // QR Code options
                    const options: QRCode.QRCodeToDataURLOptions = {
                        errorCorrectionLevel: 'H', // High
                        type: 'image/png',
                        margin: 1,
                        width: 512,
                    };
                    
                    const qrDataUrl = await QRCode.toDataURL(url, options);

                    if (logo) {
                        // If there's a logo, draw it onto the QR code
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                           setQrCodeDataUrl(qrDataUrl); // Fallback to QR without logo
                           return;
                        }

                        canvas.width = 512;
                        canvas.height = 512;

                        const qrImage = new window.Image();
                        qrImage.crossOrigin = 'Anonymous';
                        qrImage.src = qrDataUrl;
                        
                        qrImage.onload = () => {
                            ctx.drawImage(qrImage, 0, 0);

                            const logoImage = new window.Image();
                            logoImage.crossOrigin = 'Anonymous';
                            logoImage.src = logo;
                            
                            logoImage.onload = () => {
                                // Draw logo in the center
                                const logoSize = canvas.width / 4; // Logo size is 1/4 of QR size
                                const x = (canvas.width - logoSize) / 2;
                                const y = (canvas.height - logoSize) / 2;

                                // Add a white background behind the logo for clarity
                                ctx.fillStyle = 'white';
                                ctx.fillRect(x - 5, y - 5, logoSize + 10, logoSize + 10);
                                
                                ctx.drawImage(logoImage, x, y, logoSize, logoSize);
                                setQrCodeDataUrl(canvas.toDataURL('image/png'));
                            }
                            logoImage.onerror = () => setQrCodeDataUrl(qrDataUrl); // Fallback
                        };
                        qrImage.onerror = () => setQrCodeDataUrl(qrDataUrl); // Fallback

                    } else {
                        setQrCodeDataUrl(qrDataUrl);
                    }
                } catch (err) {
                    console.error('Failed to generate QR code', err);
                     toast({
                        variant: 'destructive',
                        title: 'Error al generar QR',
                        description: 'No se pudo crear el código QR. Inténtalo de nuevo.'
                    });
                } finally {
                    setIsLoading(false);
                }
            };
            
            generateQrCode();
        }
    }, [isOpen, url, logo, toast, businessName]);

    const handleDownload = () => {
        if (qrCodeDataUrl) {
            const link = document.createElement('a');
            link.download = `qr-code-${businessName?.toLowerCase().replace(/\s+/g, '-') || 'pediturno'}.png`;
            link.href = qrCodeDataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
    
    const handleShare = async () => {
        if (!navigator.share) return;
        
        const shareText = `¡Hola! Te comparto mi página para que puedas agendar un turno de forma fácil y rápida en mi negocio: ${businessName || 'Pediturno Online'}. Haz clic aquí: ${url}`;

        try {
            await navigator.share({
                title: `Reserva tu turno en ${businessName || 'Pediturno Online'}`,
                text: shareText,
                url: url,
            });
            toast({
                title: '¡Link compartido!',
                description: 'El enlace a tu página de reservas se ha compartido.',
            });
        } catch (error) {
            console.error('Error sharing:', error);
            if ((error as Error).name !== 'AbortError') {
                 toast({
                    variant: 'destructive',
                    title: 'Error al compartir',
                    description: 'No se pudo compartir el enlace.',
                });
            }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Código QR de tu Página</DialogTitle>
                    <DialogDescription>
                        Tus clientes pueden escanear este código para ir directamente a tu página de reservas.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center justify-center p-4 rounded-lg bg-muted min-h-[320px]">
                    {isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    ) : qrCodeDataUrl ? (
                         <Image src={qrCodeDataUrl} alt="Código QR" width={300} height={300} data-ai-hint="qr code"/>
                    ) : (
                        <p className="text-destructive text-sm">No se pudo generar el código QR.</p>
                    )}
                </div>
                 <div className="text-center text-sm text-muted-foreground break-all">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center justify-center gap-1">
                        {url} <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
                <DialogFooter className="grid grid-cols-1 sm:grid-cols-2 sm:justify-between gap-2">
                    {isSharingSupported && (
                         <Button variant="outline" onClick={handleShare} disabled={isLoading || !qrCodeDataUrl}>
                            <Share2 className="mr-2 h-4 w-4" />
                            Compartir
                        </Button>
                    )}
                    <Button onClick={handleDownload} disabled={isLoading || !qrCodeDataUrl} className={!isSharingSupported ? 'sm:col-span-2' : ''}>
                        <Download className="mr-2 h-4 w-4" />
                        Descargar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default QrCodeModal;
