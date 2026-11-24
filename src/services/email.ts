
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { getBusinessBookingUrl, getVerticalOrigin, getVerticalFromBusinessType } from '@/lib/verticals';
import { headers } from 'next/headers';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Appointment, BusinessProfile } from './data';
import { generateGoogleCalendarUrl } from '@/lib/calendar-utils';
import { SMTP_ALERT_RECIPIENT, SMTP_MAILBOX, type SmtpUsageSummary } from '@/lib/smtp-usage';

// Get email credentials from environment variables.
const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;
const emailSender = process.env.EMAIL_FROM || emailUser || 'contacto@pediturno.com';
const emailReplyTo = process.env.EMAIL_REPLY_TO || emailSender;

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] || character);
}

function safeSubject(value: unknown): string {
    return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
}

function appointmentOffering(appointment: { service?: unknown; cancha?: unknown; space?: unknown }): { label: 'Servicio' | 'Cancha' | 'Espacio' | 'Turno'; value: string } {
    if (typeof appointment.space === 'string' && appointment.space.trim()) {
        return { label: 'Espacio', value: appointment.space.trim() };
    }
    if (typeof appointment.service === 'string' && appointment.service.trim()) {
        return { label: 'Servicio', value: appointment.service.trim() };
    }
    if (typeof appointment.cancha === 'string' && appointment.cancha.trim()) {
        return { label: 'Cancha', value: appointment.cancha.trim() };
    }
    return { label: 'Turno', value: 'Turno' };
}

function safeImageTag(url: unknown, name: unknown): string {
    if (typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return '';
        return `<img src="${escapeHtml(parsed.href)}" alt="Logo de ${escapeHtml(name)}" style="max-width: 120px; margin-bottom: 15px; border-radius: 8px;">`;
    } catch { return ''; }
}


// A serializable version of the Appointment, where date can be a string
type SerializableAppointment = Omit<Appointment, 'date'> & { date: string | Date };
// A serializable version of the BusinessProfile for email actions
type SerializableBusiness = Pick<BusinessProfile, 'name' | 'slug' | 'logo' | 'bookingSettings' | 'address' | 'businessType'>;


export interface EmailData {
    appointment: SerializableAppointment;
    business: SerializableBusiness;
    /** Opaque single-use URL issued by the server, never an appointment id. */
    capabilityUrl?: string;
    isReschedule?: boolean;
}

interface WelcomeEmailData {
    businessType?: BusinessProfile['businessType'];
    name: string;
    email: string;
}


interface CancellationEmailData {
    appointment: SerializableAppointment;
    business: SerializableBusiness;
    recipient: 'client' | 'business';
}

interface ReminderEmailData {
    appointment: SerializableAppointment;
    business: BusinessProfile;
}


const getFormattedAddress = (address: BusinessProfile['address']) => {
    if (!address) return '';
    const { street, number, city, province, postalCode } = address;
    const parts = [
        street && number ? `${street} ${number}` : street,
        city,
        province,
        postalCode
    ].filter(Boolean); 
    return parts.join(', ');
}

function getRawEmailTransporter() {
    if (process.env.FIREBASE_PROJECT_ID?.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error('External email delivery is disabled for isolated emulator runs.');
    }
    // `next/headers` makes this module server-only in Next's module graph.
    // Calling a mail helper outside an HTTP server request is deliberately unsupported.
    void headers();
    return nodemailer.createTransport({
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
        port: Number(process.env.EMAIL_PORT) || 465,
        secure: process.env.EMAIL_SECURE !== 'false',
        requireTLS: true,
        tls: { minVersion: 'TLSv1.2' },
        auth: {
            user: emailUser,
            pass: emailPass,
        },
    });
}

