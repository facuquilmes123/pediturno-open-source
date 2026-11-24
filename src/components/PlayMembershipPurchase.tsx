import { SERVICE_PLAY_URL, SERVICE_MEMBERSHIP_PRICE_LABEL } from '@/lib/config';

export default function PlayMembershipPurchase() {
  return <div className="space-y-3 text-center">
    <a href={SERVICE_PLAY_URL} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-4 font-semibold text-primary-foreground">
      Ver Pediturno en Google Play
    </a>
    <p className="text-xs text-muted-foreground">La membresía se contrata en Pediturno para Android mediante Google Play.
      Precio base: {SERVICE_MEMBERSHIP_PRICE_LABEL} por mes. Google muestra la moneda local, los impuestos y las condiciones antes de confirmar.</p>
    <p className="text-xs text-muted-foreground">Usá la misma cuenta de Pediturno para mantener el acceso en Android y en la web.
      Los períodos ya abonados se conservan. Las señas de tus clientes siguen llegando a tu cuenta de Mercado Pago.</p>
  </div>;
}
