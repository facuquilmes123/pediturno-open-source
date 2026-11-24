import type { Metadata } from 'next';
import Link from 'next/link';
import PublicInfoLayout from '@/components/PublicInfoLayout';

export const metadata: Metadata = {
  title: 'Eliminar cuenta y datos de Pediturno',
  description: 'Cómo solicitar la eliminación de tu cuenta de Pediturno y sus datos asociados.',
  alternates: { canonical: 'https://pediturno.com/eliminar-cuenta' },
};

export default function DeleteAccountPage() {
  return <PublicInfoLayout title="Eliminar cuenta y datos de Pediturno" updatedAt="30 de octubre de 2026">
    <p>Podés solicitar la eliminación desde Mi Negocio en la aplicación Android o escribirnos sin volver a instalarla.</p>
    <p><a className="font-semibold underline" href="mailto:contacto@pediturno.com?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20cuenta%20Pediturno">Solicitar eliminación a contacto@pediturno.com</a></p>
    <p>Escribí desde el correo de la cuenta e indicá el nombre o enlace de tu negocio. Verificaremos la titularidad antes de ejecutar cambios. Nunca envíes contraseñas, códigos de acceso, tarjetas ni documentos por este formulario de correo.</p>
    <h2>Qué datos comprende</h2>
    <p>La solicitud comprende tu cuenta, perfil público, catálogo, agenda y los datos de clientes asociados. Los comprobantes y registros necesarios para obligaciones legales, conciliación, prevención de fraude o defensa de derechos pueden conservarse con acceso restringido. Las copias de recuperación se conservan durante su ciclo de respaldo.</p>
    <h2>Suscripciones y pagos pendientes</h2>
    <p>Eliminar tu cuenta o desinstalar la aplicación no cancela automáticamente una suscripción. Podés <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">gestionar la suscripción en Google Play</a>. Las devoluciones o señas pendientes deben conciliarse con el proveedor y el negocio antes de eliminar la información necesaria.</p>
    <p>Si hay operaciones de Mercado Pago pendientes de cierre, se bloquean las nuevas ventas y sólo se conservan de forma restringida los datos financieros y las credenciales cifradas imprescindibles para su conciliación. Te informaremos el tratamiento que corresponda al revisar la solicitud.</p>
    <h2>Plazo y seguimiento</h2>
    <p>Una vez verificada la titularidad, procesamos la baja de los datos operativos en un plazo máximo de 7 días. Las operaciones financieras pendientes se revisan por separado y no impiden retirar el perfil público ni suprimir los datos de contacto y notas de clientes que ya no sean necesarios.</p>
    <p>Las imágenes eliminadas pueden permanecer 7 días adicionales en recuperación restringida; las versiones técnicas actuales de Firestore tienen una ventana de 1 hora. Conservamos la constancia mínima de baja durante 12 meses, salvo una excepción documentada y revisada mensualmente. El plazo contable de 10 años sólo se aplica a la documentación que corresponda conforme al artículo 328, no a perfiles ni credenciales. Consultá el detalle y cómo pedir una supresión parcial en la política de privacidad.</p>
    <p>Te informaremos la recepción, los pasos de verificación y el estado de tu solicitud. Guardá el número de solicitud que muestra la app para consultar su seguimiento en contacto@pediturno.com. Consultá también nuestra <Link href="/privacy-policy">Política de Privacidad</Link>.</p>
  </PublicInfoLayout>;
}
