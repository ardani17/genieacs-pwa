"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SessionDTO } from "@contracts/api.ts";

export type SessionState =
  | { phase: "loading" }
  | { phase: "authenticated"; session: SessionDTO }
  | { phase: "anonymous" };

const SessionContext = createContext<{
  state: SessionState;
  refresh: () => Promise<void>;
  clear: () => void;
}>({ state: { phase: "loading" }, refresh: async () => {}, clear: () => {} });

// SessionDTO lives in MEMORY only — never localStorage/IndexedDB. The
// backend remains the authority: it re-checks permission on every
// action; this cache only drives navigation visibility.
export function SessionProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: SessionState;
}) {
  const [state, setState] = useState<SessionState>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/app/session", { cache: "no-store" });
      if (res.status === 401) {
        setState({ phase: "anonymous" });
        return;
      }
      if (!res.ok) return; // keep the last known state on transient errors
      // The BFF proxies the NATIVE SessionDTO directly (no ok/data
      // envelope): a top-level username means authenticated.
      const dto = (await res.json()) as SessionDTO | null;
      if (dto && typeof dto.username === "string" && dto.username)
        setState({ phase: "authenticated", session: dto });
    } catch {
      // network error: keep state; backend still guards every action
    }
  }, []);

  const clear = useCallback(() => setState({ phase: "anonymous" }), []);

  useEffect(() => {
    if (initial.phase !== "authenticated") return undefined;
    const interval = setInterval(refresh, 30_000);
    const onFocus = (): void => void refresh();
    window.addEventListener("focus", onFocus);
    return (): void => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [initial.phase, refresh]);

  const value = useMemo(
    () => ({ state, refresh, clear }),
    [state, refresh, clear],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