async function sendSmtpUsageAlert(summary: SmtpUsageSummary, test: boolean): Promise<boolean> {
    if (!emailUser || !emailPass || emailUser.toLowerCase() !== SMTP_MAILBOX) return false;
    const lines = [test ? 'Pediturno — prueba controlada de alerta de correo' : 'Pediturno — el correo se acerca al límite diario',
        'Casilla: ' + SMTP_MAILBOX, 'Límite del plan: ' + summary.limit + ' por 24 horas.',
        'Umbral de aviso: ' + summary.threshold + '.',
        'Destinatarios aceptados por SMTP desde la app en las últimas 24 horas: ' + summary.appAcceptedUnits24h + '.',
        summary.providerObservedUnits === null ? 'Los logs del proveedor no tienen una observación reciente disponible.' : 'Registros salientes del proveedor en la última observación de 24 horas: ' + summary.providerObservedUnits + '.',
        test ? 'Es una prueba de entrega; no representa un umbral real alcanzado.' : 'Revisar el volumen y la capacidad del plan antes de escalar. Este aviso no contrata capacidad ni cambia el envío a clientes.',
        'Los contadores son señales de uso, no un saldo exacto de la cuota. Este aviso también consume un envío.'];
    const result = await getRawEmailTransporter().sendMail({ from: 'Pediturno <' + emailSender + '>', replyTo: emailReplyTo,
        to: SMTP_ALERT_RECIPIENT, subject: test ? '[Pediturno] Prueba de alerta de correos' : '[Pediturno] Correo cerca del límite: 80/100', text: lines.join('\n') });
    return Array.isArray(result.accepted) && result.accepted.some(value => typeof value === 'string' && value.toLowerCase() === SMTP_ALERT_RECIPIENT);
}

export async function runSmtpUsageMonitor(observation?: { count: number; asOf: number; from: number }, test = false) {
    if (process.env.FIREBASE_PROJECT_ID !== 'pediturno-app' || emailUser?.toLowerCase() !== SMTP_MAILBOX) throw new Error('SMTP usage monitor configuration mismatch');
    const { getSmtpUsageController } = await import('@/lib/smtp-usage-store');
    const controller = getSmtpUsageController();
    if (observation) await controller.observeProvider(observation);
    return controller.monitor(sendSmtpUsageAlert, test);
}

function getEmailTransporter() {
    const transport = getRawEmailTransporter();
    return { sendMail: async (options: SendMailOptions) => {
        const result = await transport.sendMail(options);
        const accepted = Array.isArray(result.accepted) ? result.accepted.length : 0;
        if (accepted && process.env.FIREBASE_PROJECT_ID === 'pediturno-app' && emailUser?.toLowerCase() === SMTP_MAILBOX) {
            // SMTP success must remain success even when telemetry is unavailable.
            let timer: ReturnType<typeof setTimeout> | undefined;
            const task = (async () => { const { getSmtpUsageController } = await import('@/lib/smtp-usage-store'); const controller = getSmtpUsageController(); await controller.recordAccepted(accepted); await controller.monitor(sendSmtpUsageAlert); })()
                .catch(() => { console.warn('smtp_usage_record_unavailable'); });
            try { await Promise.race([task, new Promise<void>(resolve => { timer = setTimeout(resolve, 3000); })]); }
            finally { if (timer) clearTimeout(timer); }
        }
        return result;
    } };
}

/** Internal operator delivery: recipient is server configuration, never request data. */
export async function sendGooglePlayOperationalAlert(data: { kind: 'reconciliation_failed' | 'reconciliation_unavailable' | 'rtdn_unmapped'; counts: Record<string, number> }): Promise<boolean> {
    const recipient = process.env.GOOGLE_PLAY_OPS_ALERT_EMAIL?.trim();
    if (!recipient || recipient.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || !emailUser || !emailPass) return false;
    const labels = {
        reconciliation_failed: 'La conciliación de Google Play tiene operaciones fallidas.',
        reconciliation_unavailable: 'No se pudo completar la conciliación de Google Play.',
        rtdn_unmapped: 'Hay notificaciones de Google Play pendientes de conciliación durante más de 15 minutos.',
    };
    if (!Object.prototype.hasOwnProperty.call(labels, data.kind)) return false;
    const lines = ['Pediturno — aviso operativo de Google Play', labels[data.kind]];
    for (const key of ['checked', 'processed', 'failed', 'pending']) {
        const value = data.counts[key];
        if (Number.isSafeInteger(value) && value >= 0) lines.push(`${key}: ${value}`);
    }
    lines.push('Revisar Cloud Scheduler: pediturno-play-reconcile, las credenciales Publisher y el registro privado de Google Play del backend. No solicitar tokens ni contraseñas a clientes.');
    try {
        const result = await getEmailTransporter().sendMail({ from: `Pediturno <${emailSender}>`, replyTo: emailReplyTo, to: recipient, subject: '[Pediturno] Revisar operación de Google Play', text: lines.join('\n') });
        return Array.isArray(result.accepted) && result.accepted.some(value => typeof value === 'string' && value.toLowerCase() === recipient.toLowerCase());
    } catch { return false; }
}

