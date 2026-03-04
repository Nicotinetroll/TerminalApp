import { useState } from "react";
import type { EmailAddress } from "@/lib/api";
import { updateSignature, ApiError } from "@/lib/api";

interface Props {
  addresses: EmailAddress[];
  onUpdated: (id: number, signature: string) => void;
  onClose: () => void;
  showStatus: (text: string, isError?: boolean) => void;
}

export function SignatureEditor({ addresses, onUpdated, onClose, showStatus }: Props) {
  const [selectedId, setSelectedId] = useState(addresses[0]?.id ?? 0);
  const selectedAddr = addresses.find(a => a.id === selectedId) ?? addresses[0];
  const [signature, setSignature] = useState(selectedAddr?.signature ?? "");
  const [saving, setSaving] = useState(false);

  const handleAddrChange = (id: number) => {
    setSelectedId(id);
    const addr = addresses.find(a => a.id === id);
    setSignature(addr?.signature ?? "");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSignature(selectedId, signature);
      onUpdated(selectedId, signature);
      showStatus("signature saved");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't save signature", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mail-signature-editor">
      <div className="mail-signature-header">
        <h3>signatures</h3>
        <button className="admin-btn" onClick={onClose}>close</button>
      </div>

      {addresses.length > 1 && (
        <div className="mail-signature-select">
          {addresses.map(a => (
            <button
              key={a.id}
              className={`mail-signature-tab${a.id === selectedId ? " active" : ""}`}
              onClick={() => handleAddrChange(a.id)}
            >
              {a.full}
            </button>
          ))}
        </div>
      )}

      <textarea
        className="mail-signature-textarea"
        value={signature}
        onChange={e => setSignature(e.target.value)}
        placeholder="your signature goes here... get creative"
        disabled={saving}
        rows={6}
      />

      <div className="mail-signature-actions">
        <span className="mail-signature-hint">
          appended to new emails from {selectedAddr?.full}
        </span>
        <button
          className="admin-btn admin-btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "saving..." : "save"}
        </button>
      </div>
    </div>
  );
}
