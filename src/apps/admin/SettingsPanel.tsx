import { useState, useCallback, useMemo } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";

const SOUND_OPTIONS = [
  { value: "ping", label: "ping" },
  { value: "blip", label: "blip" },
  { value: "knock", label: "knock" },
  { value: "none", label: "none (silent)" },
];

const ALL_SHORTCUT_APPS = [
  "mail", "cloud", "paste", "profile",
  "shortlinks", "downloader", "shop", "admin", "stats",
];

const RESTRICTABLE_APPS = [
  "mail", "cloud", "paste", "profile",
  "shortlinks", "downloader",
];

const RESTRICTABLE_FEATURES: { key: string; label: string; desc: string }[] = [
  { key: "feature:transfers", label: "upload links", desc: "generate public upload links in profile" },
  { key: "feature:invites", label: "invite links", desc: "generate invite codes in profile" },
];

const ROLE_OPTIONS = [
  { value: "", label: "everyone" },
  { value: "user", label: "user" },
  { value: "basic", label: "basic" },
  { value: "premium", label: "premium" },
  { value: "admin", label: "admin" },
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
    if (isNaN(num) || num < 0) return;
    setSaving(key);
    await updateSetting(key, String(num));
    setSaving(null);
    showStatus(`${key} set to ${num}`);
  };

  const handleText = async (key: string, value: string) => {
    setSaving(key);
    await updateSetting(key, value);
    setSaving(null);
    showStatus(`${key} updated`);
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

      <ConfigSection title="storage limits (MB)" sublabel="0 = unlimited. applies per role.">
        <NumberRow label="admin" sublabel="0 = unlimited" value={settings["storage_admin_mb"] ?? "0"} saving={saving === "storage_admin_mb"} onChange={(v) => void handleNumber("storage_admin_mb", v)} min={0} />
        <NumberRow label="premium" value={settings["storage_premium_mb"] ?? "30720"} saving={saving === "storage_premium_mb"} onChange={(v) => void handleNumber("storage_premium_mb", v)} min={0} />
        <NumberRow label="basic" value={settings["storage_basic_mb"] ?? "10240"} saving={saving === "storage_basic_mb"} onChange={(v) => void handleNumber("storage_basic_mb", v)} min={0} />
      </ConfigSection>

      <ConfigSection title="upload links">
        <NumberRow label="expiry (hours)" sublabel="how long upload links stay active" value={settings["transfer_expiry_hours"] ?? "12"} saving={saving === "transfer_expiry_hours"} onChange={(v) => void handleNumber("transfer_expiry_hours", v)} />
        <NumberRow label="max pending per user" value={settings["transfer_max_pending"] ?? "10"} saving={saving === "transfer_max_pending"} onChange={(v) => void handleNumber("transfer_max_pending", v)} />
        <NumberRow label="admin max size (MB)" sublabel="0 = unlimited" value={settings["transfer_size_admin_mb"] ?? "51200"} saving={saving === "transfer_size_admin_mb"} onChange={(v) => void handleNumber("transfer_size_admin_mb", v)} min={0} />
        <NumberRow label="premium max size (MB)" value={settings["transfer_size_premium_mb"] ?? "5120"} saving={saving === "transfer_size_premium_mb"} onChange={(v) => void handleNumber("transfer_size_premium_mb", v)} min={1} />
        <NumberRow label="basic max size (MB)" value={settings["transfer_size_basic_mb"] ?? "1024"} saving={saving === "transfer_size_basic_mb"} onChange={(v) => void handleNumber("transfer_size_basic_mb", v)} min={1} />
      </ConfigSection>

      <ConfigSection title="shortlinks">
        <NumberRow label="max links per user" value={settings["shortlinks_max_per_user"] ?? "100"} saving={saving === "shortlinks_max_per_user"} onChange={(v) => void handleNumber("shortlinks_max_per_user", v)} />
      </ConfigSection>

      <ConfigSection title="mail">
        <NumberRow label="send rate limit (per hour)" value={settings["mail_send_rate_limit"] ?? "20"} saving={saving === "mail_send_rate_limit"} onChange={(v) => void handleNumber("mail_send_rate_limit", v)} />
        <NumberRow label="max attachment size (MB)" value={settings["mail_max_attachment_mb"] ?? "5"} saving={saving === "mail_max_attachment_mb"} onChange={(v) => void handleNumber("mail_max_attachment_mb", v)} />
        <NumberRow label="max attachments per email" value={settings["mail_max_attachments"] ?? "5"} saving={saving === "mail_max_attachments"} onChange={(v) => void handleNumber("mail_max_attachments", v)} />
      </ConfigSection>

      <ConfigSection title="pastes">
        <NumberRow label="max paste size (KB)" value={settings["paste_max_size_kb"] ?? "500"} saving={saving === "paste_max_size_kb"} onChange={(v) => void handleNumber("paste_max_size_kb", v)} />
        <NumberRow label="anon pastes per day" value={settings["paste_anon_max_per_day"] ?? "10"} saving={saving === "paste_anon_max_per_day"} onChange={(v) => void handleNumber("paste_anon_max_per_day", v)} />
        <NumberRow label="anon paste expiry (hours)" value={settings["paste_anon_expiry_hours"] ?? "6"} saving={saving === "paste_anon_expiry_hours"} onChange={(v) => void handleNumber("paste_anon_expiry_hours", v)} />
      </ConfigSection>

      <ConfigSection title="mail slots" sublabel="free slots per role + max purchasable in shop">
        <NumberRow label="admin" value={settings["mail_slots_admin"] ?? "10"} saving={saving === "mail_slots_admin"} onChange={(v) => void handleNumber("mail_slots_admin", v)} min={0} />
        <NumberRow label="premium" value={settings["mail_slots_premium"] ?? "10"} saving={saving === "mail_slots_premium"} onChange={(v) => void handleNumber("mail_slots_premium", v)} min={0} />
        <NumberRow label="basic" value={settings["mail_slots_basic"] ?? "3"} saving={saving === "mail_slots_basic"} onChange={(v) => void handleNumber("mail_slots_basic", v)} min={0} />
        <NumberRow label="max purchasable (shop)" sublabel="extra slots buyable with NB on top of free" value={settings["shop_max_mail_slots"] ?? "9"} saving={saving === "shop_max_mail_slots"} onChange={(v) => void handleNumber("shop_max_mail_slots", v)} />
      </ConfigSection>

      <ConfigSection title="invites">
        <NumberRow label="invite link expiry (hours)" value={settings["invite_expiry_hours"] ?? "1"} saving={saving === "invite_expiry_hours"} onChange={(v) => void handleNumber("invite_expiry_hours", v)} />
      </ConfigSection>

      <ConfigSection title="payments" sublabel="crypto payment settings (NOWPayments)">
        <TextRow label="NB pack amounts" sublabel="comma-separated list of buyable NB packs" value={settings["nb_pack_amounts"] ?? "10,50,100,500"} saving={saving === "nb_pack_amounts"} onChange={(v) => void handleText("nb_pack_amounts", v)} />
      </ConfigSection>

      <ConfigSection title="subscription pricing" sublabel="EUR per month — total = price × months">
        <DecimalRow label="basic 1m (EUR/mo)" value={settings["sub_basic_1m_eur"] ?? "2.99"} saving={saving === "sub_basic_1m_eur"} onChange={(v) => void handleText("sub_basic_1m_eur", v)} />
        <DecimalRow label="basic 3m (EUR/mo)" value={settings["sub_basic_3m_eur"] ?? "2.49"} saving={saving === "sub_basic_3m_eur"} onChange={(v) => void handleText("sub_basic_3m_eur", v)} />
        <DecimalRow label="basic 12m (EUR/mo)" value={settings["sub_basic_12m_eur"] ?? "1.99"} saving={saving === "sub_basic_12m_eur"} onChange={(v) => void handleText("sub_basic_12m_eur", v)} />
        <DecimalRow label="premium 1m (EUR/mo)" value={settings["sub_premium_1m_eur"] ?? "6.69"} saving={saving === "sub_premium_1m_eur"} onChange={(v) => void handleText("sub_premium_1m_eur", v)} />
        <DecimalRow label="premium 3m (EUR/mo)" value={settings["sub_premium_3m_eur"] ?? "5.49"} saving={saving === "sub_premium_3m_eur"} onChange={(v) => void handleText("sub_premium_3m_eur", v)} />
        <DecimalRow label="premium 12m (EUR/mo)" value={settings["sub_premium_12m_eur"] ?? "4.49"} saving={saving === "sub_premium_12m_eur"} onChange={(v) => void handleText("sub_premium_12m_eur", v)} />
        <TextRow label="basic benefits" sublabel='JSON array' value={settings["sub_basic_benefits"] ?? '["@mynig.ga email","10 GB cloud storage","1 GB upload links","core apps"]'} saving={saving === "sub_basic_benefits"} onChange={(v) => void handleText("sub_basic_benefits", v)} />
        <TextRow label="premium benefits" sublabel='JSON array' value={settings["sub_premium_benefits"] ?? '["30 GB cloud storage","5 GB upload links","all apps unlocked","priority support"]'} saving={saving === "sub_premium_benefits"} onChange={(v) => void handleText("sub_premium_benefits", v)} />
      </ConfigSection>

      <ConfigSection title="AI (nigga command)" sublabel="system prompt and model settings">
        <TextAreaRow
          label="system prompt"
          sublabel="instructions for the AI personality and behavior"
          value={settings["ai_system_prompt"] ?? ""}
          saving={saving === "ai_system_prompt"}
          onChange={(v) => void handleText("ai_system_prompt", v)}
        />
      </ConfigSection>

      <AppAccessSection
        settings={settings}
        updateSetting={updateSetting}
        saving={saving}
        setSaving={setSaving}
        showStatus={showStatus}
      />

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

function AppAccessSection({ settings, updateSetting, saving, setSaving, showStatus }: {
  settings: Record<string, string>;
  updateSetting: (key: string, value: string) => Promise<void>;
  saving: string | null;
  setSaving: (s: string | null) => void;
  showStatus: (text: string) => void;
}) {
  const restrictions = useMemo(() => {
    try {
      const raw = settings["app_restrictions"];
      return raw ? JSON.parse(raw) as Record<string, string> : {};
    } catch {
      return {};
    }
  }, [settings]);

  const handleChange = async (appName: string, role: string) => {
    const next = { ...restrictions };
    if (role) {
      next[appName] = role;
    } else {
      delete next[appName];
    }
    setSaving("app_restrictions");
    await updateSetting("app_restrictions", JSON.stringify(next));
    setSaving(null);
    showStatus(role ? `${appName} restricted to ${role}+` : `${appName} unrestricted`);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        app access
      </div>
      <div style={{ fontSize: 11, color: "var(--text-ghost)", marginBottom: 10 }}>
        set minimum role required to open each app. users below the required role will see an "upgrade" prompt.
      </div>

      <div style={{ fontSize: 10, color: "var(--text-ghost)", textTransform: "uppercase", marginBottom: 4 }}>apps</div>
      {RESTRICTABLE_APPS.map((appName) => (
        <div key={appName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{appName}</span>
          <select
            className="admin-select"
            value={restrictions[appName] ?? ""}
            onChange={(e) => void handleChange(appName, e.target.value)}
            disabled={saving === "app_restrictions"}
            style={{ width: 110 }}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}

      <div style={{ fontSize: 10, color: "var(--text-ghost)", textTransform: "uppercase", marginBottom: 4, marginTop: 16 }}>features</div>
      {RESTRICTABLE_FEATURES.map((feat) => (
        <div key={feat.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{feat.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-ghost)" }}>{feat.desc}</div>
          </div>
          <select
            className="admin-select"
            value={restrictions[feat.key] ?? ""}
            onChange={(e) => void handleChange(feat.key, e.target.value)}
            disabled={saving === "app_restrictions"}
            style={{ width: 110 }}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function ConfigSection({ title, sublabel, children }: {
  title: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: sublabel ? 4 : 12 }}>
        {title}
      </div>
      {sublabel && <div style={{ fontSize: 11, color: "var(--text-ghost)", marginBottom: 10 }}>{sublabel}</div>}
      {children}
    </div>
  );
}

function NumberRow({ label, sublabel, value, saving, onChange, min = 1 }: {
  label: string;
  sublabel?: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  min?: number;
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
          min={min}
          max={99999}
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

function TextRow({ label, sublabel, value, saving, onChange }: {
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
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          disabled={saving}
          style={{ width: 160, textAlign: "center" }}
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

function DecimalRow({ label, sublabel, value, saving, onChange }: {
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
          step="0.01"
          min="0"
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

function TextAreaRow({ label, sublabel, value, saving, onChange }: {
  label: string;
  sublabel?: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 2, marginBottom: 6 }}>{sublabel}</div>}
      </div>
      <textarea
        className="admin-input"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        disabled={saving}
        rows={10}
        style={{ width: "100%", fontFamily: "inherit", fontSize: 12, resize: "vertical", marginTop: 4 }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button
          className="btn btn-primary"
          onClick={() => onChange(local)}
          disabled={saving || local === value}
          style={{ padding: "4px 12px" }}
        >
          {saving ? "..." : "save"}
        </button>
      </div>
    </div>
  );
}
