import { useEffect, useState, useCallback, useRef } from "react";
import { playSound } from "@/lib/sounds";

export interface GlobalEvent {
  id: number;
  type: string;
  message: string;
  timestamp: number;
}

let nextId = 1;

export function useGlobalEvents(onEvent?: (event: GlobalEvent) => void) {
  const [events, setEvents] = useState<GlobalEvent[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const dismiss = useCallback((id: number) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let unmounted = false;

    import("@/lib/socket").then(({ getSocket }) => {
      if (unmounted) return;
      let socket;
      try { socket = getSocket(); } catch { return; }

      const handler = (data: { type: string; message: string }) => {
        const id = nextId++;
        const event: GlobalEvent = {
          id,
          type: data.type,
          message: data.message,
          timestamp: Date.now(),
        };

        setEvents((prev) => {
          const next = [...prev, event];
          // Max 3 stacked
          if (next.length > 3) return next.slice(-3);
          return next;
        });

        playSound("blip");
        onEventRef.current?.(event);

        // Auto-dismiss after 5s
        const timer = setTimeout(() => {
          setEvents((prev) => prev.filter((e) => e.id !== id));
          timersRef.current.delete(id);
        }, 5000);
        timersRef.current.set(id, timer);
      };

      socket.on("global:event", handler);
      cleanup = () => socket.off("global:event", handler);
    }).catch(() => { /* no socket */ });

    return () => {
      unmounted = true;
      if (cleanup) cleanup();
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  return { events, dismiss };
}
