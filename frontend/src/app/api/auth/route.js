import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const ADMIN_KEY = process.env.ADMIN_KEY;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (key === ADMIN_KEY) {
    cookies().set('adminToken', key, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return NextResponse.redirect(new URL('/', request.url));
  }

  return new NextResponse('Unauthorized', { status: 401 });
}
