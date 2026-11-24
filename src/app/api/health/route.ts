import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ ok: true, release: '20261107-servicios-correo-opcional', nodeMajor: Number(process.versions.node.split('.')[0]) }, { headers: { 'Cache-Control': 'no-store' } });
}
