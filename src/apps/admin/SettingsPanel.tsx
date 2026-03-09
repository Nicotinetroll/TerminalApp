import { useState, useCallback, useMemo } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

const SOUND_OPTIONS = [
  { value: "ping", label: "ping" },
  { value: "blip", label: "blip" },
  { value: "knock", label: "knock" },
  { value: "none", label: "none (silent)" },
];

const ALL_SHORTCUT_APPS = [
  "mail", "whisper", "cloud", "nigdit", "memes", "paste", "profile", "games",
  "slots", "coinflip", "ascii", "admin", "stats",
];

export function SettingsPanel() {
  const { settings, updateSetting, loading } = useGlobalSettings();
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const showStatus = useCallback((text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(null), 2000);
  }, []);

  const handleToggle = async (key: string) => {
    const current = settings[key] === "true";
    setSaving(key);
    await updateSetting(key, current ? "false" : "true");
    setSaving(null);
    showStatus(`${key} ${current ? "disabled" : "enabled"}`);
  };

  const handleSelect = async (key: string, value: string) => {
    setSaving(key);
    await updateSetting(key, value);
    setSaving(null);
    showStatus(`${key} set to ${value}`);
  };

  const handleNumber = async (key: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return;
    setSaving(key);
    await updateSetting(key, String(num));
    setSaving(null);
    showStatus(`${key} set to ${num}`);
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading settings...
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0" }}>
      {status && (
        <div className="admin-status" style={{ marginBottom: 12 }}>
          {status}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
          notification sounds
        </div>

        <ToggleRow
          label="chat sounds"
          sublabel="play a sound when someone sends a message in whisper"
          enabled={settings["chat_sound_enabled"] === "true"}
          saving={saving === "chat_sound_enabled"}
          onToggle={() => void handleToggle("chat_sound_enabled")}
        />

        <SelectRow
          label="chat sound type"
          value={settings["chat_sound"] ?? "ping"}
          options={SOUND_OPTIONS}
          saving={saving === "chat_sound"}
          onChange={(v) => void handleSelect("chat_sound", v)}
        />

        <ToggleRow
          label="mail sounds"
          sublabel="play a sound when new mail arrives"
          enabled={settings["mail_sound_enabled"] === "true"}
          saving={saving === "mail_sound_enabled"}
          onToggle={() => void handleToggle("mail_sound_enabled")}
        />

        <SelectRow
          label="mail sound type"
          value={settings["mail_sound"] ?? "ping"}
          options={SOUND_OPTIONS}
          saving={saving === "mail_sound"}
          onChange={(v) => void handleSelect("mail_sound", v)}
        />
      </div>

      <div>
        <div style={{ fontSize: 12, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
          whisper settings
        </div>

        <NumberRow
          label="handle refresh interval (hours)"
          sublabel="anonymous handles auto-refresh after this many hours"
          value={settings["handle_refresh_hours"] ?? "48"}
          saving={saving === "handle_refresh_hours"}
          onChange={(v) => void handleNumber("handle_refresh_hours", v)}
        />
      </div>

      <ShortcutBarSection
        settings={settings}
        updateSetting={updateSetting}
        saving={saving}
        setSaving={setSaving}
        showStatus={showStatus}
      />
    </div>
  );
}

function ToggleRow({ label, sublabel, enabled, saving, onToggle }: {
  label: string;
  sublabel?: string;
  enabled: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 2 }}>{sublabel}</div>}
      </div>
      <button
        className="btn"
        onClick={onToggle}
        disabled={saving}
        style={{
          minWidth: 60,
          background: enabled ? "var(--accent-soft)" : "var(--bg-primary)",
          color: enabled ? "var(--accent)" : "var(--text-muted)",
          borderColor: enabled ? "var(--accent-mid)" : "var(--border-medium)",
        }}
      >
        {saving ? "..." : enabled ? "on" : "off"}
      </button>
    </div>
  );
}

