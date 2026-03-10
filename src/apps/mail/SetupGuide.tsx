import { useState, useCallback } from "react";
import type { EmailAddress } from "@/lib/api";
import { setMailPassword, ApiError } from "@/lib/api";

interface Props {
  addresses: EmailAddress[];
  onClose: () => void;
  onPasswordSet: (addrId: number) => void;
  showStatus: (text: string, isError?: boolean) => void;
}

type PwState = "idle" | "editing" | "just-set";

function PasswordRow({ addr, onPasswordSet, showStatus }: {
  addr: EmailAddress;
  onPasswordSet: (id: number) => void;
  showStatus: Props["showStatus"];
}) {
  const hasPassword = addr.has_mail_password;
  const [state, setState] = useState<PwState>("idle");
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [plainPw, setPlainPw] = useState<string | null>(null);

  const handleSet = useCallback(async () => {
    setSaving(true);
    try {
      const result = await setMailPassword(addr.id, pw || undefined);
      setPlainPw(result);
      setState("just-set");
      setPw("");
      onPasswordSet(addr.id);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    } finally {
      setSaving(false);
    }
  }, [addr.id, pw, onPasswordSet, showStatus]);

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      showStatus("password copied");
    });
  }, [showStatus]);

  // Just created a password — show masked + copy + change
  if (state === "just-set" && plainPw) {
    return (
      <div className="mail-setup-pw-row">
        <span className="mail-setup-pw-addr">{addr.full}</span>
        <div className="mail-settings-pw-actions">
          <code
            className="mail-settings-pw-masked"
            onClick={() => handleCopy(plainPw)}
            title="click to copy"
          >
            {"•".repeat(plainPw.length)}
          </code>
          <button
            className="mail-settings-pw-change"
            onClick={() => { setState("editing"); setPlainPw(null); }}
          >
            change
          </button>
        </div>
      </div>
    );
  }

  // Editing mode — input + set/generate
  if (state === "editing" || !hasPassword) {
    return (
      <div className="mail-setup-pw-row">
        <span className="mail-setup-pw-addr">{addr.full}</span>
        <div className="mail-setup-pw-input">
          <input
            type="text"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !saving) void handleSet(); if (e.key === "Escape" && hasPassword) setState("idle"); }}
            placeholder="password or empty = random"
            disabled={saving}
            autoFocus={state === "editing"}
          />
          <button
            className="btn"
            onClick={() => void handleSet()}
            disabled={saving || (pw.length > 0 && pw.length < 4)}
            style={{ fontSize: "10px", whiteSpace: "nowrap" }}
          >
            {saving ? "..." : pw ? "set" : "generate"}
          </button>
          {hasPassword && state === "editing" && (
            <button
              className="btn"
              onClick={() => { setState("idle"); setPw(""); }}
              style={{ fontSize: "10px" }}
            >
              x
            </button>
          )}
        </div>
      </div>
    );
  }

  // Has password, idle — show "set" indicator + change button
  return (
    <div className="mail-setup-pw-row">
      <span className="mail-setup-pw-addr">{addr.full}</span>
      <div className="mail-settings-pw-actions">
        <span className="mail-settings-pw-set">password set</span>
        <button
          className="mail-settings-pw-change"
          onClick={() => setState("editing")}
        >
          change
        </button>
      </div>
    </div>
  );
}

export function SetupGuide({ addresses, onClose, onPasswordSet, showStatus }: Props) {
  return (
    <div className="mail-setup-guide">
      <div className="mail-signature-header">
        <h3>settings</h3>
        <button className="btn" onClick={onClose}>close</button>
      </div>

      <div className="mail-setup-content">
        <div className="mail-setup-section">
          <div className="mail-setup-section-title">imap / smtp</div>
          <table className="mail-setup-table">
            <tbody>
              <tr><td>IMAP</td><td><strong>mail.mynig.ga</strong> : 993 (SSL)</td></tr>
              <tr><td>SMTP</td><td><strong>mail.mynig.ga</strong> : 465 (SSL)</td></tr>
              <tr><td>login</td><td>your full email + mail password (below)</td></tr>
            </tbody>
          </table>
          <p className="mail-setup-hint">
            legit SSL cert. no sketchy warnings. we're classy like that.
          </p>
        </div>

        <div className="mail-setup-section">
          <div className="mail-setup-section-title">mail passwords</div>
          <p className="mail-setup-text">
            these are for IMAP/SMTP login, not your terminal password. min 4 chars or generate a random one.
          </p>
          {addresses.map(addr => (
            <PasswordRow key={addr.id} addr={addr} onPasswordSet={onPasswordSet} showStatus={showStatus} />
          ))}
        </div>

        <div className="mail-setup-section">
          <div className="mail-setup-section-title">gmail app?</div>
          <p className="mail-setup-text">
            gmail app &gt; add account &gt; other &gt; throw in the settings above. it works.
          </p>
        </div>
      </div>
    </div>
  );
}
