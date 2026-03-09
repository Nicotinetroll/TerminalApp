import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { EmailAddress, EmailStats, MailFolder } from "@/lib/api";
import { getEmailAddresses, getEmailStats, getCustomFolders, updateEmail, deleteEmail, getEmail, bulkEmailAction, ApiError } from "@/lib/api";
import { AddressSetup } from "./AddressSetup";
import { MailSidebar } from "./MailSidebar";
import { MailList } from "./MailList";
import { MailView } from "./MailView";
import { ComposeView } from "./ComposeView";
import { SignatureEditor } from "./SignatureEditor";
import { SetupGuide } from "./SetupGuide";

type View = "list" | "read" | "compose" | "signatures" | "setup";

export function MailPanel({ user: _user, windowId, windowManager }: WindowContentProps) {
  const [addresses, setAddresses] = useState<EmailAddress[]>([]);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [customFolders, setCustomFolders] = useState<MailFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState("inbox");
  const [view, setView] = useState<View>("list");
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<{ to: string; subject: string; in_reply_to?: string } | null>(null);
  const [forwardData, setForwardData] = useState<{ subject: string; body: string } | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const s = await getEmailStats();
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      const f = await getCustomFolders();
      setCustomFolders(f);
    } catch { /* ignore */ }
    void refreshStats();
  }, [refreshStats]);

  // Clear selection on folder change
  useEffect(() => { setSelectedIds(new Set()); }, [folder]);

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const handleSelectAll = useCallback((ids: number[]) => setSelectedIds(new Set(ids)), []);
  const handleDeselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkAction = useCallback(async (action: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await bulkEmailAction(ids, action);
      setSelectedIds(new Set());
      setListRefreshKey(k => k + 1);
      void refreshStats();
      showStatus(`${ids.length} email${ids.length > 1 ? "s" : ""} ${action === "trash" ? "trashed" : action === "read" ? "marked read" : "marked unread"}`);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "bulk action failed", true);
    }
  }, [selectedIds, refreshStats, showStatus]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [addrs, s, folders] = await Promise.all([
        getEmailAddresses(),
        getEmailStats(),
        getCustomFolders(),
      ]);
      setAddresses(addrs);
      setStats(s);
      setCustomFolders(folders);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't load mail";
      showStatus(msg, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Update window title with unread count
  useEffect(() => {
    if (!windowManager || !windowId) return;
    const unread = stats?.stats["inbox"]?.unread ?? 0;
    const title = unread > 0 ? `mail (${unread})` : "mail";
    windowManager.updateWindowTitle(windowId, title);
  }, [stats, windowManager, windowId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      if (!panelRef.current?.contains(target) && target !== document.body) return;

      switch (e.key) {
        case "n":
          e.preventDefault();
          handleCompose();
          break;
        case "r":
          if (view === "read") {
            e.preventDefault();
          }
          break;
        case "Escape":
          if (view !== "list") {
            e.preventDefault();
            handleBack();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddressClaimed = useCallback((addr: EmailAddress) => {
    setAddresses(prev => [...prev, addr]);
    showStatus(`${addr.full} is yours now`);
  }, [showStatus]);

  const handleAddressDeleted = useCallback((id: number) => {
    setAddresses(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSelectEmail = useCallback(async (id: number) => {
    if (folder === "drafts") {
      try {
        const draft = await getEmail(id);
        setReplyTo(null);
        setForwardData(null);
        setEditingDraftId(id);
        setForwardData({ subject: draft.subject, body: draft.body ?? "" });
        setView("compose");
      } catch {
        showStatus("couldn't load draft", true);
      }
      return;
    }
    setSelectedEmailId(id);
    setView("read");
    void refreshStats();
  }, [refreshStats, folder, showStatus]);

  const handleCompose = useCallback((reply?: { to: string; subject: string; in_reply_to?: string }) => {
    setReplyTo(reply ?? null);
    setForwardData(null);
    setEditingDraftId(undefined);
    setView("compose");
  }, []);

  const handleForward = useCallback((data: { subject: string; body: string }) => {
    setReplyTo(null);
    setForwardData(data);
    setView("compose");
  }, []);

  const handleSent = useCallback(() => {
    setView("list");
    setListRefreshKey(k => k + 1);
    void refreshStats();
  }, [refreshStats]);

  const handleBack = useCallback(() => {
    setView("list");
    setSelectedEmailId(null);
    void refreshStats();
  }, [refreshStats]);

  const handleFolderChange = useCallback((f: string) => {
    setFolder(f);
    setView("list");
    setSelectedEmailId(null);
  }, []);

  const handleSignatureUpdated = useCallback((addrId: number, signature: string) => {
    setAddresses(prev => prev.map(a => a.id === addrId ? { ...a, signature } : a));
  }, []);

  // Quick actions from list
  const handleQuickTrash = useCallback(async (id: number) => {
    try {
      await updateEmail(id, { folder: "trash" });
      setListRefreshKey(k => k + 1);
      void refreshStats();
      showStatus("trashed");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  }, [refreshStats, showStatus]);

  const handleQuickToggleRead = useCallback(async (id: number, currentlyRead: boolean) => {
    try {
      await updateEmail(id, { is_read: !currentlyRead });
      setListRefreshKey(k => k + 1);
      void refreshStats();
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  }, [refreshStats, showStatus]);

  const handleQuickStar = useCallback(async (id: number, currentlyStarred: boolean) => {
    try {
      await updateEmail(id, { is_starred: !currentlyStarred });
      setListRefreshKey(k => k + 1);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  }, [showStatus]);

  if (loading) {
    return (
      <div className="mail-panel">
        <div className="mail-loading">
          <span className="spinner" />
          checking the mailbox...
        </div>
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="mail-panel">
        <AddressSetup
          onClaimed={handleAddressClaimed}
          showStatus={showStatus}
          status={status}
        />
      </div>
    );
  }

  return (
    <div className="mail-panel" ref={panelRef}>
      {status && (
        <div className={`mail-status${status.isError ? " error" : ""}`} onClick={() => setStatus(null)}>
          {status.text}
        </div>
      )}
      <div className="mail-layout">
        <MailSidebar
          folder={folder}
          stats={stats}
          addresses={addresses}
          customFolders={customFolders}
          onFolderChange={handleFolderChange}
          onCompose={() => handleCompose()}
          onAddressDeleted={handleAddressDeleted}
          onFoldersChanged={() => void refreshFolders()}
          onEditSignatures={() => setView("signatures")}
          onSetupGuide={() => setView("setup")}
          showStatus={showStatus}
        />
        <div className="mail-main">
          {view === "list" && (
            <MailList
              folder={folder}
              onSelect={handleSelectEmail}
              onCompose={() => handleCompose()}
              onQuickTrash={handleQuickTrash}
              onQuickToggleRead={handleQuickToggleRead}
              onQuickStar={handleQuickStar}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onBulkAction={handleBulkAction}
              customFolders={customFolders}
              key={`${folder}-${listRefreshKey}`}
            />
          )}
          {view === "read" && selectedEmailId !== null && (
            <MailView
              emailId={selectedEmailId}
              onBack={handleBack}
              onReply={handleCompose}
              onForward={handleForward}
              onDelete={() => {
                handleBack();
                showStatus("email deleted");
              }}
              showStatus={showStatus}
            />
          )}
          {view === "compose" && (
            <ComposeView
              addresses={addresses}
              replyTo={replyTo}
              forwardData={forwardData}
              draftId={editingDraftId}
              onSent={handleSent}
              onCancel={handleBack}
              showStatus={showStatus}
            />
          )}
          {view === "signatures" && (
            <SignatureEditor
              addresses={addresses}
              onUpdated={handleSignatureUpdated}
              onClose={handleBack}
              showStatus={showStatus}
            />
          )}
          {view === "setup" && (
            <SetupGuide
              addresses={addresses}
              onClose={handleBack}
            />
          )}
        </div>
      </div>
    </div>
  );
}
