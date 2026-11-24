import { NextResponse } from 'next/server';

// Bulk deletion is intentionally unavailable through a web request.
export async function POST() {
  return NextResponse.json({ error: 'Operation unavailable' }, { status: 404 });
}
