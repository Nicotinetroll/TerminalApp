import { useState, useEffect, useCallback } from "react";
import type { AdminUser, AdminUserDetails } from "@/lib/api";
import { getAdminUserDetails, adminManageSubscription, adminSetNiggabytes, ApiError } from "@/lib/api";

interface Props {
  mode: "create" | "edit";
  initialUser?: AdminUser;
  onSubmit: (email: string, password: string, role: string) => void;
  onCancel: () => void;
  onStatus?: (text: string, isError?: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]!}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.includes("Z") ? "" : "Z"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "forever";
  const d = new Date(expiresAt + (expiresAt.includes("Z") ? "" : "Z"));
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (diffDays <= 0) return "expired";
  if (diffDays === 1) return `${dateStr} (tomorrow)`;
  if (diffDays <= 30) return `${dateStr} (${diffDays} days)`;
  return dateStr;
}

const SUB_TYPES = [
  { value: "basic_1m", label: "Basic 1mo" },
  { value: "basic_3m", label: "Basic 3mo" },
  { value: "basic_12m", label: "Basic 12mo" },
  { value: "premium_1m", label: "Premium 1mo" },
  { value: "premium_3m", label: "Premium 3mo" },
  { value: "premium_12m", label: "Premium 12mo" },
];

export function UserForm({ mode, initialUser, onSubmit, onCancel, onStatus }: Props) {
  const [email, setEmail] = useState(initialUser?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(initialUser?.role ?? "user");

  // Detail data (edit mode only)
  const [details, setDetails] = useState<AdminUserDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Sub grant form
  const [grantType, setGrantType] = useState("premium_1m");
  const [grantBusy, setGrantBusy] = useState(false);

  // NB edit
  const [nbEditing, setNbEditing] = useState(false);
  const [nbValue, setNbValue] = useState("");

  const loadDetails = useCallback(async () => {
    if (!initialUser) return;
    setDetailsLoading(true);
    try {
      const data = await getAdminUserDetails(initialUser.id);
      setDetails(data);
    } catch {
      // silently fail, the form still works
    } finally {
      setDetailsLoading(false);
    }
  }, [initialUser]);

  useEffect(() => {
    if (mode === "edit" && initialUser) void loadDetails();
  }, [mode, initialUser, loadDetails]);

  const canSubmit =
    email.trim().length > 0 && (mode === "edit" || password.length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(email.trim(), password, role);
  };

  const handleGrantSub = async () => {
    if (!initialUser) return;
    setGrantBusy(true);
    try {
      const result = await adminManageSubscription(initialUser.id, "grant", grantType);
      onStatus?.(result.message);
      await loadDetails();
    } catch (err) {
      onStatus?.(err instanceof ApiError ? err.message : "failed", true);
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRevokeSub = async () => {
    if (!initialUser) return;
    setGrantBusy(true);
    try {
      const result = await adminManageSubscription(initialUser.id, "revoke");
      onStatus?.(result.message);
      await loadDetails();
    } catch (err) {
      onStatus?.(err instanceof ApiError ? err.message : "failed", true);
    } finally {
      setGrantBusy(false);
    }
  };

  const handleToggleAutoRenew = async () => {
    if (!initialUser) return;
    try {
      const result = await adminManageSubscription(initialUser.id, "toggle_auto_renew");
      onStatus?.(result.message);
      await loadDetails();
    } catch (err) {
      onStatus?.(err instanceof ApiError ? err.message : "failed", true);
    }
  };

  const handleSetNb = async () => {
    if (!initialUser) return;
    const amount = parseInt(nbValue, 10);
    if (isNaN(amount) || amount < 0) return;
    try {
      const result = await adminSetNiggabytes(initialUser.id, amount);
      onStatus?.(result.message);
      setNbEditing(false);
      await loadDetails();
    } catch (err) {
      onStatus?.(err instanceof ApiError ? err.message : "failed", true);
    }
  };

  const sub = details?.active_subscription;
  const subLabel = sub ? (sub.type.includes("premium") ? "Premium" : sub.type.includes("basic") ? "Basic" : sub.type) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", flex: 1, overflow: "auto" }}>
      {/* User details (edit mode) */}
      {mode === "edit" && initialUser && (
        <div>
          {detailsLoading ? (
            <div className="admin-loading" style={{ padding: "8px 0" }}>
              <span className="spinner" /> loading details...
            </div>
          ) : details ? (
            <table className="admin-table" style={{ tableLayout: "fixed" }}>
              <tbody>
                <tr>
                  <td style={{ color: "var(--text-muted)", width: "140px" }}>user id</td>
                  <td style={{ color: "var(--text-primary)" }}>{details.user.id}</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)" }}>role</td>
                  <td>
                    <span className={`role-badge role-${details.user.role}`}>
                      {details.user.role}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)" }}>member since</td>
                  <td>{formatDate(details.user.created_at)}</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)" }}>niggabytes</td>
                  <td>
                    {nbEditing ? (
                      <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="number"
                          value={nbValue}
                          onChange={e => setNbValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") void handleSetNb(); if (e.key === "Escape") setNbEditing(false); }}
                          autoFocus
                          style={{ width: "80px", background: "var(--bg-primary)", border: "1px solid var(--accent)", color: "var(--text-primary)", padding: "3px 6px", fontSize: "12px", fontFamily: "inherit" }}
                        />
                        <button className="btn" style={{ fontSize: "11px", padding: "2px 8px", color: "var(--accent)" }} onClick={() => void handleSetNb()}>set</button>
                        <button className="btn" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => setNbEditing(false)}>x</button>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ color: "#fbbf24", fontWeight: 600 }}>{details.niggabytes.toLocaleString()} NB</span>
                        <button
                          className="btn"
                          style={{ fontSize: "11px", padding: "2px 8px" }}
                          onClick={() => { setNbValue(String(details.niggabytes)); setNbEditing(true); }}
                        >edit</button>
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)" }}>storage</td>
                  <td>{formatBytes(details.storage_bytes)}</td>
                </tr>
                {details.email_addresses.length > 0 && (
                  <tr>
                    <td style={{ color: "var(--text-muted)" }}>email</td>
                    <td style={{ color: "var(--text-secondary)" }}>{details.email_addresses.join(", ")}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ color: "var(--text-muted)" }}>subscription</td>
                  <td>
                    {sub ? (
                      <span style={{ display: "inline-flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: sub.type.includes("premium") ? "var(--accent)" : "#a78bfa", fontWeight: 600 }}>{subLabel}</span>
                        <span style={{ color: "var(--text-ghost)", fontSize: "12px" }}>expires {formatExpiry(sub.expires_at)}</span>
                        {sub.auto_renew ? (
                          <span style={{ fontSize: "10px", color: "var(--success)", background: "rgba(34,197,94,0.1)", padding: "1px 6px", borderRadius: "3px" }}>auto-renew</span>
                        ) : null}
                        <button className="btn" style={{ fontSize: "11px", padding: "2px 8px" }} onClick={() => void handleToggleAutoRenew()}>
                          {sub.auto_renew ? "disable AR" : "enable AR"}
                        </button>
                        <button className="btn btn-danger" style={{ fontSize: "11px", padding: "2px 8px" }} disabled={grantBusy} onClick={() => void handleRevokeSub()}>
                          revoke
                        </button>
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-ghost)" }}>no subscription</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)" }}>grant sub</td>
                  <td>
                    <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                      <select
                        className="admin-select"
                        value={grantType}
                        onChange={e => setGrantType(e.target.value)}
                        style={{ fontSize: "12px", padding: "3px 6px", width: "auto" }}
                      >
                        {SUB_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: "11px", padding: "3px 10px" }}
                        disabled={grantBusy}
                        onClick={() => void handleGrantSub()}
                      >
                        {grantBusy ? "..." : "grant"}
                      </button>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : null}

          {/* Sub history */}
          {details && details.subscription_history.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <h4 style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "6px" }}>subscription history</h4>
              <table className="admin-table" style={{ fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th>type</th>
                    <th>started</th>
                    <th>expires</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {details.subscription_history.map(s => (
                    <tr key={s.id}>
                      <td style={{ color: s.type.includes("premium") ? "var(--accent)" : "#a78bfa" }}>
                        {s.type.replace("basic_", "Basic ").replace("premium_", "Premium ")}
                      </td>
                      <td>{formatDate(s.starts_at)}</td>
                      <td>{s.expires_at ? formatDate(s.expires_at) : "—"}</td>
                      <td>
                        <span style={{ color: s.is_active ? "var(--success)" : "var(--text-ghost)" }}>
                          {s.is_active ? "active" : "expired"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Payment history */}
          {details && details.payments.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <h4 style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "6px" }}>payment history</h4>
              <table className="admin-table" style={{ fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th>type</th>
                    <th>amount</th>
                    <th>status</th>
                    <th>date</th>
                  </tr>
                </thead>
                <tbody>
                  {details.payments.map(p => (
                    <tr key={p.id}>
                      <td>{p.type}</td>
                      <td>
                        {p.type === "nb"
                          ? `${p.nb_amount} NB`
                          : `€${p.amount_eur.toFixed(2)}`
                        }
                      </td>
                      <td>
                        <span style={{
                          color: p.status === "finished" ? "var(--success)"
                            : p.status === "failed" || p.status === "expired" ? "var(--error)"
                            : "#fbbf24"
                        }}>
                          {p.status}
                        </span>
                      </td>
                      <td>{formatDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)", margin: "8px 0" }} />
        </div>
      )}

      {/* Edit/Create form */}
      <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
        <h4 style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "12px" }}>
          {mode === "edit" ? "edit account" : "create user"}
        </h4>

        <div className="admin-form-group">
          <label>email</label>
          <input
            type="email"
            className="admin-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@email.com"
            autoFocus={mode === "create"}
          />
        </div>

        <div className="admin-form-group">
          <label>{mode === "create" ? "password" : "password (leave empty to keep)"}</label>
          <input
            type="password"
            className="admin-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "create" ? "enter password" : "leave empty to keep current"}
          />
        </div>

        <div className="admin-form-group">
          <label>role</label>
          <select
            className="admin-select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="admin">admin</option>
            <option value="premium">premium</option>
            <option value="basic">basic</option>
            <option value="user">user</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {mode === "create" ? "create this mf" : "save changes"}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            nah, go back
          </button>
        </div>
      </form>
    </div>
  );
}
