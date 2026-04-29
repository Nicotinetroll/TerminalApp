import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import type { WindowContentProps, FileSystemNode } from "@/types/terminal";
import { resolvePath, normalizePath } from "@/core/filesystem";
import { isValidFilename } from "@/core/security";
import { saveFilesystem, cloudPresign, cloudConfirm, deleteCloudFile, migrateCloud, getCloudStats, getToken, createCloudShare, getShareForFile, deleteCloudShare, renameCloudFile, bulkMoveCloudFiles, shareFolder } from "@/lib/api";
import type { CloudShare } from "@/lib/api";
import type { StorageStats } from "@/lib/api";
import { FileList } from "./FileList";
import { formatBytes } from "./helpers";

const UPLOAD_QUIPS = [
  "file received. your taste is questionable but ok.",
  "uploaded. the cloud gods accept your offering.",
  "saved. try not to delete it 5 seconds later.",
  "stored in the void. you're welcome.",
  "uploaded. that's one more file nobody will ever open again.",
  "S3 has accepted your tribute.",
];

function pickQuip(): string {
  return UPLOAD_QUIPS[Math.floor(Math.random() * UPLOAD_QUIPS.length)]!;
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `~${Math.ceil(seconds)}s left`;
  return `~${Math.ceil(seconds / 60)}m left`;
}

function getBarColor(percent: number): string {
  if (percent > 95) return "var(--error)";
  if (percent > 80) return "#f59e0b";
  return "var(--accent)";
}

function getStorageLabel(percent: number, isUnlimited: boolean): string {
  if (isUnlimited) return "unlimited. you're built different.";
  if (percent === 69) return "nice.";
  if (percent === 0) return "empty.";
  if (percent < 50) return "";
  if (percent < 80) return "getting thicc.";
  if (percent < 95) return "running low. delete something.";
  return "almost full. clean up or suffer.";
}

interface CloudProps extends WindowContentProps {
  fs: FileSystemNode;
  fsReady?: boolean;
  cwd: string;
}

