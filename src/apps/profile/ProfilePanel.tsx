import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { AuthUser, StorageStats, Transfer } from "@/lib/api";
import {
  getSession, getStorageStats, createUserInvite, createTransferLink,
  getMyTransfers, deleteTransfer, ApiError,
} from "@/lib/api";
import { ProfileInfo } from "./ProfileInfo";
import { StorageBar } from "./StorageBar";
import { PasswordForm } from "./PasswordForm";
import { TransferList } from "./TransferList";

type View = "overview" | "password";

export function ProfilePanel({ user: _windowUser }: WindowContentProps) {
  const [view, setView] = useState<View>("overview");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transferUrl, setTransferUrl] = useState<string | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (statusTimer.current) clearTimeout(statusTimer.current); };
  }, []);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, statsRes, transfersRes] = await Promise.allSettled([
        getSession(),
        getStorageStats(),
        getMyTransfers(),
      ]);
      const session = sessionRes.status === "fulfilled" ? sessionRes.value : null;
      setAuthUser(session);
      if (statsRes.status === "fulfilled") setStats(statsRes.value);
      if (transfersRes.status === "fulfilled") setTransfers(transfersRes.value);
      if (!session) {
        showStatus("session expired. log in again.", true);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't load your shit";
      showStatus(msg, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerateInvite = useCallback(async () => {
    setInviteLoading(true);
    try {
      const invite = await createUserInvite();
      setInviteUrl(invite.url);
      try { await navigator.clipboard.writeText(invite.url); } catch { /* clipboard blocked */ }
      showStatus("invite link copied to clipboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't generate invite";
      showStatus(msg, true);
    } finally {
      setInviteLoading(false);
    }
  }, [showStatus]);

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); } catch { /* clipboard blocked */ }
    showStatus("copied to clipboard");
  }, [inviteUrl, showStatus]);

  const handleGenerateTransfer = useCallback(async () => {
    setTransferLoading(true);
    try {
      const result = await createTransferLink();
      setTransferUrl(result.url);
      try { await navigator.clipboard.writeText(result.url); } catch { /* clipboard blocked */ }
      showStatus("upload link copied to clipboard");
      // Refresh transfer list
      const updated = await getMyTransfers();
      setTransfers(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't generate upload link";
      showStatus(msg, true);
    } finally {
      setTransferLoading(false);
    }
  }, [showStatus]);

  const handleCopyTransfer = useCallback(async () => {
    if (!transferUrl) return;
    try { await navigator.clipboard.writeText(transferUrl); } catch { /* clipboard blocked */ }
    showStatus("copied to clipboard");
  }, [transferUrl, showStatus]);

  const handleDeleteTransfer = useCallback(async (id: string) => {
    try {
      await deleteTransfer(id);
      setTransfers(prev => prev.filter(t => t.id !== id));
      showStatus("transfer deleted");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't delete transfer";
      showStatus(msg, true);
    }
  }, [showStatus]);

  const handleCopyTransferLink = useCallback(async (id: string) => {
    const url = `${window.location.origin}/t/${id}`;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked */ }
    showStatus("upload link copied");
  }, [showStatus]);

  if (loading) {
    return (
      <div className="panel-view">
        <div className="admin-loading">
          <span className="spinner" />
          loading your existence...
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="panel-view">
        <div className="admin-empty">couldn't load profile. do you even exist?</div>
      </div>
    );
  }

  return (
    <div className="panel-view">
      <div className="panel-view-header">
        <h2>
          {view === "overview" && "profile"}
          {view === "password" && "change password"}
        </h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {status && (
            <span className={`admin-status${status.isError ? " error" : ""}`}>
              {status.text}
            </span>
          )}
          {view === "overview" ? (
            <button
              className="btn btn-primary"
              onClick={() => setView("password")}
            >
              change password
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => setView("overview")}
            >
              back to profile
            </button>
          )}
        </div>
      </div>

      {view === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", flex: 1, overflow: "auto" }}>
          <ProfileInfo
            user={authUser}
            niggabytes={stats?.niggabytes}
            inviteUrl={inviteUrl}
            inviteLoading={inviteLoading}
            onGenerateInvite={() => void handleGenerateInvite()}
            onCopyInvite={() => void handleCopyInvite()}
            transferUrl={transferUrl}
            transferLoading={transferLoading}
            onGenerateTransfer={() => void handleGenerateTransfer()}
            onCopyTransfer={() => void handleCopyTransfer()}
          />
          {stats && <StorageBar stats={stats} />}

          {/* File Transfers */}
          <div>
            <h3 style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 8 }}>
              file transfers
            </h3>
            <TransferList
              transfers={transfers}
              onDelete={(id) => void handleDeleteTransfer(id)}
              onCopyLink={(id) => void handleCopyTransferLink(id)}
            />
          </div>
        </div>
      )}

      {view === "password" && (
        <PasswordForm
          onSuccess={() => {
            showStatus("password changed. don't forget it this time.");
            setView("overview");
          }}
          onError={(msg) => showStatus(msg, true)}
        />
      )}
    </div>
  );
}
