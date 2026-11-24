"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { FIREBASE_READY_ERROR, useFirebaseReady } from '@/hooks/useFirebaseReady';
import { usePathname, useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, error: null, retry: () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const connection = useFirebaseReady();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection.ready || !auth) return;
    let active = true;
    setLoading(true);
    setAuthError(null);
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!active) return;
      setUser(currentUser);
      setLoading(false);
    }, () => {
      if (active) { setAuthError(FIREBASE_READY_ERROR); setLoading(false); }
    });
    return () => { active = false; unsubscribe(); };
  }, [connection.ready]);

  return (
    <AuthContext.Provider value={{ user, loading: !connection.ready || loading,
      error: connection.error || authError, retry: connection.retry }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const useAuthRedirect = () => {
  const { user, loading, error } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !error && !user && pathname.startsWith('/dashboard')) router.push('/');
  }, [user, loading, error, router, pathname]);
};
