import db from './db.js';

interface AuditParams {
  adminId: number;
  adminUsername: string; // legacy column name — now stores email
  action: string;
  targetType?: string;
  targetId?: number;
  targetName?: string;
  details?: Record<string, unknown>;
}

const stmt = db.prepare(`
  INSERT INTO audit_log (admin_id, admin_username, action, target_type, target_id, target_name, details)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function logAudit(params: AuditParams): void {
  try {
    stmt.run(
      params.adminId,
      params.adminUsername,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.targetName ?? null,
      JSON.stringify(params.details ?? {}),
    );
  } catch {
    // fire and forget — never break the main flow
  }
}
