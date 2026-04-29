import { useState, useCallback, useRef } from "react";

export interface GlobalEvent {
  id: number;
  type: string;
  message: string;
  timestamp: number;
}

export function useGlobalEvents(_onEvent?: (event: GlobalEvent) => void) {
  const [events, setEvents] = useState<GlobalEvent[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // No socket.io — events will never arrive. Hook is kept for interface compatibility.

  return { events, dismiss };
}
