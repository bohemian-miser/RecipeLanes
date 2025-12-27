import { auth, isFirebaseEnabled } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

function getUidFromToken(token: string) {
    try {
        const payload = token.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
        return decoded.user_id || decoded.sub;
    } catch (e) {
        return null;
    }
}

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();
    if (!idToken) return NextResponse.json({ error: 'Missing ID Token' }, { status: 400 });

    // 5 days
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    let sessionCookie;

    try {
        if (isFirebaseEnabled) {
            sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
        } else {
            const uid = getUidFromToken(idToken) || 'local-user';
            sessionCookie = `mock-${uid}`;
        }
    } catch (e) {
        console.warn('Failed to create session cookie (likely ADC permissions), falling back to ID token.', e);
        sessionCookie = idToken;
    }

    (await cookies()).set('session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      sameSite: 'lax',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
