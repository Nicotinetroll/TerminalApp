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

// ── Mail ──

export interface EmailAddress {
  id: number;
  address: string;
  full: string;
  display_name: string;
  signature: string;
  created_at: string;
}

export interface EmailAttachment {
  id: number;
  filename: string;
  mime_type: string;
  size: number;
}

export interface EmailMessage {
  id: number;
  folder: string;
  from_address: string;
  to_address: string;
  subject: string;
  body?: string;
  is_read: boolean;
  is_starred: boolean;
  message_id: string | null;
  in_reply_to: string | null;
  thread_id: string | null;
  created_at: string;
  attachment_count?: number;
  attachments?: EmailAttachment[];
}

export interface EmailStats {
  stats: Record<string, { total: number; unread: number }>;
}

export async function getEmailAddresses(): Promise<EmailAddress[]> {
  const data = await request<{ addresses: EmailAddress[] }>("/mail/addresses");
  return data.addresses;
}

export async function claimEmailAddress(address: string): Promise<EmailAddress> {
  const data = await request<{ address: EmailAddress }>("/mail/addresses", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
  return data.address;
}

export async function deleteEmailAddress(id: number): Promise<void> {
  await request(`/mail/addresses/${id}`, { method: "DELETE" });
}

export async function getEmails(
  folder = "inbox",
  limit = 50,
  offset = 0,
  search = "",
  starred = false
): Promise<EmailMessage[]> {
  let path = `/mail/messages?folder=${folder}&limit=${limit}&offset=${offset}`;
  if (search) path += `&search=${encodeURIComponent(search)}`;
  if (starred) path += `&starred=true`;
  const data = await request<{ messages: EmailMessage[] }>(path);
  return data.messages;
}

export async function getEmail(id: number): Promise<EmailMessage> {
  const data = await request<{ message: EmailMessage }>(`/mail/messages/${id}`);
  return data.message;
}

export async function updateEmail(
  id: number,
  updates: { is_read?: boolean; folder?: string; is_starred?: boolean }
): Promise<void> {
  await request(`/mail/messages/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteEmail(id: number): Promise<void> {
  await request(`/mail/messages/${id}`, { method: "DELETE" });
}

export async function bulkEmailAction(
  ids: number[],
  action: string
): Promise<{ ok: boolean; affected: number }> {
  return request("/mail/messages/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, action }),
  });
}

export async function saveDraft(data: {
  to?: string;
  subject?: string;
  body?: string;
  from_address?: string;
  id?: number;
}): Promise<{ ok: boolean; id?: number }> {
  if (data.id) {
    return request(`/mail/drafts/${data.id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }
  return request("/mail/drafts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function sendEmail(data: {
  to: string;
  subject: string;
  body: string;
  from_address?: string;
  from_name?: string;
  in_reply_to?: string;
  attachments?: File[];
}): Promise<{ ok: boolean; messageId?: string; easter_egg?: string }> {
  // Use FormData when there are attachments
  if (data.attachments && data.attachments.length > 0) {
    const formData = new FormData();
    formData.append("to", data.to);
    formData.append("subject", data.subject);
    formData.append("body", data.body);
    if (data.from_address) formData.append("from_address", data.from_address);
    if (data.from_name) formData.append("from_name", data.from_name);
    if (data.in_reply_to) formData.append("in_reply_to", data.in_reply_to);
    for (const file of data.attachments) {
      formData.append("attachments", file);
    }

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/mail/send`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (body as { error?: string }).error ?? "Send failed");
    }

    return res.json() as Promise<{ ok: boolean; messageId?: string; easter_egg?: string }>;
  }

  // Regular JSON send (no attachments)
  return request("/mail/send", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function downloadAttachment(attachmentId: number, filename: string): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/mail/attachments/${attachmentId}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "download failed");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function getThread(threadId: string): Promise<EmailMessage[]> {
  const data = await request<{ messages: EmailMessage[] }>(`/mail/thread/${encodeURIComponent(threadId)}`);
  return data.messages;
}

export async function getEmailStats(): Promise<EmailStats> {
  return request<EmailStats>("/mail/stats");
}

// ── Admin: Mail Spy ──

export interface AdminEmailAddress {
  id: number;
  address: string;
  full: string;
  user_id: number;
  username: string;
  email_count: number;
  created_at: string;
}

export interface AdminEmail {
  id: number;
  owner_id: number;
  address_id: number | null;
  folder: string;
  from_address: string;
  to_address: string;
  subject: string;
  body?: string;
  is_read: boolean;
  message_id?: string | null;
  in_reply_to?: string | null;
  created_at: string;
  username: string;
}

export async function getAdminEmailAddresses(): Promise<AdminEmailAddress[]> {
  const data = await request<{ addresses: AdminEmailAddress[] }>("/mail/admin/addresses");
  return data.addresses;
}

export async function deleteAdminEmailAddress(id: number): Promise<void> {
  await request(`/mail/admin/addresses/${id}`, { method: "DELETE" });
}

export async function getAdminEmails(userId?: number, limit = 50, offset = 0): Promise<AdminEmail[]> {
  let path = `/mail/admin/emails?limit=${limit}&offset=${offset}`;
  if (userId !== undefined) path += `&user_id=${userId}`;
  const data = await request<{ emails: AdminEmail[] }>(path);
  return data.emails;
}

export async function getAdminEmail(id: number): Promise<AdminEmail> {
  const data = await request<{ email: AdminEmail }>(`/mail/admin/emails/${id}`);
  return data.email;
}

export async function deleteAdminEmail(id: number): Promise<void> {
  await request(`/mail/admin/emails/${id}`, { method: "DELETE" });
}

// ── Global Settings ──

export async function getGlobalSettings(): Promise<Record<string, string>> {
  const data = await request<{ settings: Record<string, string> }>("/settings");
  return data.settings;
}

export async function updateGlobalSettings(
  settings: Record<string, string>
): Promise<Record<string, string>> {
  const data = await request<{ settings: Record<string, string> }>("/settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
  return data.settings;
}

// ── Contacts ──

export interface Contact {
  id: number;
  name: string;
  address: string;
  created_at: string;
}

export interface ContactSuggestion {
  id: number;
  name: string;
  address: string;
}

export async function getContacts(): Promise<Contact[]> {
  const data = await request<{ contacts: Contact[] }>("/mail/contacts");
  return data.contacts;
}

export async function suggestContacts(q: string): Promise<ContactSuggestion[]> {
  const data = await request<{ suggestions: ContactSuggestion[] }>(
    `/mail/contacts/suggest?q=${encodeURIComponent(q)}`
  );
  return data.suggestions;
}

export async function createContact(name: string, address: string): Promise<Contact> {
  const data = await request<{ contact: Contact }>("/mail/contacts", {
    method: "POST",
    body: JSON.stringify({ name, address }),
  });
  return data.contact;
}

export async function deleteContact(id: number): Promise<void> {
  await request(`/mail/contacts/${id}`, { method: "DELETE" });
}

// ── Custom Folders ──

export interface MailFolder {
  id: number;
  name: string;
  created_at?: string;
}

export async function getCustomFolders(): Promise<MailFolder[]> {
  const data = await request<{ folders: MailFolder[] }>("/mail/folders");
  return data.folders;
}

export async function createFolder(name: string): Promise<MailFolder> {
  const data = await request<{ folder: MailFolder }>("/mail/folders", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.folder;
}

export async function deleteFolder(id: number): Promise<void> {
  await request(`/mail/folders/${id}`, { method: "DELETE" });
}

// ── Signatures ──

export async function updateSignature(addressId: number, signature: string): Promise<void> {
  await request(`/mail/addresses/${addressId}/signature`, {
    method: "PUT",
    body: JSON.stringify({ signature }),
  });
}

// ── Games ──

export interface GameScore {
  username: string;
  score: number;
  metadata?: string;
  created_at: string;
}

export interface GameScoreSubmitResult {
  ok: boolean;
  id: number;
  rank: number;
  message?: string;
  easter_egg?: string;
}

export interface MyGameScore {
  game: string;
  best_score: number;
  total_games: number;
  last_played: string;
}

export async function getLeaderboard(game: string, limit = 10): Promise<GameScore[]> {
  const data = await request<{ scores: GameScore[] }>(
    `/games/leaderboard?game=${encodeURIComponent(game)}&limit=${limit}`
  );
  return data.scores;
}

export async function getAllLeaderboards(): Promise<Record<string, GameScore[]>> {
  const data = await request<{ leaderboards: Record<string, GameScore[]> }>("/games/leaderboard/all");
  return data.leaderboards;
}

export async function submitScore(
  game: string,
  score: number,
  metadata?: Record<string, unknown>
): Promise<GameScoreSubmitResult> {
  return request<GameScoreSubmitResult>("/games/scores", {
    method: "POST",
    body: JSON.stringify({ game, score, metadata }),
  });
}

export async function getMyScores(): Promise<MyGameScore[]> {
  const data = await request<{ scores: MyGameScore[] }>("/games/my-scores");
  return data.scores;
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
