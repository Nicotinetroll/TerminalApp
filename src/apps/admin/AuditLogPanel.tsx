import { useState, useEffect, useCallback } from "react";
import { getAuditLog } from "@/lib/api";
import type { AuditEntry } from "@/lib/api";

const ACTIONS = [
  "",
  "user.create",
  "user.update",
  "user.delete",
  "casino.grant_nb",
  "casino.config",
];

const PAGE_SIZE = 30;

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAuditLog(PAGE_SIZE, page * PAGE_SIZE, action);
      setEntries(data.entries);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, action]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function fmtTime(ts: string): string {
    const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="audit-panel">
      <div className="audit-filters">
        <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>filter:</span>
        <select
          className="audit-filter-select"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0); }}
        >
          <option value="">all actions</option>
          {ACTIONS.filter(Boolean).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span style={{ color: "var(--text-ghost)", fontSize: 11, marginLeft: "auto" }}>
          {total} entries
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text-ghost)" }}>loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: 20, color: "var(--text-ghost)" }}>
          no audit entries yet. admins been quiet.
        </div>
      ) : (
        <table className="audit-table">
          <thead>
            <tr>
              <th>time</th>
              <th>admin</th>
              <th>action</th>
              <th>target</th>
              <th>details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtTime(e.created_at)}</td>
                <td style={{ color: "var(--accent)" }}>{e.admin_username}</td>
                <td><span className="audit-action">{e.action}</span></td>
                <td>{e.target_name ?? e.target_id ?? "—"}</td>
                <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {Object.keys(e.details).length > 0
                    ? Object.entries(e.details)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(", ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="audit-pagination">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← prev
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            className="btn btn-sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            next →
          </button>
        </div>
      )}
    </div>
  );
}
