const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";

const TOKEN_KEY = "mynigga_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "Request failed");
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Auth ──

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "user" | "guest";
  created_at?: string;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

export async function login(username: string, password: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  try {
    const data = await request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    return { ok: true, user: data.user };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Authentication failed.";
    return { ok: false, error: message };
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const data = await request<{ user: AuthUser }>("/auth/session");
    return data.user;
  } catch {
    clearToken();
    return null;
  }
}

export function logout(): void {
  clearToken();
  // Fire and forget
  void request("/auth/logout", { method: "POST" }).catch(() => {});
}

// ── Sync: Filesystem ──

export interface FileSystemData {
  filesystem: Record<string, unknown>;
}

export async function loadFilesystem(): Promise<Record<string, unknown> | null> {
  try {
    const data = await request<FileSystemData>("/sync/filesystem");
    return data.filesystem;
  } catch {
    return null;
  }
}

export async function saveFilesystem(filesystem: Record<string, unknown>): Promise<boolean> {
  try {
    await request("/sync/filesystem", {
      method: "PUT",
      body: JSON.stringify({ filesystem }),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Sync: Settings ──

export interface SettingsData {
  theme_name: string;
  command_history: string[];
}

export async function loadSettings(): Promise<SettingsData | null> {
  try {
    return await request<SettingsData>("/sync/settings");
  } catch {
    return null;
  }
}

export async function saveSettings(settings: Partial<SettingsData>): Promise<boolean> {
  try {
    await request("/sync/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    return true;
  } catch {
    return false;
  }
}

export { getToken, clearToken };

// ── Admin: User Management ──

export interface AdminUser {
  id: number;
  username: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export async function getUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>("/admin/users");
  return data.users;
}

export async function createUser(
  username: string,
  password: string,
  role: string
): Promise<AdminUser> {
  const data = await request<{ user: AdminUser }>("/admin/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role }),
  });
  return data.user;
}

export async function updateUser(
  id: number,
  updates: { username?: string; password?: string; role?: string }
): Promise<AdminUser> {
  const data = await request<{ user: AdminUser }>(`/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  return data.user;
}

export async function deleteUser(id: number): Promise<void> {
  await request(`/admin/users/${id}`, { method: "DELETE" });
}

// ── Storage Stats ──

export interface StorageStats {
  used: number;
  limit: number;
  role: string;
}

export async function getStorageStats(): Promise<StorageStats> {
  return request<StorageStats>("/sync/stats");
}

// ── Invite Links ──

export interface InviteLink {
  id: string;
  role: string;
  expires_at: string;
  created_by_username: string;
  used_by_username: string | null;
  used_at: string | null;
  created_at: string;
}

export async function getInvites(): Promise<InviteLink[]> {
  const data = await request<{ invites: InviteLink[] }>("/admin/invites");
  return data.invites;
}

export async function createInvite(role?: string): Promise<{ id: string; url: string; role: string; expires_at: string }> {
  const data = await request<{ invite: { id: string; url: string; role: string; expires_at: string } }>("/admin/invites", {
    method: "POST",
    body: JSON.stringify({ role: role ?? "user" }),
  });
  return data.invite;
}

export async function deleteInvite(id: string): Promise<void> {
  await request(`/admin/invites/${id}`, { method: "DELETE" });
}

export async function createUserInvite(): Promise<{ id: string; url: string; role: string; expires_at: string }> {
  const data = await request<{ invite: { id: string; url: string; role: string; expires_at: string } }>("/auth/invite", {
    method: "POST",
  });
  return data.invite;
}

export async function registerWithInvite(
  token: string,
  username: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  try {
    const data = await request<{ token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ token, username, password }),
    });
    setToken(data.token);
    return { ok: true, user: data.user };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Registration failed.";
    return { ok: false, error: message };
  }
}

// ── Password Change ──

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await request("/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "password change failed";
    return { ok: false, error: message };
  }
}
