import { useState, useMemo } from "react";
import type { AdminUser } from "@/lib/api";
import { grantNiggaBytes } from "@/lib/api";

const PAGE_SIZE = 25;

interface Props {
  users: AdminUser[];
  loading: boolean;
  currentEmail: string;
  onEdit: (user: AdminUser) => void;
  onDelete: (id: number) => void;
  onStatus?: (text: string, isError?: boolean) => void;
}

export function UserTable({ users, loading, currentEmail, onEdit, onDelete, onStatus }: Props) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [grantingId, setGrantingId] = useState<number | null>(null);
  const [grantAmount, setGrantAmount] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(u => u.email.toLowerCase().includes(q) || u.id.toString() === q);
    }
    if (roleFilter !== "all") {
      list = list.filter(u => u.role === roleFilter);
    }
    return list;
  }, [users, search, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Reset page when search/filter changes
  const updateSearch = (v: string) => { setSearch(v); setPage(0); };
  const updateFilter = (v: string) => { setRoleFilter(v); setPage(0); };

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading these mfs...
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const handleGrant = async (userId: number) => {
    const amt = parseInt(grantAmount, 10);
    if (!amt) return;
    try {
      const result = await grantNiggaBytes(userId, amt);
      onStatus?.(result.message);
      setGrantingId(null);
      setGrantAmount("");
    } catch {
      onStatus?.("grant failed lmao", true);
    }
  };

  const roles = [...new Set(users.map(u => u.role))];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", gap: "8px" }}>
      {/* Search + filter bar */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="search by email or id..."
          style={{
            flex: 1,
            minWidth: "140px",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-medium)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            fontSize: "12px",
            borderRadius: "4px",
            fontFamily: "inherit",
          }}
        />
        <select
          value={roleFilter}
          onChange={(e) => updateFilter(e.target.value)}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-medium)",
            color: "var(--text-primary)",
            padding: "6px 8px",
            fontSize: "12px",
            borderRadius: "4px",
            fontFamily: "inherit",
          }}
        >
          <option value="all">all ({users.length})</option>
          {roles.map(r => (
            <option key={r} value={r}>{r} ({users.filter(u => u.role === r).length})</option>
          ))}
        </select>
        <span style={{ color: "var(--text-ghost)", fontSize: "11px", whiteSpace: "nowrap" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {paged.length === 0 ? (
          <div className="admin-empty">
            {search ? "no users match that search." : "no users? how the fuck did you get here?"}
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>id</th>
                <th>email</th>
                <th>role</th>
                <th>created</th>
                <th style={{ textAlign: "right" }}>actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((u) => (
                <tr key={u.id}>
                  <td style={{ color: "var(--text-muted)" }}>{u.id}</td>
                  <td style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {u.email}
                  </td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>
                      {u.role}
                    </span>
                  </td>
                  <td>{formatDate(u.created_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    {grantingId === u.id ? (
                      <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="number"
                          value={grantAmount}
                          onChange={(e) => setGrantAmount(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleGrant(u.id);
                            if (e.key === "Escape") { setGrantingId(null); setGrantAmount(""); }
                          }}
                          placeholder="NB"
                          autoFocus
                          style={{
                            width: "70px",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--accent)",
                            color: "var(--text-primary)",
                            padding: "3px 6px",
                            fontSize: "12px",
                            borderRadius: "4px",
                          }}
                        />
                        <button
                          className="btn"
                          style={{ fontSize: "12px", padding: "3px 8px", color: "var(--accent)" }}
                          onClick={() => void handleGrant(u.id)}
                        >
                          ok
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => { setGrantingId(null); setGrantAmount(""); }}
                        >
                          x
                        </button>
                      </span>
                    ) : confirmId === u.id ? (
                      <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>you sure?</span>
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => {
                            setConfirmId(null);
                            onDelete(u.id);
                          }}
                        >
                          yeah fuck it
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => setConfirmId(null)}
                        >
                          nah
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          className="btn"
                          style={{ fontSize: "12px", padding: "3px 8px", color: "#f5c542" }}
                          onClick={() => { setGrantingId(u.id); setGrantAmount(""); }}
                          title="grant NiggaBytes"
                        >
                          +NB
                        </button>
                        <button
                          className="btn"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => onEdit(u)}
                        >
                          edit
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          disabled={u.email === currentEmail}
                          title={u.email === currentEmail ? "you can't delete yourself, dumbass" : undefined}
                          onClick={() => setConfirmId(u.id)}
                        >
                          delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center", gap: "8px",
          padding: "6px 0", borderTop: "1px solid var(--border-subtle)",
          fontSize: "12px", color: "var(--text-muted)",
        }}>
          <button
            className="btn"
            style={{ fontSize: "11px", padding: "2px 8px" }}
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            prev
          </button>
          <span>{safePage + 1} / {totalPages}</span>
          <button
            className="btn"
            style={{ fontSize: "11px", padding: "2px 8px" }}
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            next
          </button>
        </div>
      )}
    </div>
  );
}
