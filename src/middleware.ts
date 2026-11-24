import { NextRequest, NextResponse } from 'next/server';

const PORTAL_HOSTS = new Set([
  'pediturno.com', 'www.pediturno.com', 'canchas.pediturno.com', 'espacios.pediturno.com',
]);

export function middleware(request: NextRequest) {
  const reference = request.headers.get('next-action');
  if (request.method === 'POST' && reference !== null && !/^[a-f0-9]{42}$/i.test(reference)) {
    const requestId = crypto.randomUUID();
    const requestHost = request.headers.get('host')?.toLowerCase().split(':')[0];
    const urlHost = request.nextUrl.hostname.toLowerCase();
    const host = requestHost && PORTAL_HOSTS.has(requestHost) ? requestHost :
      PORTAL_HOSTS.has(urlHost) ? urlHost : 'unknown';
    console.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      host,
      route: 'server-action',
      status: 400,
      requestId,
      cause: 'INVALID_REFERENCE_FORMAT',
    }));
    return new NextResponse('Referencia de formulario inválida.', {
      status: 400,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [{ source: '/:path*', has: [{ type: 'header', key: 'next-action' }] }],
};