export function CloudPanel(props: CloudProps) {
  const { fs, fsReady = true, cwd } = props;
  const initialCwd = cwd ?? "/";

  const [currentPath, setCurrentPath] = useState(initialCwd);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; node: FileSystemNode } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ name: string; node: FileSystemNode } | null>(null);
  const [sharePhase, setSharePhase] = useState<"loading" | "create" | "existing" | "created">("loading");
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState<number>(7);
  const [shareExisting, setShareExisting] = useState<(CloudShare & { url: string }) | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number; total: number; name: string;
    phase: "uploading" | "confirming" | "saving";
    loaded?: number; fileSize?: number; speed?: number; eta?: number;
  } | null>(null);
  const [displayPercent, setDisplayPercent] = useState(0);
  const targetPctRef = useRef(0);
  const currentPctRef = useRef(0);
  const rafRef = useRef(0);
  const uploadStartRef = useRef(0);
  const [preview, setPreview] = useState<{ name: string; node: FileSystemNode } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState<{ name: string; node: FileSystemNode } | null>(null);
  const [moveDest, setMoveDest] = useState("");
  const [moveLoading, setMoveLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const migrationChecked = useRef(false);
  const shareRequestId = useRef(0);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3500);
  }, []);

  const persist = useCallback(async () => {
    const ok = await saveFilesystem(fs as unknown as Record<string, unknown>);
    if (!ok) showStatus("save failed. try again.", true);
    return ok;
  }, [fs, showStatus]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Load storage stats
  const refreshStorage = useCallback(async () => {
    try {
      const s = await getCloudStats();
      setStorage(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage]);

  // Smooth upload progress lerp
  useEffect(() => {
    if (!uploadProgress || uploadProgress.phase === "saving") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    if (uploadProgress.phase === "confirming") {
      // Target end of current file's range (not 100%, to avoid snap-back on multi-file)
      targetPctRef.current = (uploadProgress.current / uploadProgress.total) * 100;
    } else if (uploadProgress.loaded != null && uploadProgress.fileSize) {
      // For multi-file: blend file-count progress with byte progress within current file
      const filePct = ((uploadProgress.current - 1) / uploadProgress.total) * 100;
      const bytePct = (uploadProgress.loaded / uploadProgress.fileSize) * (100 / uploadProgress.total);
      targetPctRef.current = Math.min(99, filePct + bytePct);
    } else {
      targetPctRef.current = 0;
    }
    const tick = () => {
      const diff = targetPctRef.current - currentPctRef.current;
      currentPctRef.current += diff * 0.08;
      if (Math.abs(diff) < 0.3) currentPctRef.current = targetPctRef.current;
      setDisplayPercent(Math.round(currentPctRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [uploadProgress]);

  // Auto-migration: check if tree has old data:// files on first load
  useEffect(() => {
    if (migrationChecked.current) return;
    migrationChecked.current = true;

    const serialized = JSON.stringify(fs);
    if (serialized.length > 100_000 && serialized.includes('"data:')) {
      setMigrating(true);
      void migrateCloud().then((result) => {
        setMigrating(false);
        if (result.migrated > 0) {
          showStatus(result.message);
          window.location.reload();
        }
      }).catch(() => {
        setMigrating(false);
      });
    }
  }, [fs, showStatus]);

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

  // Unified upload handler (from file input or drag-drop)
  const uploadFiles = useCallback(async (files: File[]) => {
    const parent = resolvePath(fs, currentPath);
    if (!parent || parent.type !== "directory" || !parent.children) return;

    let count = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const name = file.name;
      if (!isValidFilename(name)) {
        showStatus(`invalid filename: ${name}`, true);
        continue;
      }

      uploadStartRef.current = Date.now();
      setUploadProgress({ current: i + 1, total: files.length, name, phase: "uploading", loaded: 0, fileSize: file.size });

      try {
        const { fileId, uploadUrl } = await cloudPresign(
          name, currentPath, file.type || "application/octet-stream", file.size
        );

        const uploadRes = await new Promise<boolean>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl, true);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const elapsed = (Date.now() - uploadStartRef.current) / 1000;
            const speed = elapsed > 0 ? e.loaded / elapsed : 0;
            const remaining = e.total - e.loaded;
            const eta = speed > 0 ? remaining / speed : Infinity;
            setUploadProgress((prev) => prev ? { ...prev, loaded: e.loaded, fileSize: e.total, speed, eta } : prev);
          };
          xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
          xhr.onerror = () => resolve(false);
          xhr.send(file);
        });

        if (!uploadRes) {
          showStatus(`upload failed for ${name}. S3 said no.`, true);
          continue;
        }

        setUploadProgress((prev) => prev ? { ...prev, phase: "confirming" } : prev);
        await cloudConfirm(fileId, name, currentPath, file.type || "application/octet-stream", file.size);

        parent.children[name] = {
          name,
          type: "file",
          s3Key: fileId,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        };
        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload failed";
        showStatus(msg, true);
      }
    }

    if (count > 0) {
      setUploadProgress({ current: count, total: count, name: "", phase: "saving" });
      setDisplayPercent(100);
      bump();
      const ok = await persist();
      setUploadProgress(null);
      setDisplayPercent(0);
      currentPctRef.current = 0;
      targetPctRef.current = 0;
      if (ok) showStatus(count > 1 ? `${count} files uploaded. impressive batch.` : pickQuip());
      void refreshStorage();
    } else {
      setUploadProgress(null);
      setDisplayPercent(0);
      currentPctRef.current = 0;
      targetPctRef.current = 0;
    }
  }, [fs, currentPath, bump, persist, showStatus, refreshStorage]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
    e.target.value = "";
  }, [uploadFiles]);

  // Drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void uploadFiles(files);
  }, [uploadFiles]);

  // Download
  const handleDownload = useCallback((_name: string, node: FileSystemNode) => {
    if (node.s3Key) {
      const token = getToken();
      const url = `/api/cloud/download/${encodeURIComponent(node.s3Key)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
      window.open(url, "_blank");
      return;
    }

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

  // Share — open dialog
  const openShareDialog = useCallback((_name: string, node: FileSystemNode) => {
    // Directories can always be shared (zipped); files need an s3Key
    if (node.type !== "directory" && !node.s3Key) return;

    setShareTarget({ name: _name, node });
    setSharePassword("");
    setShareExpiry(7);
    setShareExisting(null);
    setShareLoading(false);
    setShareCopied(false);

    // Folders go straight to create (new zip each time)
    if (node.type === "directory") {
      setSharePhase("create");
      return;
    }

    setSharePhase("loading");
    const reqId = ++shareRequestId.current;
    void getShareForFile(node.s3Key!).then((existing) => {
      if (reqId !== shareRequestId.current) return;
      if (existing) {
        setShareExisting(existing);
        setSharePhase("existing");
      } else {
        setSharePhase("create");
      }
    }).catch(() => {
      if (reqId !== shareRequestId.current) return;
      setSharePhase("create");
    });
  }, []);

  const handleCreateShare = useCallback(async () => {
    if (!shareTarget) return;
    setShareLoading(true);
    try {
      if (shareTarget.node.type === "directory") {
        // Folder share: zip + share via dedicated endpoint
        const folderPath = currentPath === "/" ? `/${shareTarget.name}` : `${currentPath}/${shareTarget.name}`;
        const result = await shareFolder(folderPath, sharePassword || undefined, shareExpiry);
        setShareExisting(result as unknown as CloudShare & { url: string });
        setSharePhase("created");

        // Add zip to filesystem tree so user can see/manage/delete it
        const folderNode = resolvePath(fs, folderPath);
        if (folderNode?.children) {
          folderNode.children[result.zip_filename] = {
            name: result.zip_filename,
            type: "file",
            s3Key: result.zip_file_id,
            size: result.zip_size,
            mimeType: "application/zip",
          };
          bump();
          await persist();
        }
        void refreshStorage();
      } else {
        // File share: existing flow
        if (!shareTarget.node.s3Key) return;
        const result = await createCloudShare(shareTarget.node.s3Key, sharePassword || undefined, shareExpiry);
        setShareExisting(result);
        setSharePhase("created");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "share failed";
      showStatus(msg, true);
      setShareTarget(null);
    } finally {
      setShareLoading(false);
    }
  }, [shareTarget, sharePassword, shareExpiry, showStatus, currentPath, refreshStorage, fs, bump, persist]);

  const handleRevokeShare = useCallback(async () => {
    if (!shareExisting) return;
    setShareLoading(true);
    try {
      await deleteCloudShare(shareExisting.id);
      setShareExisting(null);
      setSharePhase("create");
      setSharePassword("");
      setShareExpiry(7);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "revoke failed";
      showStatus(msg, true);
    } finally {
      setShareLoading(false);
    }
  }, [shareExisting, showStatus]);

  const handleCopyShareUrl = useCallback(() => {
    const url = shareExisting?.url;
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }, [shareExisting]);

  // Preview
  const getPreviewUrl = useCallback((node: FileSystemNode) => {
    if (!node.s3Key) return null;
    const token = getToken();
    return `/api/cloud/download/${encodeURIComponent(node.s3Key)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }, []);

  const getPreviewType = useCallback((node: FileSystemNode): "image" | "video" | "audio" | null => {
    const mime = node.mimeType || "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return null;
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

    const node = deleteTarget.node;
    const s3Keys: string[] = [];
    function collectKeys(n: FileSystemNode): void {
      if (n.s3Key) s3Keys.push(n.s3Key);
      if (n.children) {
        for (const child of Object.values(n.children)) collectKeys(child);
      }
    }
    collectKeys(node);

    delete parent.children[deleteTarget.name];
    bump();
    setDeleteTarget(null);

    for (const key of s3Keys) {
      void deleteCloudFile(key).catch(() => {});
    }

    const ok = await persist();
    if (ok) showStatus("gone. reduced to atoms.");
    void refreshStorage();
  }, [deleteTarget, fs, currentPath, bump, persist, showStatus, refreshStorage]);

  // ── Rename ──
  const startRename = useCallback((name: string, _node: FileSystemNode) => {
    setRenameTarget(name);
    setRenameValue(name);
  }, []);

  const confirmRename = useCallback(async () => {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (!newName || newName === renameTarget) {
      setRenameTarget(null);
      return;
    }
    if (!isValidFilename(newName)) {
      showStatus("invalid name. try something that's not garbage.", true);
      return;
    }

    const parent = resolvePath(fs, currentPath);
    if (!parent?.children) return;

    if (parent.children[newName]) {
      showStatus(`"${newName}" already exists. be more creative.`, true);
      return;
    }

    const node = parent.children[renameTarget];
    if (!node) return;

    // Mutate tree: remove old key, add new key, update node.name
    delete parent.children[renameTarget];
    node.name = newName;
    parent.children[newName] = node;

    // If S3 file, update DB filename
    if (node.s3Key) {
      try {
        await renameCloudFile(node.s3Key, { filename: newName });
      } catch {
        showStatus("renamed locally but DB update failed.", true);
      }
    }

    // If directory with S3 files inside, update their cloud_files.path in DB
    // cloud_files.path = the parent directory where the file lives
    if (node.type === "directory") {
      const moves: { id: string; path: string }[] = [];
      const newDirPath = currentPath === "/" ? `/${newName}` : `${currentPath}/${newName}`;

      function collectS3InDir(dir: FileSystemNode, dirPath: string): void {
        if (!dir.children) return;
        for (const [childName, child] of Object.entries(dir.children)) {
          if (child.s3Key) {
            // file lives in dirPath
            moves.push({ id: child.s3Key, path: dirPath });
          }
          if (child.type === "directory") {
            collectS3InDir(child, dirPath === "/" ? `/${childName}` : `${dirPath}/${childName}`);
          }
        }
      }
      collectS3InDir(node, newDirPath);

      if (moves.length > 0) {
        void bulkMoveCloudFiles(moves).catch(() => {});
      }
    }

    bump();
    setRenameTarget(null);
    const ok = await persist();
    if (ok) showStatus(`renamed to "${newName}". fresh identity.`);
  }, [renameTarget, renameValue, fs, currentPath, bump, persist, showStatus]);

  const cancelRename = useCallback(() => setRenameTarget(null), []);

  // ── Move ──
  const startMove = useCallback((name: string, node: FileSystemNode) => {
    setMoveTarget({ name, node });
    // Default destination: parent of current path
    const parentPath = currentPath === "/" ? "/" : currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    setMoveDest(parentPath);
    setMoveLoading(false);
  }, [currentPath]);

  // Collect all directory paths for quick-pick
  const getAllDirPaths = useCallback((): string[] => {
    const paths: string[] = ["/"];
    function walk(node: FileSystemNode, path: string): void {
      if (node.children) {
        for (const [name, child] of Object.entries(node.children)) {
          if (child.type === "directory") {
            const full = path === "/" ? `/${name}` : `${path}/${name}`;
            paths.push(full);
            walk(child, full);
          }
        }
      }
    }
    walk(fs, "/");
    return paths;
  }, [fs]);

  const confirmMove = useCallback(async () => {
    if (!moveTarget) return;
    const raw = moveDest.trim() || "/";
    // Normalize so "..", relative paths, and trailing slashes all work
    const dest = normalizePath(currentPath, raw);

    // Validate destination
    const destNode = resolvePath(fs, dest);
    if (!destNode || destNode.type !== "directory" || !destNode.children) {
      showStatus("destination doesn't exist or isn't a directory.", true);
      return;
    }

    // Can't move to same location
    if (dest === currentPath) {
      showStatus("it's already there. what are you doing?", true);
      return;
    }

    // Can't move a folder into itself
    if (moveTarget.node.type === "directory") {
      const srcPath = currentPath === "/" ? `/${moveTarget.name}` : `${currentPath}/${moveTarget.name}`;
      if (dest === srcPath || dest.startsWith(srcPath + "/")) {
        showStatus("can't move a folder into itself. that's a paradox.", true);
        return;
      }
    }

    // Check name collision
    if (destNode.children[moveTarget.name]) {
      showStatus(`"${moveTarget.name}" already exists in destination.`, true);
      return;
    }

    setMoveLoading(true);

    // Remove from source
    const parent = resolvePath(fs, currentPath);
    if (!parent?.children) { setMoveLoading(false); return; }
    delete parent.children[moveTarget.name];

    // Add to destination
    destNode.children[moveTarget.name] = moveTarget.node;

    // Collect S3 files and update their cloud_files.path (= parent directory)
    const moves: { id: string; path: string }[] = [];
    const newItemPath = dest === "/" ? `/${moveTarget.name}` : `${dest}/${moveTarget.name}`;

    function collectS3(dir: FileSystemNode, dirPath: string): void {
      if (!dir.children) return;
      for (const [childName, child] of Object.entries(dir.children)) {
        if (child.s3Key) {
          // file's parent directory is dirPath
          moves.push({ id: child.s3Key, path: dirPath });
        }
        if (child.type === "directory") {
          collectS3(child, dirPath === "/" ? `/${childName}` : `${dirPath}/${childName}`);
        }
      }
    }

    // If the moved item itself is an S3 file
    if (moveTarget.node.s3Key) {
      moves.push({ id: moveTarget.node.s3Key, path: dest });
    }
    // If it's a directory, collect S3 files inside
    if (moveTarget.node.type === "directory") {
      collectS3(moveTarget.node, newItemPath);
    }

    if (moves.length > 0) {
      try {
        await bulkMoveCloudFiles(moves);
      } catch {
        showStatus("moved locally but some DB paths failed to update.", true);
      }
    }

    bump();
    setMoveTarget(null);
    setMoveLoading(false);
    const ok = await persist();
    if (ok) showStatus(`moved to ${dest}. witness relocation.`);
    void refreshStorage();
  }, [moveTarget, moveDest, fs, currentPath, bump, persist, showStatus, refreshStorage]);

  // Storage bar
  const isUnlimited = storage ? storage.limit === 0 : false;
  const storagePercent = storage && !isUnlimited
    ? Math.min(100, Math.round((storage.used / storage.limit) * 100))
    : 0;

  const pathParts = currentPath.split("/").filter(Boolean);

  if (!fsReady || migrating) {
    return (
      <div className="cloud-panel">
        <div className="cloud-skeleton">
          <div className="cloud-skeleton-bar" />
          <div className="cloud-skeleton-toolbar">
            <div className="cloud-skeleton-crumb" />
            <div className="cloud-skeleton-btn" />
            <div className="cloud-skeleton-btn" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="cloud-skeleton-row">
              <div className="cloud-skeleton-icon" />
              <div className="cloud-skeleton-name" style={{ width: `${40 + Math.random() * 30}%` }} />
              <div className="cloud-skeleton-size" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!currentNode || currentNode.type !== "directory") {
    return (
      <div className="cloud-panel">
        <div className="cloud-empty">
          path not found. how did you even get here?
        </div>
      </div>
    );
  }

  return (
    <div
      className={`cloud-panel${isDragOver ? " cloud-panel--dragover" : ""}`}
      data-version={version}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Status toast */}
      {status && (
        <div className={`cloud-toast${status.isError ? " cloud-toast--error" : ""}`}>
          {status.text}
        </div>
      )}

      {/* Storage bar */}
      {storage && (
        <div className="cloud-storage">
          <div className="cloud-storage-info">
            <span className="cloud-storage-used">
              {formatBytes(storage.used)}
              <span className="cloud-storage-sep"> / </span>
              {isUnlimited ? "\u221E" : formatBytes(storage.limit)}
            </span>
            {!isUnlimited && storagePercent > 0 && (
              <span className="cloud-storage-pct">{storagePercent}%</span>
            )}
          </div>
          <div className="cloud-storage-track">
            <div
              className="cloud-storage-fill"
              style={{
                width: isUnlimited ? "2%" : `${Math.max(storagePercent, 1)}%`,
                background: isUnlimited ? "var(--accent)" : getBarColor(storagePercent),
              }}
            />
          </div>
          {getStorageLabel(storagePercent, isUnlimited) && (
            <div className="cloud-storage-label">
              {getStorageLabel(storagePercent, isUnlimited)}
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="cloud-toolbar">
        <div className="cloud-breadcrumbs">
          <span
            className="cloud-crumb cloud-crumb--root"
            onClick={() => setCurrentPath("/")}
          >
            /
          </span>
          {pathParts.map((part, i) => (
            <span key={i} className="cloud-crumb-group">
              <span className="cloud-crumb-sep">/</span>
              <span
                className={`cloud-crumb${i === pathParts.length - 1 ? " cloud-crumb--active" : ""}`}
                onClick={() => { if (i < pathParts.length - 1) navigateToBreadcrumb(i); }}
              >
                {part}
              </span>
            </span>
          ))}
        </div>
        <div className="cloud-actions">
          {currentPath !== "/" && (
            <button className="btn cloud-btn" onClick={navigateUp} title="go up">
              ..
            </button>
          )}
          <button
            className="btn cloud-btn cloud-btn--primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!uploadProgress}
          >
            upload
          </button>
          <button
            className="btn cloud-btn"
            onClick={() => setNewFolderName(newFolderName === null ? "" : null)}
          >
            + folder
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void handleUpload(e)}
          />
        </div>
      </div>

      {/* New folder inline */}
      {newFolderName !== null && (
        <div className="cloud-new-folder">
          <input
            className="cloud-new-folder-input"
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
            className="btn cloud-btn cloud-btn--primary"
            onClick={() => void handleCreateFolder()}
            disabled={!newFolderName.trim()}
          >
            create
          </button>
          <button className="btn cloud-btn" onClick={() => setNewFolderName(null)}>
            cancel
          </button>
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress && (
        <div className="cloud-upload-zone">
          <div className="cloud-up-percent">
            {displayPercent}<span className="cloud-up-percent-sign">%</span>
          </div>

          <div className="cloud-up-bar-wrap">
            {uploadProgress.phase === "uploading" && !uploadProgress.loaded ? (
              <div className="cloud-up-bar cloud-up-bar--indeterminate" />
            ) : (
              <>
                <div className="cloud-up-bar" style={{ width: `${displayPercent}%` }}>
                  <div className="cloud-up-bar-shine" />
                </div>
                <div className="cloud-up-bar-glow" style={{ left: `${displayPercent}%` }} />
              </>
            )}
          </div>

          {uploadProgress.phase === "uploading" && uploadProgress.loaded != null && uploadProgress.fileSize ? (
            <div className="cloud-up-stats">
              <span>{formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.fileSize)}</span>
              {uploadProgress.speed != null && (
                <span className="cloud-up-speed">{formatSpeed(uploadProgress.speed)}</span>
              )}
              {uploadProgress.eta != null && (
                <span>{formatEta(uploadProgress.eta)}</span>
              )}
            </div>
          ) : null}

          <div className="cloud-up-label">
            {uploadProgress.phase === "saving"
              ? "syncing filesystem..."
              : uploadProgress.phase === "confirming"
              ? "finalizing..."
              : uploadProgress.total > 1
              ? `${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.name}`
              : uploadProgress.name}
          </div>
        </div>
      )}

      {/* File list */}
      <div className="cloud-files terminal-scroll">
        <FileList
          node={currentNode}
          onNavigate={navigateTo}
          onDownload={handleDownload}
          onDelete={(name, node) => setDeleteTarget({ name, node })}
          onShare={(name, node) => openShareDialog(name, node)}
          onPreview={(name, node) => setPreview({ name, node })}
          onRename={startRename}
          onMove={startMove}
          renameTarget={renameTarget}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameConfirm={() => void confirmRename()}
          onRenameCancel={cancelRename}
        />
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div className="cloud-drag-overlay">
          drop files to upload
        </div>
      )}

      {/* Lightbox (portal to body so it covers the full viewport) */}
      {preview && (() => {
        const previewUrl = getPreviewUrl(preview.node);
        const previewType = getPreviewType(preview.node);
        if (!previewUrl || !previewType) return null;
        return createPortal(
          <CloudLightbox
            name={preview.name}
            url={previewUrl}
            type={previewType}
            size={preview.node.size}
            onClose={() => setPreview(null)}
            onDownload={() => handleDownload(preview.name, preview.node)}
          />,
          document.body,
        );
      })()}

      {/* Share dialog */}
      {shareTarget && (
        <div className="cloud-delete-overlay">
          <div className="cloud-delete-dialog">
            {sharePhase === "loading" && (
              <>
                <div className="cloud-delete-title">
                  share <span style={{ color: "var(--accent)", fontWeight: 600 }}>{shareTarget.name}</span>
                </div>
                <div className="cloud-delete-desc">checking for existing links...</div>
              </>
            )}

            {sharePhase === "create" && (
              <>
                <div className="cloud-delete-title">
                  share <span style={{ color: "var(--accent)", fontWeight: 600 }}>{shareTarget.name}</span>
                </div>
                <div className="cloud-delete-desc" style={{ marginBottom: 8 }}>
                  pick how long the link should survive.
                </div>
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {([
                    [1, "1 day"],
                    [7, "7 days"],
                    [30, "30 days"],
                    [0, "forever"],
                  ] as const).map(([days, label]) => (
                    <button
                      key={days}
                      className={`btn cloud-btn${shareExpiry === days ? " cloud-btn--primary" : ""}`}
                      style={{ flex: 1, fontSize: 11 }}
                      onClick={() => setShareExpiry(days)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  className="cloud-new-folder-input"
                  style={{ width: "100%", marginBottom: 16, boxSizing: "border-box" }}
                  type="password"
                  placeholder="password (optional)"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreateShare(); }}
                  autoFocus
                />
                <div className="cloud-delete-actions">
                  <button className="btn cloud-btn" onClick={() => setShareTarget(null)}>
                    cancel
                  </button>
                  <button
                    className="btn cloud-btn cloud-btn--primary"
                    onClick={() => void handleCreateShare()}
                    disabled={shareLoading}
                  >
                    {shareLoading ? (shareTarget?.node.type === "directory" ? "zipping..." : "creating...") : "create link"}
                  </button>
                </div>
              </>
            )}

            {(sharePhase === "existing" || sharePhase === "created") && shareExisting && (
              <>
                <div className="cloud-delete-title">
                  {sharePhase === "created" ? "link ready" : "active share"}
                </div>
                <div className="cloud-delete-desc">
                  {shareExisting.has_password ? "password-protected. " : ""}
                  {shareExisting.downloads} download{shareExisting.downloads !== 1 ? "s" : ""}
                  {" \u00b7 "}
                  {shareExisting.expires_at.startsWith("9999")
                    ? "never expires"
                    : `expires ${new Date(shareExisting.expires_at + "Z").toLocaleDateString()}`}
                </div>
                <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                  <input
                    className="cloud-new-folder-input"
                    style={{ flex: 1, fontSize: 11 }}
                    value={shareExisting.url}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    className="btn cloud-btn cloud-btn--primary"
                    onClick={handleCopyShareUrl}
                  >
                    {shareCopied ? "copied!" : "copy"}
                  </button>
                </div>
                <div className="cloud-delete-actions">
                  <button
                    className="btn cloud-btn cloud-btn--danger"
                    onClick={() => void handleRevokeShare()}
                    disabled={shareLoading}
                  >
                    {shareLoading ? "revoking..." : "revoke"}
                  </button>
                  <button className="btn cloud-btn" onClick={() => setShareTarget(null)}>
                    done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Move dialog */}
      {moveTarget && (
        <div className="cloud-delete-overlay">
          <div className="cloud-delete-dialog" style={{ maxWidth: 420 }}>
            <div className="cloud-delete-title">
              mv <span style={{ color: "var(--accent)", fontWeight: 600 }}>{moveTarget.name}</span>
            </div>
            <div className="cloud-delete-desc" style={{ marginBottom: 8 }}>
              type the destination path, like a real hacker.
            </div>
            <input
              className="cloud-new-folder-input"
              style={{ width: "100%", marginBottom: 8, boxSizing: "border-box" }}
              value={moveDest}
              onChange={(e) => setMoveDest(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void confirmMove(); if (e.key === "Escape") setMoveTarget(null); }}
              placeholder="/destination/path"
              autoFocus
            />
            <div className="cloud-move-picks">
              {getAllDirPaths()
                .filter((p) => {
                  if (p === currentPath) return false;
                  // Exclude self (if moving a dir)
                  if (moveTarget.node.type === "directory") {
                    const srcPath = currentPath === "/" ? `/${moveTarget.name}` : `${currentPath}/${moveTarget.name}`;
                    if (p === srcPath || p.startsWith(srcPath + "/")) return false;
                  }
                  return true;
                })
                .slice(0, 8)
                .map((p) => (
                  <button
                    key={p}
                    className={`btn cloud-btn cloud-move-pick${moveDest === p ? " cloud-btn--primary" : ""}`}
                    onClick={() => setMoveDest(p)}
                  >
                    {p}
                  </button>
                ))}
            </div>
            <div className="cloud-delete-actions">
              <button className="btn cloud-btn" onClick={() => setMoveTarget(null)}>
                cancel
              </button>
              <button
                className="btn cloud-btn cloud-btn--primary"
                onClick={() => void confirmMove()}
                disabled={moveLoading}
              >
                {moveLoading ? "moving..." : "move it"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="cloud-delete-overlay">
          <div className="cloud-delete-dialog">
            <div className="cloud-delete-title">
              delete <span style={{ color: "var(--accent)", fontWeight: 600 }}>{deleteTarget.name}</span>?
            </div>
            <div className="cloud-delete-desc">
              {deleteTarget.node.type === "directory"
                ? "this will delete everything inside. this is permanent. unlike your relationships."
                : "this is permanent. no ctrl+z in the cloud, buddy."}
            </div>
            <div className="cloud-delete-actions">
              <button className="btn cloud-btn" onClick={() => setDeleteTarget(null)}>
                nah keep it
              </button>
              <button className="btn cloud-btn cloud-btn--danger" onClick={() => void confirmDelete()}>
                delete it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Full-page lightbox (rendered via portal to document.body) ──

function CloudLightbox({
  name, url, type, size, onClose, onDownload,
}: {
  name: string;
  url: string;
  type: "image" | "video" | "audio";
  size?: number;
  onClose: () => void;
  onDownload: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="cloud-lb-overlay" onClick={onClose}>
      <div className="cloud-lb-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cloud-lb-header">
          <div className="cloud-lb-info">
            <span className="cloud-lb-name">{name}</span>
            {size != null && (
              <span className="cloud-lb-size">{formatBytes(size)}</span>
            )}
          </div>
          <div className="cloud-lb-actions">
            <button className="btn cloud-btn" onClick={onDownload}>
              download
            </button>
            <button className="btn cloud-btn" onClick={onClose}>
              close
            </button>
          </div>
        </div>

        {/* Media */}
        <div className="cloud-lb-body">
          {type === "image" && (
            <img src={url} alt={name} className="cloud-lb-img" />
          )}
          {type === "video" && (
            <video
              src={url}
              controls
              autoPlay
              controlsList="nodownload"
              className="cloud-lb-video"
            />
          )}
          {type === "audio" && (
            <div className="cloud-lb-audio-wrap">
              <div className="cloud-lb-audio-icon">&#127925;</div>
              <div className="cloud-lb-audio-name">{name}</div>
              <audio src={url} controls autoPlay className="cloud-lb-audio" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
