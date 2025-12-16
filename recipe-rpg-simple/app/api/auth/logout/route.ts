import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST() {
  cookies().delete('session');
  return NextResponse.json({ success: true });
}
