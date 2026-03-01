'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider, isInitialized } from '@/lib/firebase-client';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
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
      } else {
          // ensure cookie is cleared if firebase thinks we are logged out
          await fetch('/api/auth/logout', { method: 'POST' });
          router.refresh();
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
    <AuthContext.Provider value={{ user, loading, error, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
