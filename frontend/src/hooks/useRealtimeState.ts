import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  loadBootstrap,
  RealtimeSocket,
  type BootstrapPart,
  type BootstrapProgress,
  type BootstrapStageStatus,
  type SocketEvent,
} from "../api";
import {
  createInitialRealtimeState,
  realtimeReducer,
} from "../features/realtime/realtimeReducer";

export function useRealtimeState() {
  const [state, dispatch] = useReducer(
    realtimeReducer,
    undefined,
    createInitialRealtimeState,
  );
  const socketRef = useRef<RealtimeSocket | null>(null);
  const [boot, setBoot] = useState<BootstrapProgress>({
    network: { status: "waiting", detail: "Waiting for map geometry" },
    state: { status: "waiting", detail: "Waiting for runtime state" },
    channel: { status: "waiting", detail: "Waiting for core services" },
  });

  const reportBootstrap = useCallback(
    (part: BootstrapPart, status: BootstrapStageStatus, detail: string) => {
      setBoot((current) => ({
        ...current,
        [part]: { status, detail },
      }));
    },
    [],
  );

  const onEvent = useCallback((event: SocketEvent) => {
    dispatch({
      type: "socket_event",
      event,
      receivedAt: performance.now(),
    });
  }, []);

  useEffect(() => {
    let active = true;
    loadBootstrap(reportBootstrap)
      .then((bootstrap) => {
        if (!active) return;
        dispatch({ type: "bootstrap", payload: bootstrap });
        setBoot((current) => ({
          ...current,
          channel: { status: "loading", detail: "Opening live event channel" },
        }));
        const socket = new RealtimeSocket(onEvent, (connected) => {
          if (!active) return;
          dispatch({ type: "connection_changed", connected });
          setBoot((current) => ({
            ...current,
            channel: connected
              ? { status: "ready", detail: "Live event channel connected" }
              : { status: "failed", detail: "Live channel retrying" },
          }));
        });
        socketRef.current = socket;
        socket.connect();
      })
      .catch((reason: Error) => {
        if (active) {
          dispatch({ type: "load_failed", message: reason.message });
          setBoot((current) => ({
            ...current,
            channel: { status: "failed", detail: "Core services unavailable" },
          }));
        }
      });
    return () => {
      active = false;
      socketRef.current?.close();
    };
  }, [onEvent, reportBootstrap]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      socketRef.current?.send("ping", { client_time: performance.now() });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: "lightning_tick", now: performance.now() });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const send = useCallback(
    (type: string, payload: Record<string, unknown>) =>
      socketRef.current?.send(type, payload),
    [],
  );

  return { ...state, boot, send };
}
