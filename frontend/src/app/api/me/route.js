import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const ADMIN_KEY = process.env.ADMIN_KEY;

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('adminToken')?.value;
  return NextResponse.json({ isAdmin: token === ADMIN_KEY });
}
