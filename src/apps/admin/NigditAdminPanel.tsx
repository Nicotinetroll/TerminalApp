import { useState, useEffect, useCallback } from "react";
import type { NigditBoard, NigditAdminStats } from "@/lib/api";
import { getNigditAdminStats, createNigditBoard, updateNigditBoard, deleteNigditBoard, ApiError } from "@/lib/api";

export function NigditAdminPanel() {
  const [stats, setStats] = useState<NigditAdminStats | null>(null);
  const [boards, setBoards] = useState<NigditBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

  // New board form
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNigditAdminStats();
      setStats(data);
      setBoards(data.boards);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed to load stats", true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateBoard = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const updated = await createNigditBoard(newName.trim(), newDesc.trim());
      setBoards(updated);
      setNewName("");
      setNewDesc("");
      showStatus("board created");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "create failed", true);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateBoard = async (id: number, originalName: string) => {
    const updates: { name?: string; description?: string } = {};
    if (editName.trim() && editName.trim() !== originalName) updates.name = editName.trim();
    updates.description = editDesc;
    try {
      const updated = await updateNigditBoard(id, updates);
      setBoards(updated);
      setEditingId(null);
      showStatus("board updated");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "update failed", true);
    }
  };

  const handleDeleteBoard = async (id: number, name: string) => {
    try {
      const updated = await deleteNigditBoard(id);
      setBoards(updated);
      showStatus(`${name} deleted, posts moved to general`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "delete failed", true);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 20, color: "var(--text-muted)" }}>
        <span className="spinner" /> loading nigdit stats...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {status && (
        <div className={`admin-status${status.isError ? " error" : ""}`} style={{ padding: "6px 10px" }}>
          {status.text}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div className="nigdit-admin-stat">
            <span className="nigdit-admin-stat-val">{stats.totalPosts}</span>
            <span className="nigdit-admin-stat-label">posts</span>
          </div>
          <div className="nigdit-admin-stat">
            <span className="nigdit-admin-stat-val">{stats.totalComments}</span>
            <span className="nigdit-admin-stat-label">comments</span>
          </div>
          <div className="nigdit-admin-stat">
            <span className="nigdit-admin-stat-val">{stats.totalVotes}</span>
            <span className="nigdit-admin-stat-label">votes</span>
          </div>
        </div>
      )}

      {/* Top users */}
      {stats && stats.topPosters.length > 0 && (
        <div>
          <h4 style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 6 }}>top posters</h4>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {stats.topPosters.map((p) => (
              <span key={p.username} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                @{p.username} ({p.post_count})
              </span>
            ))}
          </div>
        </div>
      )}

      {stats && stats.topAura.length > 0 && (
        <div>
          <h4 style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 6 }}>top aura</h4>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {stats.topAura.map((p) => (
              <span key={p.username} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                @{p.username} ({p.total_aura})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Board management */}
      <div>
        <h4 style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 8 }}>boards</h4>
        <table className="admin-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>name</th>
              <th>description</th>
              <th style={{ width: 100 }}>actions</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.id}>
                <td>
                  {editingId === b.id ? (
                    <input
                      className="nigdit-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ fontSize: 11, padding: "3px 6px", width: "100%", fontWeight: 600 }}
                      autoFocus
                    />
                  ) : (
                    <span style={{ fontWeight: 600 }}>{b.name}</span>
                  )}
                </td>
                <td>
                  {editingId === b.id ? (
                    <input
                      className="nigdit-input"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      style={{ fontSize: 11, padding: "3px 6px", width: "100%" }}
                    />
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>{b.description || "—"}</span>
                  )}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {editingId === b.id ? (
                      <>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => void handleUpdateBoard(b.id, b.name)}>save</button>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setEditingId(null)}>x</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => { setEditingId(b.id); setEditName(b.name); setEditDesc(b.description); }}>edit</button>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 6px", color: "var(--error)" }} onClick={() => void handleDeleteBoard(b.id, b.name)}>del</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add board */}
      <div>
        <h4 style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 8 }}>add board</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <label style={{ fontSize: 10, color: "var(--text-ghost)" }}>name</label>
            <input
              className="nigdit-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="board-name"
              style={{ fontSize: 12, padding: "4px 8px", width: 140 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            <label style={{ fontSize: 10, color: "var(--text-ghost)" }}>description</label>
            <input
              className="nigdit-input"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="what's this board about"
              style={{ fontSize: 12, padding: "4px 8px" }}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ fontSize: 11, padding: "4px 12px" }}
            onClick={() => void handleCreateBoard()}
            disabled={creating || !newName.trim()}
          >
            {creating ? "..." : "create"}
          </button>
        </div>
      </div>
    </div>
  );
}