/** Internal deletion alerts accept only server-configured recipients and aggregate counters. */
export async function sendAccountDeletionOperationalAlert(counts: Record<string, number>): Promise<boolean> {
    const recipient = process.env.ACCOUNT_DELETION_ALERT_TO?.trim();
    if (!recipient || recipient.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || !emailUser || !emailPass) return false;
    const lines = ['Pediturno — revisar el worker de bajas', 'Hay una demora o un fallo en el procesamiento operativo de bajas. SLA: 7 días desde la verificación de titularidad.'];
    for (const name of ['overdue', 'quarantined', 'unknownDeadline', 'runnerStale', 'workerFailed']) {
        const value = counts[name];
        if (Number.isSafeInteger(value) && value >= 0) lines.push(`${name}: ${value}`);
    }
    lines.push('Revisar el monitor privado y los jobs de bajas en Hostinger. Las obligaciones financieras se revisan por separado. No solicitar contraseñas ni códigos a clientes.');
    try {
        const result = await getEmailTransporter().sendMail({ from: `Pediturno <${emailSender}>`, replyTo: emailReplyTo, to: recipient, subject: '[Pediturno] Revisar bajas de cuenta', text: lines.join('\n') });
        return Array.isArray(result.accepted) && result.accepted.some(value => typeof value === 'string' && value.toLowerCase() === recipient.toLowerCase());
    } catch { return false; }
}

