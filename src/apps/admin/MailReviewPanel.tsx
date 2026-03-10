import { useState, useEffect, useCallback, Fragment } from "react";
import {
  getAdminEmailAddresses,
  deleteAdminEmailAddress,
  getAdminEmails,
  getAdminEmail,
  deleteAdminEmail,
} from "@/lib/api";
import type { AdminEmailAddress, AdminEmail } from "@/lib/api";

export function MailReviewPanel() {
  const [addresses, setAddresses] = useState<AdminEmailAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<{ userId: number; username: string; address: string } | null>(null);
  const [emails, setEmails] = useState<AdminEmail[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedEmail, setExpandedEmail] = useState<AdminEmail | null>(null);

  const loadAddresses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminEmailAddresses();
      setAddresses(data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  const handleView = useCallback(async (userId: number, username: string, address: string) => {
    setSelectedUser({ userId, username, address });
    setLoadingEmails(true);
    setExpandedId(null);
    setExpandedEmail(null);
    try {
      const data = await getAdminEmails(userId);
      setEmails(data);
    } catch {
      // fail silently
    } finally {
      setLoadingEmails(false);
    }
  }, []);

  const handleExpandEmail = useCallback(async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedEmail(null);
      return;
    }
    setExpandedId(id);
    try {
      const full = await getAdminEmail(id);
      setExpandedEmail(full);
    } catch {
      setExpandedEmail(null);
    }
  }, [expandedId]);

  const handleDeleteAddress = useCallback(async (id: number, address: string) => {
    if (!confirm(`delete ${address}@mynig.ga and all associated emails?`)) return;
    try {
      await deleteAdminEmailAddress(id);
      void loadAddresses();
    } catch {
      // fail silently
    }
  }, [loadAddresses]);

  const handleDeleteEmail = useCallback(async (id: number) => {
    if (!confirm("delete this email?")) return;
    try {
      await deleteAdminEmail(id);
      setEmails(prev => prev.filter(e => e.id !== id));
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedEmail(null);
      }
    } catch {
      // fail silently
    }
  }, [expandedId]);

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading addresses...
      </div>
    );
  }

  // Detail view: user's emails
  if (selectedUser) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => { setSelectedUser(null); setEmails([]); setExpandedId(null); setExpandedEmail(null); }}>
            back
          </button>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {selectedUser.address}@mynig.ga
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-ghost)" }}>
            (owner: <span style={{ color: "var(--accent)" }}>{selectedUser.username}</span>)
          </span>
        </div>

        <div className="terminal-scroll" style={{ flex: 1, overflow: "auto" }}>
          {loadingEmails ? (
            <div className="admin-loading">
              <span className="spinner" />
              loading emails...
            </div>
          ) : emails.length === 0 ? (
            <div className="admin-empty">no emails found.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>folder</th>
                  <th>from</th>
                  <th>to</th>
                  <th>subject</th>
                  <th>date</th>
                  <th>read</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <Fragment key={email.id}>
                    <tr
                      style={{ cursor: "pointer", opacity: email.is_read ? 0.7 : 1 }}
                      onClick={() => void handleExpandEmail(email.id)}
                    >
                      <td>
                        <span style={{
                          fontSize: "10px",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          background: email.folder === "inbox" ? "rgba(96,165,250,0.15)" : email.folder === "sent" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
                          color: email.folder === "inbox" ? "var(--accent)" : email.folder === "sent" ? "var(--success)" : "var(--error)",
                        }}>
                          {email.folder}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {email.from_address}
                      </td>
                      <td style={{ fontSize: "12px", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {email.to_address}
                      </td>
                      <td style={{ fontWeight: email.is_read ? "normal" : "bold" }}>
                        {email.subject}
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: "11px" }}>{email.created_at}</td>
                      <td style={{ textAlign: "center", fontSize: "11px" }}>{email.is_read ? "yes" : "no"}</td>
                      <td>
                        <button
                          className="btn"
                          style={{ fontSize: "11px", padding: "2px 8px", color: "var(--error)", borderColor: "rgba(248,113,113,0.3)" }}
                          onClick={(e) => { e.stopPropagation(); void handleDeleteEmail(email.id); }}
                        >
                          del
                        </button>
                      </td>
                    </tr>
                    {expandedId === email.id && expandedEmail && (
                      <tr key={`${email.id}-body`}>
                        <td colSpan={7} style={{ padding: "12px 16px", background: "rgba(255,255,255,0.02)" }}>
                          <pre style={{
                            margin: 0,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontFamily: "inherit",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                            maxHeight: "300px",
                            overflow: "auto",
                          }}>
                            {expandedEmail.body || "(empty)"}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // Address list
  return (
    <div className="terminal-scroll" style={{ flex: 1, overflow: "auto" }}>
      {addresses.length === 0 ? (
        <div className="admin-empty">no email addresses claimed yet.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>address</th>
              <th>user</th>
              <th>emails</th>
              <th>claimed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {addresses.map((addr) => (
              <tr key={addr.id}>
                <td style={{ fontFamily: "monospace", fontSize: "12px" }}>
                  {addr.address}@mynig.ga
                </td>
                <td style={{ color: "var(--accent)" }}>{addr.username}</td>
                <td>{addr.email_count}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: "11px" }}>{addr.created_at}</td>
                <td style={{ display: "flex", gap: "4px" }}>
                  <button
                    className="btn"
                    style={{ fontSize: "11px", padding: "2px 8px" }}
                    onClick={() => void handleView(addr.user_id, addr.username, addr.address)}
                  >
                    view
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: "11px", padding: "2px 8px", color: "var(--error)", borderColor: "rgba(248,113,113,0.3)" }}
                    onClick={() => void handleDeleteAddress(addr.id, addr.address)}
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
