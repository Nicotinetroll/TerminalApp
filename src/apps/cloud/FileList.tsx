import type { FileSystemNode } from "@/types/terminal";
import { formatBytes, getFileIcon, getFileType, getActualSize } from "./helpers";

interface Props {
  node: FileSystemNode;
  onNavigate: (name: string) => void;
  onDownload: (name: string, child: FileSystemNode) => void;
  onDelete: (name: string, child: FileSystemNode) => void;
}

function sortEntries(children: Record<string, FileSystemNode>): [string, FileSystemNode][] {
  return Object.entries(children).sort(([aName, aNode], [bName, bNode]) => {
    if (aNode.type !== bNode.type) return aNode.type === "directory" ? -1 : 1;
    return aName.localeCompare(bName);
  });
}

export function FileList({ node, onNavigate, onDownload, onDelete }: Props) {
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
          <th style={{ width: "120px" }}>actions</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, child]) => {
          const isDir = child.type === "directory";
          const icon = isDir ? "\u{1F4C1}" : getFileIcon(name, child.content);
          const size = isDir
            ? `${Object.keys(child.children ?? {}).length} items`
            : formatBytes(getActualSize(child.content));
          const type = isDir ? "folder" : getFileType(name, child.content);

          return (
            <tr key={name}>
              <td style={{ textAlign: "center", fontSize: "16px" }}>{icon}</td>
              <td>
                {isDir ? (
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
                ) : (
                  <span style={{ color: "var(--text-primary)" }}>{name}</span>
                )}
              </td>
              <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>{size}</td>
              <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>{type}</td>
              <td>
                <div style={{ display: "flex", gap: "4px" }}>
                  {!isDir && (
                    <button
                      className="btn"
                      style={{ padding: "2px 8px", fontSize: "12px" }}
                      onClick={() => onDownload(name, child)}
                      title="download"
                    >
                      dl
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    style={{ padding: "2px 8px", fontSize: "12px" }}
                    onClick={() => onDelete(name, child)}
                    title="delete"
                  >
                    rm
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