export async function sendWelcomeEmail(data: WelcomeEmailData) {
    if (!emailUser || !emailPass) {
        console.warn("Welcome email credentials are not set on the server.");
        return { success: false, message: 'Email service is not configured on the server.' };
    }

    try {
        const { name, email } = data;
        const safeName = escapeHtml(name);
        const homeUrl = getVerticalOrigin(getVerticalFromBusinessType(data.businessType)) + '/';
        const resourceName = data.businessType === 'spaces' ? 'espacios y paquetes' : data.businessType === 'sports_facility' || data.businessType === 'hybrid' ? 'canchas' : 'servicios';

        const transporter = getEmailTransporter();

        const mailOptions = {
            from: `Pediturno <${emailSender}>`,
            replyTo: emailReplyTo,
            to: email,
            subject: safeSubject(`¡Bienvenido a Pediturno Online, ${name}!`),
            html: `
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; color: #333;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: auto;">
                                    <!-- Header -->
                                    <tr>
                                        <td align="center" style="padding: 40px 20px; border-bottom: 1px solid #eeeeee;">
                                            <img src="https://pediturno.com/logo.webp" alt="Logo de Pediturno Online" style="max-width: 80px; margin-bottom: 15px;">
                                            <h1 style="margin: 0; color: #333333; font-size: 28px;">¡Bienvenido a bordo, ${safeName}!</h1>
                                        </td>
                                    </tr>
                                    <!-- Body -->
                                    <tr>
                                        <td style="padding: 30px 40px; line-height: 1.6; font-size: 16px;">
                                            <p>¡Hola <strong>${safeName}</strong>!</p>
                                            <p>Estamos muy contentos de que te hayas unido a Pediturno Online. Has dado el primer paso para simplificar la gestión de tu negocio y ofrecer a tus clientes la mejor experiencia de reserva.</p>
                                            <h2 style="color: #333; font-size: 20px; margin-top: 30px; border-bottom: 2px solid #64CCC9; padding-bottom: 5px;">Tus Primeros Pasos:</h2>
                                            <p>Para empezar a recibir reservas, te recomendamos seguir esta guía rápida:</p>
                                            
                                            <!-- Step 1 -->
                                            <p style="margin-top: 25px;"><strong>1. Configura tu Página:</strong></p>
                                            <p>Inicia sesión y personaliza la información de tu negocio, tu logo, dirección y redes sociales. Esta será tu carta de presentación para los clientes.</p>
                                            <a href="${homeUrl}" style="background-color: #333; color: #ffffff; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin-top: 5px;">Ir a "Mi Negocio"</a>
                                            
                                            <!-- Step 2 -->
                                            <p style="margin-top: 25px;"><strong>2. Configura tus ${resourceName}:</strong></p>
                                            <p>Definí la disponibilidad y el precio de tus ${resourceName} para que tus clientes sepan qué pueden reservar.</p>
                                            <a href="${homeUrl}" style="background-color: #333; color: #ffffff; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin-top: 5px;">Configurar ${resourceName}</a>

                                            <!-- Step 3 -->
                                            <p style="margin-top: 25px;"><strong>3. Comparte tu Link:</strong></p>
                                            <p>Una vez que tu página esté lista, obtendrás un link único (ej: ${homeUrl.replace('https://', '')}tunegocio). ¡Compártelo en Instagram, WhatsApp o donde quieras para que tus clientes empiecen a agendar!</p>
                                        </td>
                                    </tr>
                                    <!-- Footer -->
                                    <tr>
                                        <td style="padding: 20px 40px 40px; text-align: center;">
                                            <p style="font-size: 14px; color: #888888;">Si tienes alguna duda o necesitas asistencia, escríbenos a <a href="mailto:contacto@pediturno.com" style="color: #64CCC9; text-decoration: none; font-weight: bold;">contacto@pediturno.com</a>. ¡Estamos aquí para ayudarte a crecer!</p>
                                            <a href="${homeUrl}" style="background-color: #64CCC9; color: #ffffff; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin-top: 15px;">
                                                Iniciar Sesión
                                            </a>
                                            <p style="font-size: 12px; color: #aaaaaa; margin-top: 30px;">
                                                Saludos,<br>El equipo de Pediturno
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
            `,
        };
        await transporter.sendMail(mailOptions);
        return { success: true, message: 'Welcome email sent successfully' };
    } catch (error: any) {
        console.warn('Error sending welcome email:', error?.message || error);
        return { success: false, message: error?.message || 'Failed to send welcome email.' };
    }
}


