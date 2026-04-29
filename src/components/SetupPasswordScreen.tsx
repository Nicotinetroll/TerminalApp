import { useState, useRef, useEffect } from "react";
import { AuthLogo } from "./AuthLogo";
import { ScrambleText } from "./ScrambleText";

interface Props {
  email: string;
  onComplete: () => void;
  onSetupPassword: (password: string) => Promise<{ ok: boolean; error?: string }>;
}

export function SetupPasswordScreen({ email, onComplete, onSetupPassword }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-dismiss error after 4s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("at least 6 characters. we have standards.");
      return;
    }
    if (password !== confirm) {
      setError("passwords don't match. try again.");
      return;
    }

    setBusy(true);
    const [result] = await Promise.all([
      onSetupPassword(password),
      new Promise<void>(r => setTimeout(r, 2000)),
    ]);
    setBusy(false);

    if (result.ok) {
      onComplete();
    } else {
      setError(result.error ?? "failed to set password.");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <AuthLogo success />

        <p className="auth-setup-info">
          payment confirmed. now set a password for
          <span className="auth-setup-email"> {email}</span>
        </p>

        <form className="auth-form" onSubmit={e => void handleSubmit(e)}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="new-password">password</label>
            <input
              ref={inputRef}
              id="new-password"
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null); }}
              className="auth-input"
              placeholder="min 6 characters"
              autoComplete="new-password"
              disabled={busy}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="confirm-password">confirm password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(null); }}
              className="auth-input"
              placeholder="repeat password"
              autoComplete="new-password"
              disabled={busy}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className={`auth-btn${busy ? " auth-btn-busy" : ""}`} disabled={busy}>
            {busy ? (
              <ScrambleText text="encrypting credentials" />
            ) : (
              "set password & enter"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
