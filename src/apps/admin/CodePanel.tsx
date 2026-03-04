import { useState, useEffect, useCallback } from "react";
import {
  getAccessCodes,
  createAccessCode,
  updateAccessCode,
  deleteAccessCode,
  ApiError,
} from "@/lib/api";
import type { AccessCode } from "@/lib/api";
import { listAppNames } from "@/core/appLoader";

const BLOCKED_APPS = ["cloud", "mail"];

export function CodePanel() {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formExpires, setFormExpires] = useState(24);
  const [formPermissions, setFormPermissions] = useState<string[]>([]);

  const availableApps = listAppNames().filter((n) => !BLOCKED_APPS.includes(n));

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadCodes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAccessCodes();
      setCodes(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "shit broke";
      showStatus(`failed to load codes: ${msg}`, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadCodes();
  }, [loadCodes]);

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      showStatus("name is required, genius", true);
      return;
    }
    setCreating(true);
    try {
      await createAccessCode({
        name: formName.trim(),
        code: formCode.trim() || undefined,
        permissions: formPermissions,
        expires_hours: formExpires,
      });
      showStatus("code created. share it wisely (or don't).");
      setShowForm(false);
      setFormName("");
      setFormCode("");
      setFormExpires(24);
      setFormPermissions([]);
      await loadCodes();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "unknown error";
      showStatus(`failed: ${msg}`, true);
    } finally {
      setCreating(false);
    }
  }, [formName, formCode, formPermissions, formExpires, loadCodes, showStatus]);

  const handleCopy = useCallback(async (code: string, id: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleToggleActive = useCallback(
    async (id: number, currentlyActive: number) => {
      try {
        await updateAccessCode(id, { is_active: !currentlyActive });
        showStatus(currentlyActive ? "code deactivated" : "code reactivated");
        await loadCodes();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "unknown error";
        showStatus(`failed: ${msg}`, true);
      }
    },
    [loadCodes, showStatus]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        const result = await deleteAccessCode(id);
        showStatus(`code deleted. ${result.deleted_users} temp user(s) yeeted.`);
        await loadCodes();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "unknown error";
        showStatus(`failed: ${msg}`, true);
      }
    },
    [loadCodes, showStatus]
  );

  const togglePermission = useCallback((app: string) => {
    setFormPermissions((prev) =>
      prev.includes(app) ? prev.filter((p) => p !== app) : [...prev, app]
    );
  }, []);

  const parsePermissions = (permsJson: string): string[] => {
    try {
      return JSON.parse(permsJson) as string[];
    } catch {
      return [];
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading access codes...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          className="admin-btn admin-btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "cancel" : "+ new code"}
        </button>
        {status && (
          <span className={`admin-status${status.isError ? " error" : ""}`}>
            {status.text}
          </span>
        )}
      </div>

      {showForm && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                name
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. party code"
                className="admin-input"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                code (blank = auto-gen)
              </label>
              <input
                type="text"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="auto-generated"
                className="admin-input"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ width: "120px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                expires (hours)
              </label>
              <input
                type="number"
                value={formExpires}
                onChange={(e) => setFormExpires(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                className="admin-input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "6px" }}>
              app permissions (what this code unlocks)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {availableApps.map((app) => (
                <button
                  key={app}
                  className="admin-btn"
                  style={{
                    fontSize: "11px",
                    padding: "3px 10px",
                    background: formPermissions.includes(app)
                      ? "var(--accent)"
                      : "transparent",
                    color: formPermissions.includes(app)
                      ? "var(--bg-primary)"
                      : "var(--text-secondary)",
                    borderColor: formPermissions.includes(app)
                      ? "var(--accent)"
                      : "var(--border)",
                  }}
                  onClick={() => togglePermission(app)}
                >
                  {app}
                </button>
              ))}
            </div>
          </div>

          <button
            className="admin-btn admin-btn-primary"
            disabled={creating}
            onClick={() => void handleCreate()}
            style={{ alignSelf: "flex-start" }}
          >
            {creating ? "creating..." : "create code"}
          </button>
        </div>
      )}

      {codes.length === 0 ? (
        <div className="admin-empty">no access codes yet. create one above.</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>name</th>
                <th>code</th>
                <th>permissions</th>
                <th>expires</th>
                <th>active</th>
                <th>users</th>
                <th>created</th>
                <th style={{ textAlign: "right" }}>actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const perms = parsePermissions(c.permissions);
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: "12px",
                          color: "var(--accent)",
                          cursor: "pointer",
                        }}
                        onClick={() => void handleCopy(c.code, c.id)}
                        title="click to copy"
                      >
                        {copiedId === c.id ? "copied!" : c.code}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                        {perms.length === 0 ? (
                          <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>none</span>
                        ) : (
                          perms.map((p) => (
                            <span
                              key={p}
                              style={{
                                fontSize: "10px",
                                padding: "1px 6px",
                                borderRadius: "3px",
                                background: "rgba(255,255,255,0.05)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {p}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>{c.expires_hours}h</td>
                    <td>
                      <span
                        style={{
                          cursor: "pointer",
                          fontSize: "11px",
                          padding: "2px 8px",
                          borderRadius: "3px",
                          background: c.is_active
                            ? "rgba(74, 222, 128, 0.1)"
                            : "rgba(248, 113, 113, 0.1)",
                          color: c.is_active ? "#4ade80" : "#f87171",
                        }}
                        onClick={() => void handleToggleActive(c.id, c.is_active)}
                        title="click to toggle"
                      >
                        {c.is_active ? "active" : "off"}
                      </span>
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>{c.temp_user_count}</td>
                    <td>{formatDate(c.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="admin-btn admin-btn-danger"
                        style={{ fontSize: "12px", padding: "3px 8px" }}
                        onClick={() => void handleDelete(c.id)}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