export async function sendConfirmationEmail(data: EmailData) {
     if (!emailUser || !emailPass) {
        console.error("Email credentials are not set on the server.");
        // Avoid throwing an error that breaks the booking flow, just log it.
        return { message: 'Email service is not configured on the server.' };
    }

    try {
        const { appointment, business, isReschedule = false } = data;
        const { client, clientEmail, time } = appointment;
        const offering = appointmentOffering(appointment);
        const safeClient = escapeHtml(client);
        const safeOffering = escapeHtml(offering.value);
        const safeTime = escapeHtml(time);
        const safeBusinessName = escapeHtml(business.name);
        const date = new Date(appointment.date);

        if (!clientEmail) {
            return { message: 'No client email provided, nothing to send.' };
        }
        
        const formattedDate = format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
        const businessAddress = getFormattedAddress(business.address);
        const safeBusinessAddress = escapeHtml(businessAddress);
        if (!isSafeCapabilityUrl(data.capabilityUrl)) {
            return { success: false, message: 'A secure appointment action link is required.' };
        }
        const actionUrl = data.capabilityUrl;
        
        const googleCalendarUrl = generateGoogleCalendarUrl({
            title: `Turno en ${business.name} - ${offering.value}`,
            description: `Turno agendado para ${client} (${offering.value}) en ${business.name}.`,
            location: businessAddress,
            startDate: date,
            startTime: time,
            durationMinutes: typeof appointment.durationMinutes === 'number' && Number.isInteger(appointment.durationMinutes) && appointment.durationMinutes > 0 ? appointment.durationMinutes : 60,
        });

        const isPending = appointment.status === 'Pendiente';
        const title = isPending ? 'Solicitud recibida' : isReschedule ? "¡Turno Reprogramado!" : "¡Turno Confirmado!";
        const subject = safeSubject(isPending ? `Solicitud pendiente en ${business.name}` : isReschedule ? `Tu turno en ${business.name} fue reprogramado` : `Confirmación de tu turno en ${business.name}`);
        const mainMessage = isPending
            ? `Recibimos tu solicitud en <strong>${safeBusinessName}</strong>. El negocio todavía debe confirmarla. Estos son los detalles solicitados:`
            : isReschedule
            ? `Tu cita en <strong>${safeBusinessName}</strong> ha sido reprogramada con éxito. Aquí están los nuevos detalles:`
            : `Gracias por agendar tu cita en <strong>${safeBusinessName}</strong>. Aquí están los detalles:`;

        const transporter = getEmailTransporter();

        const mailOptions = {
            from: `Pediturno <${emailSender}>`,
            replyTo: emailReplyTo,
            to: clientEmail,
            subject: subject,
            html: `
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: auto;">
                                    <!-- Header -->
                                    <tr>
                                        <td align="center" style="padding: 40px 20px; border-bottom: 1px solid #eeeeee;">
                                            ${safeImageTag(business.logo, business.name)}
                                            <h1 style="margin: 0; color: #333333; font-size: 24px;">${title}</h1>
                                        </td>
                                    </tr>
                                    <!-- Body -->
                                    <tr>
                                        <td style="padding: 30px 40px; color: #555555; line-height: 1.6; font-size: 16px;">
                                            <p>¡Hola <strong>${safeClient}</strong>!</p>
                                            <p>${mainMessage}</p>
                                            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                                <p style="margin: 10px 0;"><strong>${offering.label}:</strong> ${safeOffering}</p>
                                                <p style="margin: 10px 0;"><strong>Día:</strong> ${formattedDate}</p>
                                                <p style="margin: 10px 0;"><strong>Hora:</strong> ${safeTime}</p>
                                                ${businessAddress ? `<p style="margin: 10px 0;"><strong>Dirección:</strong> ${safeBusinessAddress}</p>` : ''}
                                            </div>
                                            
                                            <div style="text-align: center; margin: 25px 0; padding: 15px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                                                <p style="font-size: 14px; font-weight: bold; color: #166534; margin: 0 0 10px 0;">📅 Agrega este turno a tu calendario:</p>
                                                <a href="${escapeHtml(googleCalendarUrl)}" target="_blank" style="background-color: #1a73e8; color: #ffffff; padding: 10px 18px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: bold; font-size: 13px; margin: 4px;">
                                                    Google Calendar
                                                </a>
                                            </div>

                                            <p>${isPending ? 'Esperá la confirmación del negocio antes de asistir.' : '¡Te esperamos con todo listo!'}</p>
                                        </td>
                                    </tr>
                                    <!-- Footer / Actions -->
                                    <tr>
                                        <td style="padding: 20px 40px 40px; text-align: center;">
                                            <p style="font-size: 14px; color: #888888;">Si necesitas cambiar o cancelar el turno, puedes usar estos botones:</p>
                                            <a href="${escapeHtml(actionUrl)}" style="background-color: #333333; color: #ffffff; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin-top: 10px;">
                                                Cambiar o cancelar turno
                                            </a>
                                            <p style="font-size: 12px; color: #aaaaaa; margin-top: 30px;">
                                                Saludos,<br>El equipo de ${safeBusinessName}
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
            `,
        };

        await transporter.sendMail(mailOptions);
        return { success: true, message: 'Confirmation email sent successfully' };
    } catch (error: any) {
        console.warn('Error sending confirmation email:', error?.message || error);
        return { success: false, message: error?.message || 'Failed to send confirmation email.' };
    }
}

