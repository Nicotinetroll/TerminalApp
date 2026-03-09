import { useState } from "react";
import { changePassword } from "@/lib/api";

interface Props {
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export function PasswordForm({ onSuccess, onError }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const passwordsMatch = newPassword === confirmPassword;
  const longEnough = newPassword.length >= 4;
  const canSubmit =
    currentPassword.length > 0 &&
    longEnough &&
    passwordsMatch &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    const result = await changePassword(currentPassword, newPassword);
    setSubmitting(false);

    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess();
    } else {
      onError(result.error ?? "something broke. idk man.");
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 400 }}>
      <div className="admin-form-group">
        <label>current password</label>
        <input
          type="password"
          className="admin-input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="prove you're you"
          autoFocus
        />
      </div>

      <div className="admin-form-group">
        <label>new password</label>
        <input
          type="password"
          className="admin-input"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="minimum 4 characters (we have low standards)"
        />
        {newPassword.length > 0 && !longEnough && (
          <span style={{ color: "var(--error, #ff4444)", fontSize: "12px", marginTop: "4px" }}>
            at least 4 characters. come on.
          </span>
        )}
      </div>

      <div className="admin-form-group">
        <label>confirm new password</label>
        <input
          type="password"
          className="admin-input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="type it again, just to be sure"
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <span style={{ color: "var(--error, #ff4444)", fontSize: "12px", marginTop: "4px" }}>
            passwords don't match. you had ONE job.
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit}
        >
          {submitting ? "changing..." : "change password"}
        </button>
      </div>
    </form>
  );
}
