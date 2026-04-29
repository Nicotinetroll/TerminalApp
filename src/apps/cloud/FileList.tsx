import { useRef, useEffect, useState, useCallback } from "react";
import type { FileSystemNode } from "@/types/terminal";
import { formatBytes, getFileIcon, getFileType, getActualSize } from "./helpers";
import { getToken } from "@/lib/api";

interface Props {
  node: FileSystemNode;
  onNavigate: (name: string) => void;
  onDownload: (name: string, child: FileSystemNode) => void;
  onDelete: (name: string, child: FileSystemNode) => void;
  onShare?: (name: string, child: FileSystemNode) => void;
  onPreview?: (name: string, child: FileSystemNode) => void;
  onRename?: (name: string, child: FileSystemNode) => void;
  onMove?: (name: string, child: FileSystemNode) => void;
  renameTarget?: string | null;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameConfirm?: () => void;
  onRenameCancel?: () => void;
}

function getMediaType(child: FileSystemNode): "image" | "video" | "audio" | null {
  if (!child.s3Key || !child.mimeType) return null;
  const prefix = child.mimeType.split("/")[0];
  if (prefix === "image") return "image";
  if (prefix === "video") return "video";
  if (prefix === "audio") return "audio";
  return null;
}

function getThumbnailUrl(child: FileSystemNode): string | null {
  if (!child.s3Key) return null;
  const token = getToken();
  return `/api/cloud/download/${encodeURIComponent(child.s3Key)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

function sortEntries(children: Record<string, FileSystemNode>): [string, FileSystemNode][] {
  return Object.entries(children).sort(([aName, aNode], [bName, bNode]) => {
    if (aNode.type !== bNode.type) return aNode.type === "directory" ? -1 : 1;
    return aName.localeCompare(bName);
  });
}

function getNodeSize(child: FileSystemNode): string {
  if (child.type === "directory") {
    return `${Object.keys(child.children ?? {}).length} items`;
  }
  // S3-backed files have a size field
  if (child.s3Key && child.size != null) {
    return formatBytes(child.size);
  }
  // Inline text files
  return formatBytes(getActualSize(child.content));
}

function getNodeType(name: string, child: FileSystemNode): string {
  if (child.type === "directory") return "folder";
  // S3-backed files have a mimeType field
  if (child.s3Key && child.mimeType) {
    const parts = child.mimeType.split("/");
    return parts[0] === "application" ? (parts[1] ?? "binary") : (parts[0] ?? "binary");
  }
  return getFileType(name, child.content);
}

function InlineRenameInput({
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      // Select name without extension
      const dot = value.lastIndexOf(".");
      ref.current.setSelectionRange(0, dot > 0 ? dot : value.length);
    }
  }, []);

  return (
    <input
      ref={ref}
      className="cloud-rename-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onConfirm();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={onCancel}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ActionsDropdown({
  name,
  child,
  isDir,
  isS3,
  isOpen,
  onToggle,
  onDownload,
  onShare,
  onRename,
  onMove,
  onDelete,
}: {
  name: string;
  child: FileSystemNode;
  isDir: boolean;
  isS3: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onDownload: (name: string, child: FileSystemNode) => void;
  onShare?: (name: string, child: FileSystemNode) => void;
  onRename?: (name: string, child: FileSystemNode) => void;
  onMove?: (name: string, child: FileSystemNode) => void;
  onDelete: (name: string, child: FileSystemNode) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isOpen, onToggle]);

  return (
    <div className="cloud-actions-wrap" ref={ref}>
      <button className="btn cloud-actions-trigger" onClick={onToggle}>⋯</button>
      {isOpen && (
        <div className="cloud-actions-menu">
          {!isDir && (
            <button className="cloud-actions-item" onClick={() => { onToggle(); onDownload(name, child); }}>download</button>
          )}
          {(isDir || isS3) && onShare && (
            <button className="cloud-actions-item" onClick={() => { onToggle(); onShare(name, child); }}>share</button>
          )}
          {onRename && (
            <button className="cloud-actions-item" onClick={() => { onToggle(); onRename(name, child); }}>rename</button>
          )}
          {onMove && (
            <button className="cloud-actions-item" onClick={() => { onToggle(); onMove(name, child); }}>move</button>
          )}
          <button className="cloud-actions-item cloud-actions-item--danger" onClick={() => { onToggle(); onDelete(name, child); }}>delete</button>
        </div>
      )}
    </div>
  );
}

export function FileList({
  node, onNavigate, onDownload, onDelete, onShare, onPreview,
  onRename, onMove, renameTarget, renameValue, onRenameChange, onRenameConfirm, onRenameCancel,
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const toggleMenu = useCallback((name: string) => {
    setOpenMenu(prev => prev === name ? null : name);
  }, []);

  // Close menu when rename starts
  useEffect(() => {
    if (renameTarget != null) setOpenMenu(null);
  }, [renameTarget]);

  if (!node.children || Object.keys(node.children).length === 0) {
    return (
      <div className="admin-empty">
        absolutely nothing. just like my dating life.
      </div>
    );
  }

  const entries = sortEntries(node.children);

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th style={{ width: "36px" }}></th>
          <th>name</th>
          <th style={{ width: "90px" }}>size</th>
          <th style={{ width: "90px" }}>type</th>
          <th style={{ width: "48px" }}></th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, child]) => {
          const isDir = child.type === "directory";
          const isS3 = !!child.s3Key;
          const icon = isDir ? "\u{1F4C1}" : getFileIcon(name, child.content);
          const size = getNodeSize(child);
          const type = getNodeType(name, child);
          const media = getMediaType(child);
          const thumbUrl = media === "image" ? getThumbnailUrl(child) : null;
          const canPreview = media === "image" || media === "video" || media === "audio";
          const isBeingRenamed = renameTarget === name;

          return (
            <tr key={name}>
              <td style={{ textAlign: "center", fontSize: "16px" }}>
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt=""
                    className="cloud-thumb"
                    loading="lazy"
                    onClick={() => onPreview?.(name, child)}
                  />
                ) : icon}
              </td>
              <td>
                {isBeingRenamed && onRenameChange && onRenameConfirm && onRenameCancel ? (
                  <InlineRenameInput
                    value={renameValue ?? name}
                    onChange={onRenameChange}
                    onConfirm={onRenameConfirm}
                    onCancel={onRenameCancel}
                  />
                ) : isDir ? (
                  <span
                    style={{
                      color: "var(--accent)",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                    onClick={() => onNavigate(name)}
                  >
                    {name}/
                  </span>
                ) : canPreview && onPreview ? (
                  <span
                    className="cloud-file-previewable"
                    onClick={() => onPreview(name, child)}
                  >
                    {name}
                    {isS3 && (
                      <span style={{ color: "var(--text-ghost)", fontSize: "10px", marginLeft: "6px" }} title="stored in S3">
                        S3
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-primary)" }}>
                    {name}
                    {isS3 && (
                      <span style={{ color: "var(--text-ghost)", fontSize: "10px", marginLeft: "6px" }} title="stored in S3">
                        S3
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>{size}</td>
              <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>{type}</td>
              <td>
                <ActionsDropdown
                  name={name}
                  child={child}
                  isDir={isDir}
                  isS3={isS3}
                  isOpen={openMenu === name}
                  onToggle={() => toggleMenu(name)}
                  onDownload={onDownload}
                  onShare={onShare}
                  onRename={onRename}
                  onMove={onMove}
                  onDelete={onDelete}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
