'use client';

import type { AuthResultDTO, MeDTO } from '@orbit/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setSessionToken, setUnauthorizedHandler } from './api';

const STORAGE_KEY = 'orbit.session.v1';

interface SessionValue {
  user: MeDTO | null;
  token: string | null;
  ready: boolean;
  signIn: (result: AuthResultDTO) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function readStored(): AuthResultDTO | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthResultDTO) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthResultDTO | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setSessionToken(stored?.token ?? null);
    setSession(stored);
    setReady(true);
  }, []);

  const signIn = useCallback((result: AuthResultDTO) => {
    setSessionToken(result.token);
    setSession(result);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } catch {
      // Private mode etc.: the session simply won't survive a reload.
    }
  }, []);

  const signOut = useCallback(() => {
    setSessionToken(null);
    setSession(null);
    queryClient.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [queryClient]);

  useEffect(() => setUnauthorizedHandler(signOut), [signOut]);

  const value = useMemo<SessionValue>(
    () => ({ user: session?.user ?? null, token: session?.token ?? null, ready, signIn, signOut }),
    [session, ready, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
