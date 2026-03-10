import { useState, useEffect, useCallback } from "react";
import { setAccessDeniedHandler } from "@/core/appRestrictions";

interface ToastData {
  app: string;
  role: string;
  id: number;
}

const ROLE_LABELS: Record<string, string> = {
  club: "Club",
  admin: "Admin",
  user: "Member",
};

let toastIdCounter = 0;

interface Props {
  onJoinClub: () => void;
}

export function AccessDeniedToast({ onJoinClub }: Props) {
  const [toast, setToast] = useState<ToastData | null>(null);

  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    setAccessDeniedHandler((app, role) => {
      setToast({ app, role, id: ++toastIdCounter });
      setTimeout(() => {
        setToast((cur) => (cur?.id === toastIdCounter ? null : cur));
      }, 8000);
    });
    return () => setAccessDeniedHandler(null);
  }, []);

  if (!toast) return null;

  const roleLabel = ROLE_LABELS[toast.role] ?? toast.role;

  return (
    <div className="access-toast-container">
      <div className="access-toast" key={toast.id}>
        <div className="access-toast-content">
          <div className="access-toast-title">
            access denied
          </div>
          <div className="access-toast-msg">
            <strong>{toast.app}</strong> requires <span className="access-toast-role">{roleLabel}</span> membership
          </div>
        </div>
        <div className="access-toast-actions">
          {toast.role === "club" && (
            <button
              className="btn btn-sm access-toast-cta"
              onClick={() => { onJoinClub(); dismiss(); }}
            >
              Join Club Now
            </button>
          )}
          <button
            className="btn btn-sm"
            onClick={dismiss}
          >
            dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
