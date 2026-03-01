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

import { cookies, headers } from 'next/headers';
import { auth, db, isFirebaseEnabled } from '@/lib/firebase-admin';
import { AUTH_DISABLED } from './config';

export interface AuthSession {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  isAdmin: boolean;
}

export interface AuthService {
  verifyAuth(): Promise<AuthSession | null>;
}

export class RealAuthService implements AuthService {
  async verifyAuth(): Promise<AuthSession | null> {
    
    // 0. Global Auth Disable Flag
    if (AUTH_DISABLED) {
        return { uid: 'disabled-auth-user', email: 'admin@noauth.com', name: 'Admin User', isAdmin: true };
    }

    // 1. Mock/Local Bypass (if Firebase Admin is not configured OR Mock forced)
    if (!isFirebaseEnabled || process.env.NEXT_PUBLIC_MOCK_AUTH === 'true') {
        // Check if ANY auth token/cookie is present to simulate "logged in" state
        // If the client sends a token/cookie, we treat them as a logged-in admin.
        const authHeader = (await headers()).get('Authorization');
        const cookieStore = await cookies();
        const sessionCookie = cookieStore.get('session')?.value;

        if (authHeader || sessionCookie) {
            let uid = (sessionCookie?.startsWith('mock-') ? sessionCookie : 'mock-local-user');
            if (uid.startsWith('mock-')) uid = uid.replace('mock-', '');
            
            return { uid, email: `${uid}@localhost`, name: uid, isAdmin: true };
        }
        return null;
    }

    // In production/real mode, strictly check headers/cookies.
    try {
        let token = '';
        let isSessionCookie = false;
        
        // 1. Check Authorization Header (API / Bearer)
        const authHeader = (await headers()).get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
            token = authHeader.split('Bearer ')[1];
        }
        
        // 2. Check Session Cookie (Site)
        if (!token) {
            const cookieStore = await cookies();
            token = cookieStore.get('session')?.value || '';
            isSessionCookie = true;
        }

        if (!token) return null;

        let decoded = null;
        // Basic format check to prevent "argument must be object" errors if token is weird
        if (token && typeof token === 'string' && token.length > 10) {
            if (isSessionCookie) {
                decoded = await auth.verifySessionCookie(token, true).catch((e) => {
                    // Ignore common errors, log weird ones
                    if (e.code !== 'auth/session-cookie-expired' && e.code !== 'auth/argument-error') {
                        console.warn('verifySessionCookie failed:', e.message);
                    }
                    return null;
                });
                
                if (!decoded) {
                    // Fallback: Check if the cookie holds a raw ID token
                    decoded = await auth.verifyIdToken(token).catch(() => null);
                }
            } else {
                decoded = await auth.verifyIdToken(token).catch(() => null);
            }
        }

        if (!decoded) return null;
        
        // Check Firestore for Admin flag
        let isDbAdmin = false;
        try {
            const userDoc = await db.collection('users').doc(decoded.uid).get();
            isDbAdmin = userDoc.data()?.isAdmin === true;
        } catch (e) {
            console.warn('Failed to fetch user permissions from Firestore:', e);
        }
        
        return this.mapUser(decoded, isDbAdmin);

    } catch (e) {
        console.error('Auth verification failed', e);
        return null;
    }
  }

  private mapUser(decoded: any, isDbAdmin: boolean): AuthSession {
    const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    const email = decoded.email || '';
    const isEnvAdmin = admins.includes(email.toLowerCase());
    
    return {
        uid: decoded.uid,
        email,
        name: decoded.name || decoded.display_name,
        picture: decoded.picture || decoded.photo_url,
        isAdmin: isDbAdmin || isEnvAdmin
    };
  }
}

export class MockAuthService implements AuthService {
  private mockUser: AuthSession | null;

  constructor(user: AuthSession | null = { uid: 'mock-user', email: 'mock@example.com', name: 'Mock User', isAdmin: true }) {
      this.mockUser = user;
  }

  async verifyAuth(): Promise<AuthSession | null> {
    return this.mockUser;
  }
}

// --- Singleton / Factory ---
let currentAuthService: AuthService | null = null;

export function getAuthService(): AuthService {
  if (currentAuthService) return currentAuthService;
  
  // Default to RealAuthService. 
  // Note: If Firebase is disabled but we try to use RealAuthService, it might crash on 'auth' import access 
  // if 'auth' wasn't exported or initialized? 
  // lib/firebase-admin.ts initializes 'app' safely. 'auth' export exists.
  // So it's safe to instantiate.
  currentAuthService = new RealAuthService();
  return currentAuthService;
}

export function setAuthService(service: AuthService) {
    currentAuthService = service;
}