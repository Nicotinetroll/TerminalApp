import { useEffect, useRef, useCallback } from "react";
import { getToken } from "@/lib/api";
import { useNotifications } from "./useNotifications";

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";
const POLL_INTERVAL = 15_000;

interface MailStats {
  [folder: string]: { total: number; unread: number } | undefined;
}

export function useMailNotifications(
  updateBadge?: (app: string, count: number) => void
) {
  const prevUnreadRef = useRef<number | null>(null);
  const { playMailSound, showBrowserNotification } = useNotifications();

  const poll = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/mail/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const wrapper = (await res.json()) as { stats: MailStats };
      const unread = wrapper.stats["inbox"]?.unread ?? 0;

      // Update badge
      if (updateBadge) updateBadge("mail", unread);

      // Check for new mail since last poll
      const prev = prevUnreadRef.current;
      if (prev !== null && unread > prev) {
        const newCount = unread - prev;
        playMailSound();
        showBrowserNotification(
          "New Mail",
          newCount === 1
            ? "You have 1 new message"
            : `You have ${newCount} new messages`
        );
      }

      prevUnreadRef.current = unread;
    } catch { /* silent */ }
  }, [updateBadge, playMailSound, showBrowserNotification]);

  useEffect(() => {
    void poll();
    const iv = setInterval(() => void poll(), POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [poll]);

  return { poll };
}