export async function sendReminderEmail(data: ReminderEmailData) {
     if (!emailUser || !emailPass) {
        console.warn("Email credentials are not set for reminders.");
        return { success: false, message: 'Email service is not configured.' };
    }

    try {
        const { appointment, business } = data;
        const { client, clientEmail, time } = appointment;
        const offering = appointmentOffering(appointment);
        const safeClient = escapeHtml(client);
        const safeOffering = escapeHtml(offering.value);
        const safeTime = escapeHtml(time);
        const safeBusinessName = escapeHtml(business.name);
        const date = new Date(appointment.date);

        if (!clientEmail) {
            console.log('Skipping reminder: no client email.');
            return { message: 'No email to send.' };
        }

        const formattedDate = format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
        const businessAddress = getFormattedAddress(business.address);
        const safeBusinessAddress = escapeHtml(businessAddress);

        const googleCalendarUrl = generateGoogleCalendarUrl({
            title: `Recordatorio: Turno en ${business.name} - ${offering.value}`,
            description: `Recordatorio de turno agendado en ${business.name} para ${offering.value}.`,
            location: businessAddress,
            startDate: date,
            startTime: time,
            durationMinutes: typeof appointment.durationMinutes === 'number' && Number.isInteger(appointment.durationMinutes) && appointment.durationMinutes > 0 ? appointment.durationMinutes : 60,
        });

        const transporter = getEmailTransporter();

        const mailOptions = {
            from: `Pediturno <${emailSender}>`,
            replyTo: emailReplyTo,
            to: clientEmail,
            subject: safeSubject(`Recordatorio de tu turno mañana en ${business.name}`),
            html: `
                 <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: auto;">
                                    <!-- Header -->
                                    <tr>
                                        <td align="center" style="padding: 40px 20px; border-bottom: 1px solid #eeeeee;">
                                            ${safeImageTag(business.logo, business.name)}
                                            <h1 style="margin: 0; color: #333333; font-size: 24px;">Recordatorio de Turno</h1>
                                        </td>
                                    </tr>
                                    <!-- Body -->
                                    <tr>
                                        <td style="padding: 30px 40px; color: #555555; line-height: 1.6; font-size: 16px;">
                                            <p>¡Hola <strong>${safeClient}</strong>!</p>
                                            <p>Este es un recordatorio de tu cita agendada en <strong>${safeBusinessName}</strong>.</p>
                                            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                                <p style="margin: 10px 0;"><strong>${offering.label}:</strong> ${safeOffering}</p>
                                                <p style="margin: 10px 0;"><strong>Día:</strong> ${formattedDate}</p>
                                                <p style="margin: 10px 0;"><strong>Hora:</strong> ${safeTime}</p>
                                                ${businessAddress ? `<p style="margin: 10px 0;"><strong>Dirección:</strong> ${safeBusinessAddress}</p>` : ''}
                                            </div>

                                            <div style="text-align: center; margin: 25px 0; padding: 15px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                                                <p style="font-size: 14px; font-weight: bold; color: #166534; margin: 0 0 10px 0;">📅 Agrega este turno a tu calendario:</p>
                                                <a href="${escapeHtml(googleCalendarUrl)}" target="_blank" style="background-color: #1a73e8; color: #ffffff; padding: 10px 18px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: bold; font-size: 13px; margin: 4px;">
                                                    Google Calendar
                                                </a>
                                            </div>

                                            <p>¡Te esperamos!</p>
                                        </td>
                                    </tr>
                                    <!-- Footer / Cancellation -->
                                    <tr>
                                        <td style="padding: 20px 40px 40px; text-align: center;">
                                            <p style="font-size: 14px; color: #888888;">Si necesitás cambiar el turno, contactá directamente al negocio.</p>
                                            <p style="font-size: 12px; color: #aaaaaa; margin-top: 30px;">
                                                Saludos,<br>El equipo de ${safeBusinessName}
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
            `,
        };

        await transporter.sendMail(mailOptions);
        return { success: true, message: 'Reminder email sent successfully' };
    } catch (error: any) {
        console.warn('Error sending reminder email:', error?.message || error);
        return { success: false, message: error?.message || 'Failed to send reminder email.' };
    }
}

function isSafeCapabilityUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'pediturno.com' && /^\/cancel\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
    } catch {
        return false;
    }
}

export async function sendCancellationEmail(data: CancellationEmailData) {
    if (!emailUser || !emailPass) {
        console.warn("Email credentials are not set for cancellation emails.");
        return { success: false, message: 'Email service is not configured.' };
    }

    try {
        const { appointment, business, recipient } = data;
        const { client, clientEmail, time } = appointment;
        const offering = appointmentOffering(appointment);
        const safeClient = escapeHtml(client);
        const safeOffering = escapeHtml(offering.value);
        const safeTime = escapeHtml(time);
        const safeBusinessName = escapeHtml(business.name);
        const date = new Date(appointment.date);

        const toAddress = recipient === 'client' 
            ? clientEmail 
            : business.bookingSettings?.notificationEmail;
        
        if (!toAddress) {
             console.log(`Skipping cancellation email for recipient '${recipient}': no email address.`);
             return { message: 'No email to send.' };
        }

        const formattedDate = format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
        const rebookingUrl = getBusinessBookingUrl(business.businessType, business.slug || '');
        const dashboardUrl = `${getVerticalOrigin(getVerticalFromBusinessType(business.businessType))}/dashboard/calendario`;

        const subject = recipient === 'client' 
            ? safeSubject(`Tu turno en ${business.name} ha sido cancelado`)
            : safeSubject(`Notificación: Un turno fue cancelado (${client})`);
        
        const clientBody = `
            <p>Hola <strong>${safeClient}</strong>,</p>
            <p>Te informamos que tu turno en <strong>${safeBusinessName}</strong> ha sido cancelado. A continuación, los detalles del turno anulado:</p>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #D32F2F;">
                <p style="margin: 10px 0;"><strong>${offering.label}:</strong> ${safeOffering}</p>
                <p style="margin: 10px 0;"><strong>Día:</strong> ${formattedDate}</p>
                <p style="margin: 10px 0;"><strong>Hora:</strong> ${safeTime}</p>
            </div>
            <p>Si crees que esto es un error o deseas volver a agendar, no dudes en ponerte en contacto con nosotros o visita nuestra página de reservas.</p>
        `;

        const businessBody = `
            <p>Hola <strong>${safeBusinessName}</strong>,</p>
            <p>Te informamos que se ha cancelado un turno en tu calendario. Estos son los detalles:</p>
             <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #D32F2F;">
                <p style="margin: 10px 0;"><strong>Cliente:</strong> ${safeClient}</p>
                <p style="margin: 10px 0;"><strong>${offering.label}:</strong> ${safeOffering}</p>
                <p style="margin: 10px 0;"><strong>Día:</strong> ${formattedDate}</p>
                <p style="margin: 10px 0;"><strong>Hora:</strong> ${safeTime}</p>
            </div>
            <p>El horario ha sido liberado en tu calendario.</p>
        `;
        
        const mailOptions = {
            from: `Pediturno <${emailSender}>`,
            replyTo: emailReplyTo,
            to: toAddress,
            subject: subject,
            html: `
                 <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: auto;">
                                    <!-- Header -->
                                    <tr>
                                        <td align="center" style="padding: 40px 20px; border-bottom: 1px solid #eeeeee;">
                                            ${safeImageTag(business.logo, business.name)}
                                            <h1 style="margin: 0; color: #D32F2F; font-size: 24px;">Turno Cancelado</h1>
                                        </td>
                                    </tr>
                                    <!-- Body -->
                                    <tr>
                                        <td style="padding: 30px 40px; color: #555555; line-height: 1.6; font-size: 16px;">
                                           ${recipient === 'client' ? clientBody : businessBody}
                                        </td>
                                    </tr>
                                    <!-- Footer -->
                                    <tr>
                                        <td style="padding: 20px 40px 40px; text-align: center;">
                                            <a href="${escapeHtml(recipient === 'client' ? rebookingUrl : dashboardUrl)}" style="background-color: #333333; color: #ffffff; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin-top: 10px;">
                                                ${recipient === 'client' ? 'Volver a Agendar' : 'Ir a mi Calendario'}
                                            </a>
                                            <p style="font-size: 12px; color: #aaaaaa; margin-top: 30px;">
                                                ${recipient === 'client' ? `Lamentamos cualquier inconveniente.<br>El equipo de ${safeBusinessName}` : `Saludos,<br>Pediturno Online`}
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
            `,
        };

        const transporter = getEmailTransporter();
        await transporter.sendMail(mailOptions);
        return { success: true, message: `Cancellation email sent successfully to ${recipient}` };
    } catch (error: any) {
        console.warn('Error sending cancellation email:', error?.message || error);
        return { success: false, message: error?.message || 'Failed to send cancellation email.' };
    }
}

