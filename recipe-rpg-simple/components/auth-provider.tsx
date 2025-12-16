'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase-client';

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
          try {
              const token = await currentUser.getIdToken();
              await fetch('/api/auth/login', { 
                  method: 'POST', 
                  body: JSON.stringify({ idToken: token }) 
              });
          } catch (e) {
              console.error('Failed to sync session:', e);
              // Don't block UI on session sync fail, but maybe log it?
          }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
      await fetch('/api/auth/logout', { method: 'POST' });
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
