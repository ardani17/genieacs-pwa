"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  initialConnectionState,
  reduceConnection,
  type ConnectionState,
} from "@/lib/connection-state";

const ConnectionContext = createContext<ConnectionState>(
  initialConnectionState(),
);

// Probes /api/app/health every 15s while visible (or on tab focus), 2s
// timeout, never overlapping. navigator online/offline only trigger an
// immediate checking + probe.
export function ConnectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ConnectionState>(initialConnectionState);
  const probing = useRef(false);

  const probe = useCallback(async () => {
    if (probing.current) return; // no parallel overlap
    probing.current = true;
    setState((s) => reduceConnection(s, { type: "probe_start" }));
    try {
      const res = await fetch("/api/app/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = await res.json();
        setState((s) => reduceConnection(s, { type: "probe_ok" }));
        if (body?.data?.vpnState)
          setState((s) =>
            reduceConnection(s, { type: "vpn", state: body.data.vpnState }),
          );
        return;
      }
      setState((s) => reduceConnection(s, { type: "probe_fail" }));
    } catch {
      setState((s) => reduceConnection(s, { type: "probe_fail" }));
    } finally {
      probing.current = false;
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void probe(), 0);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void probe();
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void probe();
    };
    const onOnline = () => {
      setState((s) => reduceConnection(s, { type: "online_hint" }));
      void probe();
    };
    const onOffline = () => {
      setState((s) => reduceConnection(s, { type: "offline_hint" }));
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [probe]);

  return (
    <ConnectionContext.Provider value={state}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionState {
  return useContext(ConnectionContext);
}