function SelectRow({ label, value, options, saving, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  saving: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
      <select
        className="admin-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        style={{ width: 120 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function ShortcutBarSection({ settings, updateSetting, saving, setSaving, showStatus }: {
  settings: Record<string, string>;
  updateSetting: (key: string, value: string) => Promise<void>;
  saving: string | null;
  setSaving: (s: string | null) => void;
  showStatus: (text: string) => void;
}) {
  const currentApps = useMemo(() => {
    try {
      const raw = settings["shortcut_apps"];
      return raw ? JSON.parse(raw) as string[] : [];
    } catch {
      return [];
    }
  }, [settings]);

  const save = async (next: string[]) => {
    setSaving("shortcut_apps");
    await updateSetting("shortcut_apps", JSON.stringify(next));
    setSaving(null);
    showStatus("shortcut bar updated");
  };

  const handleToggle = async (appName: string) => {
    const next = currentApps.includes(appName)
      ? currentApps.filter((a: string) => a !== appName)
      : [...currentApps, appName];
    await save(next);
  };

  const handleMove = async (appName: string, dir: -1 | 1) => {
    const idx = currentApps.indexOf(appName);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= currentApps.length) return;
    const next = [...currentApps];
    next.splice(idx, 1);
    next.splice(newIdx, 0, appName);
    await save(next);
  };

  // Show enabled apps first (in their order), then disabled apps
  const enabledApps = currentApps.filter((a: string) => ALL_SHORTCUT_APPS.includes(a));
  const disabledApps = ALL_SHORTCUT_APPS.filter((a) => !currentApps.includes(a));

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        shortcut bar
      </div>
      <div style={{ fontSize: 11, color: "var(--text-ghost)", marginBottom: 10 }}>
        apps shown in the desktop shortcut bar. use arrows to reorder.
      </div>

      {/* Enabled apps — shown in order with move buttons */}
      {enabledApps.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "var(--text-ghost)", textTransform: "uppercase", marginBottom: 4 }}>active</div>
          {enabledApps.map((appName, idx) => (
            <div key={appName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <button
                    className="btn"
                    onClick={() => void handleMove(appName, -1)}
                    disabled={saving === "shortcut_apps" || idx === 0}
                    style={{ padding: "0 4px", fontSize: 9, lineHeight: 1, border: "none", color: idx === 0 ? "var(--text-ghost)" : "var(--text-muted)" }}
                  >▲</button>
                  <button
                    className="btn"
                    onClick={() => void handleMove(appName, 1)}
                    disabled={saving === "shortcut_apps" || idx === enabledApps.length - 1}
                    style={{ padding: "0 4px", fontSize: 9, lineHeight: 1, border: "none", color: idx === enabledApps.length - 1 ? "var(--text-ghost)" : "var(--text-muted)" }}
                  >▼</button>
                </div>
                <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{appName}</span>
              </div>
              <button
                className="btn"
                onClick={() => void handleToggle(appName)}
                disabled={saving === "shortcut_apps"}
                style={{ minWidth: 50, fontSize: 11, padding: "2px 8px", background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent-mid)" }}
              >
                {saving === "shortcut_apps" ? "..." : "on"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Disabled apps */}
      {disabledApps.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text-ghost)", textTransform: "uppercase", marginBottom: 4, marginTop: 8 }}>available</div>
          {disabledApps.map((appName) => (
            <div key={appName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 28 }}>{appName}</span>
              <button
                className="btn"
                onClick={() => void handleToggle(appName)}
                disabled={saving === "shortcut_apps"}
                style={{ minWidth: 50, fontSize: 11, padding: "2px 8px" }}
              >
                {saving === "shortcut_apps" ? "..." : "off"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberRow({ label, sublabel, value, saving, onChange }: {
  label: string;
  sublabel?: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 2 }}>{sublabel}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          className="admin-input"
          type="number"
          min={1}
          max={8760}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          disabled={saving}
          style={{ width: 80, textAlign: "center" }}
        />
        <button
          className="btn btn-primary"
          onClick={() => onChange(local)}
          disabled={saving || local === value}
          style={{ padding: "4px 10px" }}
        >
          {saving ? "..." : "set"}
        </button>
      </div>
    </div>
  );
}
