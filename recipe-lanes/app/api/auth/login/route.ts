/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
        if (isFirebaseEnabled && process.env.NEXT_PUBLIC_MOCK_AUTH !== 'true') {
            sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
        } else {
            const uid = getUidFromToken(idToken) || 'local-user';
            sessionCookie = idToken.startsWith('mock-') ? idToken : `mock-${uid}`;
        }
    } catch (e) {
        console.warn('Failed to create session cookie (likely ADC permissions), falling back to ID token.', e);
        sessionCookie = idToken;
    }

    (await cookies()).set('session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: process.env.NEXT_PUBLIC_MOCK_AUTH !== 'true', // Allow client read if mocking
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