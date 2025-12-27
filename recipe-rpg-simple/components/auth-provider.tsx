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
    const forceMock = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';
    
    if (!isInitialized || forceMock) {
        // Mock Auth check from cookie for E2E/Local
        const checkMockCookie = () => {
             const match = document.cookie.match(/session=(mock-[^;]+)/);
             if (match) {
                 let uid = match[1];
                 if (uid.startsWith('mock-')) uid = uid.replace('mock-', '');
                 // Mock User object
                 const mockUser: any = { 
                     uid, 
                     email: `${uid}@test.com`, 
                     displayName: uid,
                     getIdToken: async () => 'mock-token'
                 };
                 setUser(mockUser);
             } else {
                 setUser(null);
             }
             setLoading(false);
        };
        checkMockCookie();
        // Also listen for cookie changes if possible, or just run once. 
        // For E2E we usually reload page or set cookie before load.
        return;
    }

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
    return () => unsubscribe();
  }, [router]);

  const signIn = async () => {
    setError(null);
    const forceMock = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

    if (!isInitialized || forceMock) {
        try {
            // Mock Login: Send a fake token. The backend (if in mock mode) will use it to create a session cookie.
            const mockUid = 'user-' + Math.floor(Math.random() * 10000);
            await fetch('/api/auth/login', { 
                method: 'POST', 
                body: JSON.stringify({ idToken: `mock-${mockUid}` }) 
            });
            window.location.reload();
        } catch (e) {
            console.error('Mock login failed', e);
        }
        return;
    }

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
    const forceMock = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

    if (!isInitialized || forceMock) {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            setUser(null);
            router.refresh();
        } catch (e) {
            console.error('Mock logout failed:', e);
        }
        return;
    }

    try {
      await signOut(auth);
      // onAuthStateChanged will handle the rest (cookie clear + refresh)
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
