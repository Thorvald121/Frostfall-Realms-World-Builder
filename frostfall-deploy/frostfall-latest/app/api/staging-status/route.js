import { NextResponse } from 'next/server';

// An intentionally minimal, non-sensitive staging marker. Unlike a generic
// homepage 200 it proves the deployed artifact has the P6 staging route.
// Never return secrets, database identifiers, user information or config URLs.
export async function GET() {
  if (process.env.FROSTFALL_DEPLOYMENT_ROLE !== 'staging') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ application: 'frostfall-realms', stage: 'staging', gate: 'p6' }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
