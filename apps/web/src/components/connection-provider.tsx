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
import { useSession } from "./session-provider";
import { hasResourceAccess } from "@/lib/permissions";

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
  const { state: sessionState } = useSession();
  const canReadVpn =
    sessionState.phase === "authenticated" &&
    hasResourceAccess(sessionState.session, "vpn", 1);
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

  useEffect(() => {
    if (!canReadVpn) return undefined;
    let disposed = false,
      probingVpn = false;
    const poll = async () => {
      if (probingVpn || document.visibilityState === "hidden") return;
      probingVpn = true;
      let vpn: ConnectionState["vpn"] = "unavailable";
      try {
        const response = await fetch("/api/app/vpn/status", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        const body = await response.json();
        if (
          response.ok &&
          body.ok &&
          [
            "unconfigured",
            "connecting",
            "connected",
            "retry_wait",
            "auth_failed",
            "route_error",
            "host_unsupported",
            "stopped",
          ].includes(body.data?.state)
        )
          vpn = body.data.state;
      } catch {
        /* independent from app liveness */
      }
      if (!disposed)
        setState((s) => reduceConnection(s, { type: "vpn", state: vpn }));
      probingVpn = false;
    };
    const first = setTimeout(() => void poll(), 0),
      timer = setInterval(() => void poll(), 15000);
    const visible = () => void poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [canReadVpn]);

  return (
    <ConnectionContext.Provider value={state}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionState {
  return useContext(ConnectionContext);
}
