import { useState, useCallback } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

const SOUND_OPTIONS = [
  { value: "ping", label: "ping" },
  { value: "blip", label: "blip" },
  { value: "knock", label: "knock" },
  { value: "none", label: "none (silent)" },
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
        className="admin-btn"
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
          className="admin-btn admin-btn-primary"
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
