import { useEffect } from "react";
import { useNotifications } from "./useNotifications";

export function useMailNotifications() {
  const { playMailSound, showBrowserNotification } = useNotifications();

  useEffect(() => {
    // Dynamic import to avoid circular deps — socket may not be connected
    let cleanup: (() => void) | null = null;

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
    }).catch(() => { /* no socket */ });

    return () => {
      if (cleanup) cleanup();
    };
  }, [playMailSound, showBrowserNotification]);
}
