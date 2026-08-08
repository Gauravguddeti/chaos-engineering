import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const ADMIN_KEY = process.env.ADMIN_KEY;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

export async function POST(request, { params }) {
  const { action } = await params;
  
  if (!['kill', 'slow', 'reset'].includes(action)) {
    return new NextResponse('Invalid action', { status: 400 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get('adminToken')?.value;
  if (token !== ADMIN_KEY) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/admin/${action}`, {
      method: 'POST',
      headers: {
        'X-Admin-Token': token
      }
    });
    
    if (!res.ok) {
      return new NextResponse('Backend error', { status: res.status });
    }
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`Error forwarding chaos action ${action}:`, err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
