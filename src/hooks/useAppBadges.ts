import { useState, useEffect, useCallback, useRef } from "react";
import { getToken } from "@/lib/api";

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";
const isTauri = () => "__TAURI__" in window;

export function useAppBadges() {
  const [badges, setBadges] = useState<Record<string, number>>({});
  const badgesRef = useRef(badges);
  badgesRef.current = badges;

  // Sync badge count to Dock icon when running in Tauri
  useEffect(() => {
    if (!isTauri()) return;
    const total = Object.values(badges).reduce((sum, n) => sum + n, 0);
    import("@tauri-apps/api/core").then(({ invoke }) => {
      if (total > 0) {
        invoke("set_badge_count", { count: total }).catch(() => {});
      } else {
        invoke("clear_badge").catch(() => {});
      }
    }).catch(() => {});
  }, [badges]);

  // Fetch initial mail unread count
  useEffect(() => {
    let alive = true;
    const token = getToken();
    if (!token) return;

    fetch(`${API_BASE}/mail/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, { total: number; unread: number }> | null) => {
        if (!alive || !data) return;
        const inboxUnread = data["inbox"]?.unread ?? 0;
        if (inboxUnread > 0) {
          setBadges((prev) => ({ ...prev, mail: inboxUnread }));
        }
      })
      .catch(() => {});

    return () => { alive = false; };
  }, []);

  // Connect socket early & listen to events
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let unmounted = false;

    import("@/lib/socket").then(({ getSocket }) => {
      if (unmounted) return;
      let socket;
      try {
        socket = getSocket();
      } catch {
        return; // no token — guest user
      }

      const onMailNew = () => {
        setBadges((prev) => ({ ...prev, mail: (prev["mail"] ?? 0) + 1 }));
      };
      const onMessageNew = () => {
        setBadges((prev) => ({ ...prev, whisper: (prev["whisper"] ?? 0) + 1 }));
      };

      socket.on("mail:new", onMailNew);
      socket.on("message:new", onMessageNew);

      cleanup = () => {
        socket.off("mail:new", onMailNew);
        socket.off("message:new", onMessageNew);
      };
    }).catch(() => {});

    return () => {
      unmounted = true;
      if (cleanup) cleanup();
    };
  }, []);

  const clearBadge = useCallback((app: string) => {
    setBadges((prev) => {
      if (!prev[app]) return prev;
      const next = { ...prev };
      delete next[app];
      return next;
    });
  }, []);

  return { badges, clearBadge };
}
