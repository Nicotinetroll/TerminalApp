import { useEffect } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { setAppRestrictions } from "@/core/appRestrictions";

export function AppRestrictionSync() {
  const { settings } = useGlobalSettings();

  useEffect(() => {
    try {
      const raw = settings["app_restrictions"];
      if (raw) {
        setAppRestrictions(JSON.parse(raw) as Record<string, string>);
      } else {
        setAppRestrictions({});
      }
    } catch {
      setAppRestrictions({});
    }
  }, [settings]);

  return null;
}
