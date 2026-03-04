import { useState, useRef, useCallback } from "react";
import type { WindowContentProps, FileSystemNode } from "@/types/terminal";
import { resolvePath, normalizePath } from "@/core/filesystem";
import { isValidFilename } from "@/core/security";
import { saveFilesystem } from "@/lib/api";
import { FileList } from "./FileList";

const UPLOAD_QUIPS = [
  "file received. your taste is questionable but ok.",
  "uploaded. the cloud gods accept your offering.",
  "saved. try not to delete it 5 seconds later.",
  "stored in the void. you're welcome.",
  "uploaded. that's one more file nobody will ever open again.",
];

function pickQuip(): string {
  return UPLOAD_QUIPS[Math.floor(Math.random() * UPLOAD_QUIPS.length)]!;
}

interface CloudProps extends WindowContentProps {
  fs: FileSystemNode;
  cwd: string;
}

export function CloudPanel(props: CloudProps) {
  const { fs, cwd } = props;
  const initialCwd = cwd ?? "/";

  const [currentPath, setCurrentPath] = useState(initialCwd);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; node: FileSystemNode } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3500);
  }, []);

  const persist = useCallback(async () => {
    const ok = await saveFilesystem(fs as unknown as Record<string, unknown>);
    if (!ok) showStatus("save failed. you probably hit your storage limit. delete some shit.", true);
    return ok;
  }, [fs, showStatus]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const currentNode = resolvePath(fs, currentPath);

  // Navigation
  const navigateTo = useCallback((name: string) => {
    const next = normalizePath(currentPath, name);
    const target = resolvePath(fs, next);
    if (target?.type === "directory") setCurrentPath(next);
  }, [currentPath, fs]);

  const navigateUp = useCallback(() => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath("/" + parts.join("/"));
  }, [currentPath]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    const parts = currentPath.split("/").filter(Boolean);
    setCurrentPath("/" + parts.slice(0, index + 1).join("/"));
  }, [currentPath]);

  // Upload
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const parent = resolvePath(fs, currentPath);
    if (!parent || parent.type !== "directory" || !parent.children) return;

    let count = 0;
    for (const file of Array.from(files)) {
      const name = file.name;
      if (!isValidFilename(name)) {
        showStatus(`invalid filename: ${name}`, true);
        continue;
      }

      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      parent.children[name] = { name, type: "file", content };
      count++;
    }

    if (count > 0) {
      bump();
      const ok = await persist();
      if (ok) showStatus(count > 1 ? `${count} files uploaded. impressive batch.` : pickQuip());
    }

    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }, [fs, currentPath, bump, persist, showStatus]);

  // Download
  const handleDownload = useCallback((_name: string, node: FileSystemNode) => {
    const content = node.content ?? "";
    let href: string;
    let needsRevoke = false;

    if (content.startsWith("data:")) {
      href = content;
    } else {
      const blob = new Blob([content], { type: "text/plain" });
      href = URL.createObjectURL(blob);
      needsRevoke = true;
    }

    const a = document.createElement("a");
    a.href = href;
    a.download = node.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (needsRevoke) URL.revokeObjectURL(href);
  }, []);

  // New folder
  const handleCreateFolder = useCallback(async () => {
    if (newFolderName === null) return;
    const name = newFolderName.trim();
    if (!name) {
      setNewFolderName(null);
      return;
    }
    if (!isValidFilename(name)) {
      showStatus("invalid folder name. try harder.", true);
      return;
    }

    const parent = resolvePath(fs, currentPath);
    if (!parent || parent.type !== "directory" || !parent.children) return;

    if (parent.children[name]) {
      showStatus("already exists. be more creative.", true);
      return;
    }

    parent.children[name] = { name, type: "directory", children: {} };
    bump();
    setNewFolderName(null);
    const ok = await persist();
    if (ok) showStatus("now fill it with regrets.");
  }, [newFolderName, fs, currentPath, bump, persist, showStatus]);

  // Delete
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const parent = resolvePath(fs, currentPath);
    if (!parent || parent.type !== "directory" || !parent.children) return;

    delete parent.children[deleteTarget.name];
    bump();
    setDeleteTarget(null);
    const ok = await persist();
    if (ok) showStatus("gone. reduced to atoms.");
  }, [deleteTarget, fs, currentPath, bump, persist, showStatus]);

  // Breadcrumb parts
  const pathParts = currentPath.split("/").filter(Boolean);

  if (!currentNode || currentNode.type !== "directory") {
    return (
      <div className="admin-panel">
        <div className="admin-empty">
          path not found. how did you even get here?
        </div>
      </div>
    );
  }

  return (
    <div className="admin-panel" data-version={version}>
      {/* Header */}
      <div className="admin-header">
        <h2>cloud browser</h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {status && (
            <span className={`admin-status${status.isError ? " error" : ""}`}>
              {status.text}
            </span>
          )}
        </div>
      </div>

      {/* Breadcrumbs */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        marginBottom: "12px",
        fontSize: "13px",
        flexWrap: "wrap",
      }}>
        <span
          style={{ color: "var(--accent)", cursor: "pointer" }}
          onClick={() => setCurrentPath("/")}
        >
          /
        </span>
        {pathParts.map((part, i) => (
          <span key={i}>
            <span style={{ color: "var(--text-muted)" }}>/</span>
            <span
              style={{
                color: i === pathParts.length - 1 ? "var(--text-primary)" : "var(--accent)",
                cursor: i === pathParts.length - 1 ? "default" : "pointer",
                fontWeight: i === pathParts.length - 1 ? 600 : 400,
              }}
              onClick={() => { if (i < pathParts.length - 1) navigateToBreadcrumb(i); }}
            >
              {part}
            </span>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{
        display: "flex",
        gap: "8px",
        marginBottom: "12px",
        flexWrap: "wrap",
      }}>
        <button
          className="admin-btn"
          onClick={navigateUp}
          disabled={currentPath === "/"}
          title="go up"
        >
          .. up
        </button>
        <button
          className="admin-btn admin-btn-primary"
          onClick={() => fileInputRef.current?.click()}
        >
          upload
        </button>
        <button
          className="admin-btn"
          onClick={() => setNewFolderName(newFolderName === null ? "" : null)}
        >
          new folder
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void handleUpload(e)}
        />

        {/* Inline new folder input */}
        {newFolderName !== null && (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              className="admin-input"
              style={{ width: "160px", padding: "4px 8px" }}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateFolder();
                if (e.key === "Escape") setNewFolderName(null);
              }}
              placeholder="folder name"
              autoFocus
            />
            <button
              className="admin-btn admin-btn-primary"
              style={{ padding: "4px 10px" }}
              onClick={() => void handleCreateFolder()}
              disabled={!newFolderName.trim()}
            >
              create
            </button>
            <button
              className="admin-btn"
              style={{ padding: "4px 10px" }}
              onClick={() => setNewFolderName(null)}
            >
              cancel
            </button>
          </div>
        )}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: "auto" }} className="terminal-scroll">
        <FileList
          node={currentNode}
          onNavigate={navigateTo}
          onDownload={handleDownload}
          onDelete={(name, node) => setDeleteTarget({ name, node })}
        />
      </div>

      {/* Delete confirmation overlay */}
      {deleteTarget && (
        <div style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.75)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          borderRadius: "inherit",
        }}>
          <div style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border-medium)",
            borderRadius: "8px",
            padding: "24px",
            maxWidth: "400px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "14px", marginBottom: "8px", color: "var(--text-primary)" }}>
              delete <span style={{ color: "var(--accent)", fontWeight: 600 }}>{deleteTarget.name}</span>?
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px" }}>
              {deleteTarget.node.type === "directory"
                ? "this will delete everything inside. this is permanent. unlike your relationships."
                : "this is permanent. no ctrl+z in the cloud, buddy."}
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button
                className="admin-btn"
                onClick={() => setDeleteTarget(null)}
              >
                nah keep it
              </button>
              <button
                className="admin-btn admin-btn-danger"
                onClick={() => void confirmDelete()}
              >
                delete it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