export async function sendNewAppointmentNotificationEmail({ appointment, business }: { appointment: SerializableAppointment, business: SerializableBusiness }) {
     if (!emailUser || !emailPass) {
        console.error("Email credentials are not set on the server.");
        // Avoid throwing an error that breaks the booking flow, just log it.
        return { message: 'Email service is not configured on the server.' };
    }

    try {
        const { client, time, clientPhone, clientEmail } = appointment;
        const offering = appointmentOffering(appointment);
        const safeClient = escapeHtml(client);
        const safeOffering = escapeHtml(offering.value);
        const safeTime = escapeHtml(time);
        const safePhone = escapeHtml(clientPhone);
        const safeClientEmail = escapeHtml(clientEmail);
        const safeBusinessName = escapeHtml(business.name);
        const date = new Date(appointment.date);

        if (!business.bookingSettings?.notificationEmail) {
            return { message: 'No business email provided, nothing to send.' };
        }
        
        const formattedDate = format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
        const dashboardUrl = `${getVerticalOrigin(getVerticalFromBusinessType(business.businessType))}/dashboard/calendario`;

        const transporter = getEmailTransporter();

        const mailOptions = {
            from: `Pediturno <${emailSender}>`,
            replyTo: emailReplyTo,
            to: business.bookingSettings.notificationEmail,
            subject: safeSubject(`¡Nuevo Turno Agendado! - ${client} para el ${format(date, 'dd/MM')}`),
            html: `
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: auto;">
                                    <tr>
                                        <td align="center" style="padding: 40px 20px; border-bottom: 1px solid #eeeeee;">
                                            <h1 style="margin: 0; color: #333333; font-size: 24px;">¡Tienes un nuevo turno!</h1>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 30px 40px; color: #555555; line-height: 1.6; font-size: 16px;">
                                            <p>¡Buenas noticias!</p>
                                            <p>Se ha agendado un nuevo turno en tu negocio <strong>${safeBusinessName}</strong>. Aquí están los detalles:</p>
                                            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                                <p style="margin: 10px 0;"><strong>Cliente:</strong> ${safeClient}</p>
                                                <p style="margin: 10px 0;"><strong>${offering.label}:</strong> ${safeOffering}</p>
                                                <p style="margin: 10px 0;"><strong>Día:</strong> ${formattedDate}</p>
                                                <p style="margin: 10px 0;"><strong>Hora:</strong> ${safeTime}</p>
                                                <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 15px 0;">
                                                <p style="margin: 10px 0;"><strong>Contacto del Cliente:</strong></p>
                                                <p style="margin: 10px 0;">- Tel/WhatsApp: ${safePhone}</p>
                                                ${clientEmail ? `<p style="margin: 10px 0;">- Email: ${safeClientEmail}</p>` : ''}
                                            </div>
                                            <p>El turno ya figura en tu calendario del panel.</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 20px 40px 40px; text-align: center;">
                                            <a href="${dashboardUrl}" style="background-color: #333333; color: #ffffff; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin-top: 10px;">
                                                Ir a mi Calendario
                                            </a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
            `,
        };

        await transporter.sendMail(mailOptions);
        return { success: true, message: 'New appointment notification sent successfully' };
    } catch (error: any) {
        console.warn('Error sending new-appointment notification email:', error?.message || error);
        return { success: false, message: error?.message || 'Failed to send new appointment notification email.' };
    }
}
