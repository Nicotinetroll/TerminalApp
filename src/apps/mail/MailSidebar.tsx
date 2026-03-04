import { useState } from "react";
import type { EmailAddress, EmailStats, MailFolder } from "@/lib/api";
import { claimEmailAddress, deleteEmailAddress, createFolder, deleteFolder, ApiError } from "@/lib/api";

interface Props {
  folder: string;
  stats: EmailStats | null;
  addresses: EmailAddress[];
  customFolders: MailFolder[];
  onFolderChange: (folder: string) => void;
  onCompose: () => void;
  onAddressDeleted: (id: number) => void;
  onFoldersChanged: () => void;
  onEditSignatures: () => void;
  showStatus: (text: string, isError?: boolean) => void;
}

const FOLDERS = [
  { id: "inbox", label: "inbox", icon: ">" },
  { id: "starred", label: "starred", icon: "*" },
  { id: "sent", label: "sent", icon: "<" },
  { id: "drafts", label: "drafts", icon: "~" },
  { id: "trash", label: "trash", icon: "x" },
] as const;

export function MailSidebar({
  folder, stats, addresses, customFolders, onFolderChange, onCompose,
  onAddressDeleted, onFoldersChanged, onEditSignatures, showStatus,
}: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddr, setNewAddr] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const handleClaim = async () => {
    const clean = newAddr.toLowerCase().trim();
    if (!clean) return;
    setClaiming(true);
    try {
      await claimEmailAddress(clean);
      setNewAddr("");
      setShowAddForm(false);
      showStatus(`${clean}@mynig.ga claimed! refresh to see it.`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't claim", true);
    } finally {
      setClaiming(false);
    }
  };

  const handleDelete = async (addr: EmailAddress) => {
    if (!confirm(`delete ${addr.full}? this also deletes all emails for this address.`)) return;
    try {
      await deleteEmailAddress(addr.id);
      onAddressDeleted(addr.id);
      showStatus(`${addr.full} released`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't delete", true);
    }
  };

  const handleCreateFolder = async () => {
    const clean = newFolderName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!clean) return;
    setCreatingFolder(true);
    try {
      await createFolder(clean);
      setNewFolderName("");
      setShowFolderForm(false);
      onFoldersChanged();
      showStatus(`folder "${clean}" created`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't create folder", true);
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDeleteFolder = async (f: MailFolder) => {
    if (!confirm(`delete folder "${f.name}"? emails in it will move back to inbox.`)) return;
    try {
      await deleteFolder(f.id);
      onFoldersChanged();
      showStatus(`folder "${f.name}" deleted`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't delete folder", true);
    }
  };

  return (
    <div className="mail-sidebar">
      <button className="mail-compose-btn" onClick={onCompose}>
        + compose
      </button>

      <div className="mail-folders">
        {FOLDERS.map(f => {
          const unread = stats?.stats[f.id]?.unread ?? 0;
          const total = stats?.stats[f.id]?.total ?? 0;
          return (
            <div
              key={f.id}
              className={`mail-folder-item${folder === f.id ? " active" : ""}`}
              onClick={() => onFolderChange(f.id)}
            >
              <span className="mail-folder-icon">{f.icon}</span>
              <span className="mail-folder-label">{f.label}</span>
              {unread > 0 && (
                <span className="mail-folder-badge">{unread}</span>
              )}
              {(f.id === "starred" || f.id === "drafts") && total > 0 && unread === 0 && (
                <span className="mail-folder-count">{total}</span>
              )}
            </div>
          );
        })}

        {customFolders.length > 0 && (
          <div className="mail-custom-folders-divider" />
        )}

        {customFolders.map(f => {
          const unread = stats?.stats[f.name]?.unread ?? 0;
          const total = stats?.stats[f.name]?.total ?? 0;
          return (
            <div
              key={f.id}
              className={`mail-folder-item${folder === f.name ? " active" : ""}`}
              onClick={() => onFolderChange(f.name)}
            >
              <span className="mail-folder-icon">#</span>
              <span className="mail-folder-label">{f.name}</span>
              {unread > 0 && (
                <span className="mail-folder-badge">{unread}</span>
              )}
              {total > 0 && unread === 0 && (
                <span className="mail-folder-count">{total}</span>
              )}
              <button
                className="mail-folder-delete"
                onClick={e => { e.stopPropagation(); void handleDeleteFolder(f); }}
                title="delete folder"
              >
                x
              </button>
            </div>
          );
        })}

        {!showFolderForm ? (
          <button
            className="mail-address-add"
            onClick={() => setShowFolderForm(true)}
            style={{ fontSize: "10px", color: "var(--text-ghost)" }}
          >
            + folder
          </button>
        ) : (
          <div className="mail-address-form" style={{ padding: "4px 10px" }}>
            <input
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              onKeyDown={e => { if (e.key === "Enter") void handleCreateFolder(); if (e.key === "Escape") setShowFolderForm(false); }}
              placeholder="name"
              maxLength={32}
              disabled={creatingFolder}
              autoFocus
            />
            <button
              className="mail-address-form-btn"
              onClick={() => void handleCreateFolder()}
              disabled={creatingFolder || newFolderName.length < 1}
            >
              {creatingFolder ? "..." : "+"}
            </button>
            <button
              className="mail-address-form-btn"
              onClick={() => { setShowFolderForm(false); setNewFolderName(""); }}
            >
              x
            </button>
          </div>
        )}
      </div>

      <div className="mail-sidebar-section">
        <div className="mail-sidebar-section-label">addresses</div>
        {addresses.map(addr => (
          <div key={addr.id} className="mail-address-item">
            <span className="mail-address-text">{addr.full}</span>
            <button
              className="mail-address-delete"
              onClick={() => void handleDelete(addr)}
              title="release address"
            >
              x
            </button>
          </div>
        ))}
        {addresses.length < 3 && !showAddForm && (
          <button
            className="mail-address-add"
            onClick={() => setShowAddForm(true)}
          >
            + add address
          </button>
        )}
        {showAddForm && (
          <div className="mail-address-form">
            <input
              type="text"
              value={newAddr}
              onChange={e => setNewAddr(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
              onKeyDown={e => { if (e.key === "Enter") void handleClaim(); }}
              placeholder="name"
              maxLength={32}
              disabled={claiming}
              autoFocus
            />
            <button
              className="mail-address-form-btn"
              onClick={() => void handleClaim()}
              disabled={claiming || newAddr.length < 2}
            >
              {claiming ? "..." : "+"}
            </button>
            <button
              className="mail-address-form-btn"
              onClick={() => { setShowAddForm(false); setNewAddr(""); }}
            >
              x
            </button>
          </div>
        )}
        <button
          className="mail-address-add"
          onClick={onEditSignatures}
          style={{ marginTop: "4px" }}
        >
          signatures
        </button>
      </div>
    </div>
  );
}
