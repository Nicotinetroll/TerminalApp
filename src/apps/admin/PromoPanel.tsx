import { useState, useEffect, useCallback } from "react";
import { getPromos, createPromo, deletePromo, ApiError } from "@/lib/api";
import type { PromoCode } from "@/lib/api";

export function PromoPanel() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);

  // Form state
  const [code, setCode] = useState("");
  const [type, setType] = useState<"discount_pct" | "free_sub">("discount_pct");
  const [value, setValue] = useState("");
  const [subTier, setSubTier] = useState<"" | "basic" | "premium">("");
  const [maxUses, setMaxUses] = useState("");
  const [expiryHours, setExpiryHours] = useState("");

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadPromos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPromos();
      setPromos(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "shit broke";
      showStatus(`failed: ${msg}`, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadPromos();
  }, [loadPromos]);

  const handleCreate = useCallback(async () => {
    if (!code.trim() || !value.trim()) {
      showStatus("code and value are required.", true);
      return;
    }
    setCreating(true);
    try {
      const promo = await createPromo({
        code: code.trim(),
        type,
        value: parseFloat(value),
        sub_tier: subTier || undefined,
        max_uses: maxUses ? parseInt(maxUses, 10) : undefined,
        expires_in_hours: expiryHours ? parseInt(expiryHours, 10) : undefined,
      });
      showStatus(`promo "${promo.code}" created`);
      setCode("");
      setValue("");
      setMaxUses("");
      setExpiryHours("");
      await loadPromos();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "unknown error";
      showStatus(`failed: ${msg}`, true);
    } finally {
      setCreating(false);
    }
  }, [code, type, value, subTier, maxUses, expiryHours, loadPromos, showStatus]);

  const handleDelete = useCallback(async (promoCode: string) => {
    try {
      await deletePromo(promoCode);
      showStatus(`"${promoCode}" deactivated`);
      await loadPromos();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "unknown error";
      showStatus(`failed: ${msg}`, true);
    }
  }, [loadPromos, showStatus]);

  const getStatus = (p: PromoCode): "active" | "expired" | "maxed" | "disabled" => {
    if (!p.active) return "disabled";
    if (p.expires_at && new Date(p.expires_at + "Z") < new Date()) return "expired";
    if (p.max_uses > 0 && p.use_count >= p.max_uses) return "maxed";
    return "active";
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d + "Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading promos...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Create form */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="admin-input"
          placeholder="CODE"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          style={{ width: "100px", fontSize: "12px", padding: "4px 6px", textTransform: "uppercase" }}
        />
        <select
          className="admin-input"
          value={type}
          onChange={e => setType(e.target.value as "discount_pct" | "free_sub")}
          style={{ fontSize: "12px", padding: "4px 6px" }}
        >
          <option value="discount_pct">discount %</option>
          <option value="free_sub">free sub</option>
        </select>
        <input
          className="admin-input"
          placeholder={type === "discount_pct" ? "%" : "days"}
          value={value}
          onChange={e => setValue(e.target.value)}
          type="number"
          min={1}
          style={{ width: "60px", fontSize: "12px", padding: "4px 6px" }}
        />
        <select
          className="admin-input"
          value={subTier}
          onChange={e => setSubTier(e.target.value as "" | "basic" | "premium")}
          style={{ fontSize: "12px", padding: "4px 6px" }}
        >
          <option value="">any tier</option>
          <option value="basic">basic</option>
          <option value="premium">premium</option>
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>max:</label>
          <input
            className="admin-input"
            placeholder="0"
            value={maxUses}
            onChange={e => setMaxUses(e.target.value)}
            type="number"
            min={0}
            style={{ width: "48px", fontSize: "12px", padding: "4px 6px", textAlign: "center" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>exp h:</label>
          <input
            className="admin-input"
            placeholder="—"
            value={expiryHours}
            onChange={e => setExpiryHours(e.target.value)}
            type="number"
            min={0}
            style={{ width: "48px", fontSize: "12px", padding: "4px 6px", textAlign: "center" }}
          />
        </div>
        <button
          className="btn btn-primary"
          disabled={creating}
          onClick={() => void handleCreate()}
        >
          {creating ? "creating..." : "+ create"}
        </button>
        {status && (
          <span className={`admin-status${status.isError ? " error" : ""}`}>
            {status.text}
          </span>
        )}
      </div>

      {/* Table */}
      {promos.length === 0 ? (
        <div className="admin-empty">no promo codes yet. make one and watch the peasants rejoice.</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>code</th>
                <th>type</th>
                <th>value</th>
                <th>tier</th>
                <th>uses</th>
                <th>status</th>
                <th>expires</th>
                <th style={{ textAlign: "right" }}>actions</th>
              </tr>
            </thead>
            <tbody>
              {promos.map(p => {
                const s = getStatus(p);
                return (
                  <tr key={p.code}>
                    <td style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: 600, color: "var(--accent)" }}>
                      {p.code}
                    </td>
                    <td style={{ fontSize: "11px" }}>
                      {p.type === "discount_pct" ? "discount" : "free sub"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>
                      {p.type === "discount_pct" ? `${p.value}%` : `${p.value}d`}
                    </td>
                    <td style={{ fontSize: "11px", color: p.sub_tier ? "var(--accent)" : "var(--text-ghost)" }}>
                      {p.sub_tier ?? "any"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>
                      <span style={{ color: p.use_count > 0 ? "var(--accent)" : "var(--text-muted)" }}>
                        {p.use_count}
                      </span>
                      <span style={{ color: "var(--text-ghost)" }}>/</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {p.max_uses || "\u221E"}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "3px",
                        fontWeight: 500,
                        background: s === "active" ? "rgba(74, 222, 128, 0.1)"
                          : s === "expired" ? "rgba(248, 113, 113, 0.1)"
                          : s === "maxed" ? "rgba(255, 255, 255, 0.05)"
                          : "rgba(248, 113, 113, 0.1)",
                        color: s === "active" ? "#4ade80"
                          : s === "expired" ? "#f87171"
                          : s === "maxed" ? "var(--text-muted)"
                          : "#f87171",
                      }}>
                        {s}
                      </span>
                    </td>
                    <td style={{ fontSize: "11px" }}>{formatDate(p.expires_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      {s === "active" && (
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: "12px", padding: "3px 8px" }}
                          onClick={() => void handleDelete(p.code)}
                        >
                          kill
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
