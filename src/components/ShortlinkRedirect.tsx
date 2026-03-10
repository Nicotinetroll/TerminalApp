import { useState, useEffect } from "react";
import { resolveShortlink } from "@/lib/api";

interface Props {
  slug: string;
  onClose: () => void;
}

export function ShortlinkRedirect({ slug, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    resolveShortlink(slug)
      .then((data) => {
        if (!cancelled) {
          window.location.replace(data.target_url);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "link not found");
        }
      });

    return () => { cancelled = true; };
  }, [slug]);

  if (error) {
    return (
      <div style={{
        background: "#0a0a12",
        color: "#e8ecf4",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Mono', monospace",
        padding: "2rem",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>💀</div>
        <h1 style={{ color: "#DA7756", fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          link is dead
        </h1>
        <p style={{ color: "#9aa4b8", marginBottom: "2rem", maxWidth: "400px" }}>
          {error}
        </p>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#DA7756",
            padding: "0.5rem 1.5rem",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "0.875rem",
          }}
        >
          go to mynig.ga
        </button>
        <p style={{ color: "#354055", fontSize: "0.75rem", marginTop: "3rem" }}>
          mynig.ga/s/{slug}
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: "#0a0a12",
      color: "#9aa4b8",
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      redirecting...
    </div>
  );
}
