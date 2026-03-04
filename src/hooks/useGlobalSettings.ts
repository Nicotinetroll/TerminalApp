import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { getGlobalSettings, updateGlobalSettings } from "@/lib/api";

interface GlobalSettingsContextValue {
  settings: Record<string, string>;
  loading: boolean;
  updateSetting: (key: string, value: string) => Promise<void>;
  updateSettings: (updates: Record<string, string>) => Promise<void>;
  refresh: () => Promise<void>;
}

const GlobalSettingsContext = createContext<GlobalSettingsContextValue>({
  settings: {},
  loading: true,
  updateSetting: async () => {},
  updateSettings: async () => {},
  refresh: async () => {},
});

export function useGlobalSettings(): GlobalSettingsContextValue {
  return useContext(GlobalSettingsContext);
}

export function GlobalSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getGlobalSettings();
      setSettings(data);
    } catch {
      // silently fail — settings are optional
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSetting = useCallback(async (key: string, value: string) => {
    try {
      const updated = await updateGlobalSettings({ [key]: value });
      setSettings(updated);
    } catch {
      // silently fail
    }
  }, []);

  const updateSettingsBulk = useCallback(async (updates: Record<string, string>) => {
    try {
      const updated = await updateGlobalSettings(updates);
      setSettings(updated);
    } catch {
      // silently fail
    }
  }, []);

  return createElement(
    GlobalSettingsContext.Provider,
    {
      value: {
        settings,
        loading,
        updateSetting,
        updateSettings: updateSettingsBulk,
        refresh,
      },
    },
    children
  );
}
