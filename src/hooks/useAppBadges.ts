import { useState, useEffect, useCallback, useRef } from "react";
import { getToken } from "@/lib/api";

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";
const isTauri = () => "__TAURI__" in window;

// Original favicon href (before we touch it)
const ORIGINAL_FAVICON = "/favicon.png?v=2";

// Canvas-draw a favicon with a red notification dot overlay
function setFaviconBadge(hasNotif: boolean) {
  const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) return;

  if (!hasNotif) {
    // Restore original favicon
    if (!link.href.endsWith(ORIGINAL_FAVICON)) link.href = ORIGINAL_FAVICON;
    return;
  }

  // Draw notification badge on top of the real favicon
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 64, 64);
    // Red dot top-right
    ctx.beginPath();
    ctx.arc(52, 12, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#f44";
    ctx.fill();
    link.href = canvas.toDataURL("image/png");
  };
  img.src = ORIGINAL_FAVICON;
}

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

  // Page title + favicon badge
  useEffect(() => {
    const total = Object.values(badges).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total}) MyNigga` : "MyNigga";
    setFaviconBadge(total > 0);
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

  const clearBadge = useCallback((app: string) => {
    setBadges((prev) => {
      if (!prev[app]) return prev;
      const next = { ...prev };
      delete next[app];
      return next;
    });
  }, []);

  const updateBadge = useCallback((app: string, count: number) => {
    setBadges((prev) => {
      if (count <= 0) {
        if (!prev[app]) return prev;
        const next = { ...prev };
        delete next[app];
        return next;
      }
      if (prev[app] === count) return prev;
      return { ...prev, [app]: count };
    });
  }, []);

  return { badges, clearBadge, updateBadge };
}
