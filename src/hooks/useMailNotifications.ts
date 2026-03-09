import { useEffect } from "react";
import { useNotifications } from "./useNotifications";

export function useMailNotifications() {
  const { playMailSound, showBrowserNotification } = useNotifications();

  useEffect(() => {
    // Dynamic import to avoid circular deps — socket may not be connected
    let cleanup: (() => void) | null = null;
    let unmounted = false;

    import("@/lib/socket").then(({ getSocketIfConnected }) => {
      const socket = getSocketIfConnected();
      if (!socket) return;

      const handler = (data: { from?: string; subject?: string }) => {
        playMailSound();
        showBrowserNotification(
          "new mail",
          `from ${data.from ?? "unknown"}: ${data.subject ?? "(no subject)"}`
        );
      };

      socket.on("mail:new", handler);
      cleanup = () => socket.off("mail:new", handler);

      // If already unmounted by the time promise resolves, clean up immediately
      if (unmounted) cleanup();
    }).catch(() => { /* no socket */ });

    return () => {
      unmounted = true;
      if (cleanup) cleanup();
    };
  }, [playMailSound, showBrowserNotification]);
}
