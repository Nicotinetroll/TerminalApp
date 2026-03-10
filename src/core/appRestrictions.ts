// Module-level store for app role restrictions.
// Synced from global_settings by a component inside GlobalSettingsProvider.
// Read by run.ts to enforce access before opening apps.

const ROLE_LEVEL: Record<string, number> = {
  guest: 0,
  code: 0,
  user: 1,
  club: 2,
  admin: 3,
};

let restrictions: Record<string, string> = {};
let accessDeniedHandler: ((app: string, requiredRole: string) => void) | null = null;

export function setAppRestrictions(r: Record<string, string>): void {
  restrictions = r;
}

export function getAppRestrictions(): Record<string, string> {
  return restrictions;
}

export function getAppMinRole(appName: string): string | null {
  return restrictions[appName] ?? null;
}

export function checkAppAccess(appName: string, userRole: string): boolean {
  const minRole = restrictions[appName];
  if (!minRole) return true;
  const userLevel = ROLE_LEVEL[userRole] ?? 0;
  const requiredLevel = ROLE_LEVEL[minRole] ?? 0;
  return userLevel >= requiredLevel;
}

export function getRoleLevel(role: string): number {
  return ROLE_LEVEL[role] ?? 0;
}

export function setAccessDeniedHandler(handler: ((app: string, requiredRole: string) => void) | null): void {
  accessDeniedHandler = handler;
}

export function triggerAccessDenied(app: string, requiredRole: string): void {
  accessDeniedHandler?.(app, requiredRole);
}
