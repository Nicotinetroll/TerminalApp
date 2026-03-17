import { useCallback, useEffect, useRef } from "react";
import { playSound } from "@/lib/sounds";
import { useGlobalSettings } from "./useGlobalSettings";

const isTauri = () => "__TAURI__" in window;

export function useNotifications() {
  const { settings } = useGlobalSettings();
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (isTauri()) {
      // Tauri: request native notification permission
      import("@tauri-apps/plugin-notification").then(({ isPermissionGranted, requestPermission }) => {
        isPermissionGranted().then((granted) => {
          if (granted) {
            permissionRef.current = "granted";
          } else {
            requestPermission().then((perm) => {
              permissionRef.current = perm === "granted" ? "granted" : "denied";
            });
          }
        });
      }).catch(() => {});
    } else if ("Notification" in window) {
      permissionRef.current = Notification.permission;
      if (Notification.permission === "default") {
        void Notification.requestPermission().then((p) => {
          permissionRef.current = p;
        });
      }
    }
  }, []);

  const playChatSound = useCallback(() => {
    if (settings["chat_sound_enabled"] !== "true") return;
    const soundType = (settings["chat_sound"] ?? "ping") as "ping" | "blip" | "knock" | "none";
    playSound(soundType);
  }, [settings]);

  const playMailSound = useCallback(() => {
    if (settings["mail_sound_enabled"] !== "true") return;
    const soundType = (settings["mail_sound"] ?? "ping") as "ping" | "blip" | "knock" | "none";
    playSound(soundType);
  }, [settings]);

  const showBrowserNotification = useCallback((title: string, body?: string) => {
    if (permissionRef.current !== "granted") return;
    if (document.hasFocus()) return;

    if (isTauri()) {
      // Native macOS notification via Tauri
      import("@tauri-apps/plugin-notification").then(({ sendNotification }) => {
        sendNotification({ title, body: body ?? "" });
      }).catch(() => {});
    } else {
      try {
        new Notification(title, {
          body,
          icon: "/favicon.ico",
          silent: true, // we handle our own sounds
        });
      } catch {
        // not available
      }
    }
  }, []);

  return { playChatSound, playMailSound, showBrowserNotification };
}
