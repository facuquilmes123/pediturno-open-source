
import { NextResponse, NextRequest } from 'next/server';
import { processWebhookNotificationAdmin } from '@/services/mercadopago';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const topic = body.topic || body.type;
        const action = body.action;

        console.log('[MP Webhook] Received webhook notification:', { body });

        if (body.action === 'test.created') {
            console.log('[MP Webhook] Test notification received. Responding 200 OK.');
            return NextResponse.json({ status: 'ok' }, { status: 200 });
        }

        // Handle both 'payment' topic and 'payment.updated' action
        if ((topic === 'payment' || action === 'payment.updated') && body.data?.id) {
            const paymentId = body.data.id;
            // Use the new admin function to process the payment
            await processWebhookNotificationAdmin(paymentId);
            return NextResponse.json({ status: 'received' }, { status: 200 });
        }
        
        console.log(`[MP Webhook] Received a non-payment notification (topic: ${topic}, action: ${action}). Acknowledging.`);
        return NextResponse.json({ status: 'ignored' }, { status: 200 });

    } catch (error) {
        console.error('[MP Webhook] Error handling webhook:', error);
        return NextResponse.json({ error: 'Webhook processing failed internally.' }, { status: 200 });
    }
}
