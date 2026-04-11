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

'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, googleProvider, isInitialized, db } from '@/lib/firebase-client';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  loading: true,
  error: null,
  signIn: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    console.log('[AuthProvider] Initializing...');

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
          try {
              const token = await currentUser.getIdToken();
              await fetch('/api/auth/login', {
                  method: 'POST',
                  body: JSON.stringify({ idToken: token })
              });
              router.refresh();
          } catch (e) {
              console.error('Failed to sync session:', e);
          }
          // Check isAdmin from Firestore — not a security control, just for UI visibility
          try {
              const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
              setIsAdmin(userDoc.data()?.isAdmin === true);
          } catch {
              setIsAdmin(false);
          }
      } else {
          // ensure cookie is cleared if firebase thinks we are logged out
          await fetch('/api/auth/logout', { method: 'POST' });
          router.refresh();
          setIsAdmin(false);
      }
      setLoading(false);
    });

    // Safety timeout: If emulator/auth is unreachable, don't block app forever
    const timer = setTimeout(() => {
        setLoading((currentLoading) => {
            if (currentLoading) {
                console.warn('[AuthProvider] Auth listener timed out. Proceeding unauthenticated.');
                return false;
            }
            return currentLoading;
        });
    }, 2000);

    return () => {
        clearTimeout(timer);
        unsubscribe();
    };
  }, [router]);

  const signIn = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Login failed:', err);
      let msg = 'Failed to sign in.';
      if (err.code === 'auth/popup-closed-by-user') msg = 'Sign-in cancelled.';
      if (err.message) msg = err.message;
      setError(msg);
    }
  };

  const logout = async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (err: any) {
      console.error('Logout failed:', err);
      setError(err.message || 'Logout failed');
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, error, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);