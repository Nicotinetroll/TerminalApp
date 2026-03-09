import { useState } from "react";
import type { EmailAddress } from "@/lib/api";
import { claimEmailAddress, ApiError } from "@/lib/api";

interface Props {
  onClaimed: (addr: EmailAddress) => void;
  showStatus: (text: string, isError?: boolean) => void;
  status: { text: string; isError: boolean } | null;
}

export function AddressSetup({ onClaimed, showStatus, status }: Props) {
  const [input, setInput] = useState("");
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async () => {
    const clean = input.toLowerCase().trim();
    if (!clean) return;

    setClaiming(true);
    try {
      const addr = await claimEmailAddress(clean);
      onClaimed(addr);
      setInput("");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't claim address";
      showStatus(msg, true);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="mail-setup">
      <div className="mail-setup-icon">@</div>
      <h2 className="mail-setup-title">claim your email</h2>
      <p className="mail-setup-desc">
        pick a name and get your own @mynig.ga address.
        <br />
        2-32 chars, lowercase, numbers, dots, dashes.
      </p>

      {status && (
        <div className={`mail-status-inline${status.isError ? " error" : ""}`}>
          {status.text}
        </div>
      )}

      <div className="mail-setup-form">
        <div className="mail-setup-input-wrap">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter") void handleClaim(); }}
            placeholder="yourname"
            maxLength={32}
            disabled={claiming}
            autoFocus
          />
          <span className="mail-setup-domain">@mynig.ga</span>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void handleClaim()}
          disabled={claiming || input.length < 2}
        >
          {claiming ? "claiming..." : "claim it"}
        </button>
      </div>

      <p className="mail-setup-hint">
        you can have up to 3 addresses. choose wisely... or don't. it's your email.
      </p>
    </div>
  );
}
