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
  email: string;
  role: "admin" | "premium" | "basic" | "user";
  created_at?: string;
  permissions?: string[];
  has_subscription?: boolean;
  theme_name?: string | null;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  try {
    const data = await request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    return { ok: true, user: data.user };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Authentication failed.";
    return { ok: false, error: message };
  }
}

export async function register(email: string, invite?: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  try {
    const data = await request<LoginResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, ...(invite ? { invite } : {}) }),
    });
    setToken(data.token);
    return { ok: true, user: data.user };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Registration failed.";
    return { ok: false, error: message };
  }
}

export async function checkEmail(localPart: string): Promise<{ available: boolean; error?: string }> {
  try {
    return await request<{ available: boolean; error?: string }>(`/auth/check-email/${encodeURIComponent(localPart)}`);
  } catch (err) {
    return { available: false, error: err instanceof ApiError ? err.message : "check failed" };
  }
}

export async function setupPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await request<{ ok: boolean }>("/auth/setup-password", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "failed to set password" };
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const data = await request<{ user: AuthUser & { token?: string } }>("/auth/session");
    // Auto-refresh token if role changed
    if (data.user.token) {
      setToken(data.user.token);
    }
    return data.user;
  } catch {
    clearToken();
    return null;
  }
}

export function logout(): void {
  // Send request first so it has the auth header, then clear token
  void request("/auth/logout", { method: "POST" }).catch(() => {});
  clearToken();
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

export interface WindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SettingsData {
  theme_name: string;
  command_history: string[];
  auto_open_apps?: string[];
  window_layouts?: Record<string, WindowLayout>;
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
  email: string;
  username?: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export async function getUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>("/admin/users");
  return data.users;
}

export async function createUser(
  email: string,
  password: string,
  role: string
): Promise<AdminUser> {
  const data = await request<{ user: AdminUser }>("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, role }),
  });
  return data.user;
}

export async function updateUser(
  id: number,
  updates: { email?: string; password?: string; role?: string }
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

// ── Admin User Details ──

export interface AdminUserDetails {
  user: AdminUser;
  niggabytes: number;
  active_subscription: {
    id: number; type: string; starts_at: string; expires_at: string | null;
    is_active: number; auto_renew: number; payment_id: string | null;
  } | null;
  subscription_history: {
    id: number; type: string; starts_at: string; expires_at: string | null;
    is_active: number; auto_renew: number;
  }[];
  payments: {
    id: string; type: string; amount_eur: number; nb_amount: number;
    status: string; created_at: string;
  }[];
  storage_bytes: number;
  email_addresses: string[];
}

export async function getAdminUserDetails(id: number): Promise<AdminUserDetails> {
  return request<AdminUserDetails>(`/admin/users/${id}/details`);
}

export async function adminManageSubscription(
  userId: number,
  action: string,
  type?: string,
  days?: number,
): Promise<{ ok: boolean; message: string }> {
  return request(`/admin/users/${userId}/subscription`, {
    method: "PUT",
    body: JSON.stringify({ action, type, days }),
  });
}

export async function adminSetNiggabytes(
  userId: number,
  amount: number,
): Promise<{ ok: boolean; message: string }> {
  return request(`/admin/users/${userId}/niggabytes`, {
    method: "PUT",
    body: JSON.stringify({ amount }),
  });
}

// ── Audit Log ──

export interface AuditEntry {
  id: number;
  admin_username: string;
  action: string;
  target_type: string | null;
  target_id: number | null;
  target_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export async function getAuditLog(
  limit = 50,
  offset = 0,
  action = ""
): Promise<{ entries: AuditEntry[]; total: number }> {
  let path = `/admin/audit-log?limit=${limit}&offset=${offset}`;
  if (action) path += `&action=${encodeURIComponent(action)}`;
  return request(path);
}

// ── Storage Stats ──

export interface StorageStats {
  used: number;
  limit: number;
  role: string;
  niggabytes: number;
}

export async function getStorageStats(): Promise<StorageStats> {
  return request<StorageStats>("/sync/stats");
}

// ── Invite Links ──

export interface InviteLink {
  id: string;
  role: string;
  expires_at: string;
  created_by_email: string;
  used_by_email: string | null;
  used_at: string | null;
  created_at: string;
  max_uses: number;
  use_count: number;
  subscription_type?: string | null;
  subscription_days?: number | null;
}

export async function getInvites(): Promise<InviteLink[]> {
  const data = await request<{ invites: InviteLink[] }>("/admin/invites");
  return data.invites;
}

export async function createInvite(
  role?: string,
  maxUses?: number,
  subscriptionType?: string,
  subscriptionDays?: number,
): Promise<{ id: string; url: string; role: string; expires_at: string }> {
  const data = await request<{ invite: { id: string; url: string; role: string; expires_at: string } }>("/admin/invites", {
    method: "POST",
    body: JSON.stringify({
      role: role ?? "user",
      max_uses: maxUses ?? 1,
      subscription_type: subscriptionType,
      subscription_days: subscriptionDays,
    }),
  });
  return data.invite;
}

export async function deleteInvite(id: string): Promise<void> {
  await request(`/admin/invites/${id}`, { method: "DELETE" });
}

export async function createUserInvite(maxUses?: number): Promise<{ id: string; url: string; role: string; expires_at: string }> {
  const data = await request<{ invite: { id: string; url: string; role: string; expires_at: string } }>("/auth/invite", {
    method: "POST",
    body: JSON.stringify({ max_uses: maxUses ?? 1 }),
  });
  return data.invite;
}

// registerWithInvite removed — open registration now

// ── Password Change ──

// ── Mail ──

export interface EmailAddress {
  id: number;
  address: string;
  full: string;
  display_name: string;
  signature: string;
  created_at: string;
  has_mail_password: boolean;
  mail_password_plain?: string;
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
  body_html?: string | null;
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

export async function setMailPassword(id: number, password?: string): Promise<string> {
  const data = await request<{ mail_password_plain: string }>(`/mail/addresses/${id}/set-password`, {
    method: "POST",
    body: JSON.stringify({ password: password || undefined }),
  });
  return data.mail_password_plain;
}

export async function getEmails(
  folder = "inbox",
  limit = 50,
  offset = 0,
  search = "",
  starred = false,
  addressId?: number | null
): Promise<EmailMessage[]> {
  let path = `/mail/messages?folder=${folder}&limit=${limit}&offset=${offset}`;
  if (search) path += `&search=${encodeURIComponent(search)}`;
  if (starred) path += `&starred=true`;
  if (addressId) path += `&address_id=${addressId}`;
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

export async function getEmailStats(addressId?: number | null): Promise<EmailStats> {
  const path = addressId ? `/mail/stats?address_id=${addressId}` : "/mail/stats";
  return request<EmailStats>(path);
}

// ── Admin: Mail Review ──

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

// ── Admin: Server Stats ──

export interface ServerStats {
  server: {
    uptime_seconds: number;
    uptime_human: string;
    memory_rss_mb: number;
    memory_heap_used_mb: number;
    memory_heap_total_mb: number;
    node_version: string;
    platform: string;
    pid: number;
  };
  users: {
    total: number;
    by_role: Record<string, number>;
    recent: { email: string; role: string; created_at: string }[];
  };
  storage: {
    total_bytes: number;
    total_human: string;
    top_users: { email: string; bytes: number; human: string }[];
  };
  s3: {
    cloud_bytes: number;
    cloud_human: string;
    transfers_bytes: number;
    transfers_human: string;
    mail_att_bytes: number;
    mail_att_human: string;
    total_bytes: number;
    total_human: string;
  };
  ai: {
    total_tokens: number;
    total_requests: number;
    today_tokens: number;
    today_requests: number;
    top_users: { email: string; tokens: number; requests: number }[];
  };
  mail: {
    total_addresses: number;
    total_emails: number;
    emails_today: number;
  };
  imap: {
    total_events: number;
    logins: number;
    login_fails: number;
    errors: number;
  };
  health: "ok" | "degraded";
  timestamp: string;
}

export async function getServerStats(): Promise<ServerStats> {
  return request<ServerStats>("/admin/stats");
}

// ── VPS Disk Stats ──

export interface VpsDiskCurrent {
  used_bytes: number;
  total_bytes: number;
  free_bytes: number;
  used_pct: number;
  used_human: string;
  total_human: string;
  free_human: string;
}

export interface VpsDiskPoint {
  used: number;
  total: number;
  ts: string;
}

export interface VpsStats {
  current: VpsDiskCurrent | null;
  history: VpsDiskPoint[];
  range: string;
}

export async function getVpsStats(range: "24h" | "7d" | "30d" = "24h"): Promise<VpsStats> {
  return request<VpsStats>(`/admin/vps-stats?range=${range}`);
}

// ── Admin: Server Logs ──

export interface LogEntry {
  id: number;
  ts: string;
  level: 'info' | 'warn' | 'error' | 'http';
  message: string;
  meta?: Record<string, unknown>;
}

export async function getServerLogs(sinceId = 0, sinceSvc = 0): Promise<LogEntry[]> {
  const data = await request<{ logs: LogEntry[] }>(`/admin/logs?since=${sinceId}&since_svc=${sinceSvc}`);
  return data.logs;
}

// ── Password Change ──

// ── AI Chat ──

export async function sendAiMessage(
  message: string,
  newConversation = false
): Promise<{ reply: string; conversationId: number }> {
  return request<{ reply: string; conversationId: number }>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, newConversation }),
  });
}

export async function clearAiHistory(): Promise<{ ok: boolean; deleted: number }> {
  return request<{ ok: boolean; deleted: number }>("/ai/chat", {
    method: "DELETE",
  });
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

// Access codes removed

// ── NiggaBytes Admin ──

export async function grantNiggaBytes(userId: number, amount: number): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(`/admin/users/${userId}/niggabytes`, {
    method: "PUT",
    body: JSON.stringify({ amount }),
  });
}

// ── Pastes (Code Paste Bin) ──

export interface PasteParent {
  id: string;
  title: string;
  content: string;
  language: string;
}

export interface Paste {
  id: string;
  username: string;
  title: string;
  content: string;
  language: string;
  expires_at: string | null;
  created_at: string;
  time_ago: string;
  parent_id: string | null;
  parent: PasteParent | null;
}

export interface PasteListItem {
  id: string;
  title: string;
  language: string;
  expires_at: string | null;
  created_at: string;
  time_ago: string;
  parent_id: string | null;
}

export interface PasteCreateResult {
  ok: boolean;
  paste: { id: string; title: string; language: string; expires_at: string | null; url: string };
}

export async function getPaste(id: string): Promise<Paste> {
  const data = await request<{ paste: Paste }>(`/pastes/${encodeURIComponent(id)}`);
  return data.paste;
}

export async function getMyPastes(page = 1): Promise<{ pastes: PasteListItem[]; has_more: boolean }> {
  return request(`/pastes?page=${page}`);
}

export async function createPaste(data: {
  title?: string;
  content: string;
  language?: string;
  expires_in?: string;
  parent_id?: string;
}): Promise<PasteCreateResult> {
  return request("/pastes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createPublicPaste(data: {
  title?: string;
  content: string;
  language?: string;
  parent_id?: string;
}): Promise<PasteCreateResult> {
  const res = await fetch(`${API_BASE}/pastes/public`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "create failed");
  }
  return res.json() as Promise<PasteCreateResult>;
}

export async function getPublicPaste(id: string): Promise<Paste> {
  const res = await fetch(`${API_BASE}/pastes/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "paste not found");
  }
  const data = await res.json() as { paste: Paste };
  return data.paste;
}

export async function deletePaste(id: string): Promise<{ ok: boolean }> {
  return request(`/pastes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function analyzeCode(code: string, language: string): Promise<{ analysis: string }> {
  return request<{ analysis: string }>("/pastes/analyze", {
    method: "POST",
    body: JSON.stringify({ code, language }),
  });
}

// ── Shop ──

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  price: number | null;
  owned: number;
  max_purchases: number;
  free_slots: number;
  total_slots: number;
  max_slots: number;
  sold_out: boolean;
  price_schedule: number[];
}

export interface ActiveSubscription {
  id: number;
  type: string;
  starts_at: string;
  expires_at: string | null;
  is_active: number;
  auto_renew: number;
}

export interface SubscriptionPrices {
  basic: { '1m': number; '3m': number; '12m': number };
  premium: { '1m': number; '3m': number; '12m': number };
}

export interface SubscriptionBenefits {
  basic: string[];
  premium: string[];
}

export interface ShopItemsResponse {
  items: ShopItem[];
  nb_balance: number;
  nb_packs: number[];
  subscription_prices: SubscriptionPrices;
  subscription_benefits: SubscriptionBenefits;
  active_subscription: ActiveSubscription | null;
}

export interface ShopPurchaseResult {
  ok: boolean;
  message: string;
  nb_balance: number;
  total_slots: number;
  next_price: number | null;
}

export async function getShopItems(): Promise<ShopItemsResponse> {
  return request<ShopItemsResponse>("/shop/items");
}

export async function purchaseShopItem(item: string): Promise<ShopPurchaseResult> {
  return request<ShopPurchaseResult>("/shop/purchase", {
    method: "POST",
    body: JSON.stringify({ item }),
  });
}

export async function subscribeWithNb(type: string, promoCode?: string): Promise<{ ok: boolean; message: string; nb_balance: number }> {
  return request("/shop/subscribe", {
    method: "POST",
    body: JSON.stringify({ type, promo_code: promoCode }),
  });
}

export async function getNbBalance(): Promise<{ nb_balance: number }> {
  return request("/shop/balance");
}

export async function toggleAutoRenew(enabled: boolean): Promise<{ ok: boolean; auto_renew: boolean; message: string }> {
  return request("/shop/auto-renew", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

// ── Payments ──

export interface Payment {
  id: string;
  type: string;
  amount_eur: number;
  nb_amount: number;
  status: string;
  invoice_url: string;
  created_at: string;
}

export async function createPayment(type: string, nbAmount?: number, promoCode?: string): Promise<{ payment_id: string; invoice_url: string }> {
  return request("/payments/create", {
    method: "POST",
    body: JSON.stringify({ type, nb_amount: nbAmount, promo_code: promoCode }),
  });
}

export async function getMyPayments(): Promise<Payment[]> {
  const data = await request<{ payments: Payment[] }>("/payments/mine");
  return data.payments;
}

export async function getActiveSubscription(): Promise<ActiveSubscription | null> {
  const data = await request<{ subscription: ActiveSubscription | null }>("/payments/subscription");
  return data.subscription;
}

// ── Online Users ──

export interface OnlineUser {
  email: string;
  role: string;
}

export async function getOnlineUsers(): Promise<OnlineUser[]> {
  const data = await request<{ users: OnlineUser[] }>("/who");
  return data.users;
}

// ── File Transfers ──

export interface Transfer {
  id: string;
  original_names: string[];
  size: number;
  expires_at: string;
  uploaded_at: string | null;
  created_at: string;
  expired: boolean;
  status?: "pending" | "uploaded" | "expired";
  max_size?: number;
  content_type?: string | null;
}

export async function createTransferLink(): Promise<{ id: string; url: string; expires_at: string }> {
  return request("/transfers", { method: "POST", body: JSON.stringify({}) });
}

export async function getMyTransfers(): Promise<Transfer[]> {
  const data = await request<{ transfers: Transfer[] }>("/transfers");
  return data.transfers;
}

export async function getPublicTransferInfo(id: string): Promise<Transfer> {
  const res = await fetch(`${API_BASE}/transfers/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "transfer not found");
  }
  const data = await res.json() as { transfer: Transfer };
  return data.transfer;
}

export async function deleteTransfer(id: string): Promise<{ ok: boolean }> {
  return request(`/transfers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getTransferDownloadUrl(id: string): string {
  return `${API_BASE}/transfers/${encodeURIComponent(id)}/download`;
}

export async function getTransferPresignedUrl(id: string, contentType?: string): Promise<{ uploadUrl: string }> {
  const res = await fetch(`${API_BASE}/transfers/${encodeURIComponent(id)}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contentType ? { content_type: contentType } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "presign failed");
  }
  return res.json() as Promise<{ uploadUrl: string }>;
}

export async function confirmTransferUpload(id: string, names: string[], size: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/transfers/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names, size }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "confirm failed");
  }
  return res.json() as Promise<{ ok: boolean }>;
}

// ── Shortlinks (URL Shortener) ──

export interface Shortlink {
  id: number;
  slug: string;
  target_url: string;
  title: string;
  click_count: number;
  last_clicked_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function getMyShortlinks(): Promise<Shortlink[]> {
  const data = await request<{ links: Shortlink[] }>("/shortlinks");
  return data.links;
}

export async function createShortlink(data: {
  url: string;
  slug?: string;
  title?: string;
}): Promise<Shortlink> {
  const resp = await request<{ ok: boolean; link: Shortlink }>("/shortlinks", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return resp.link;
}

export async function deleteShortlink(id: number): Promise<void> {
  await request(`/shortlinks/${id}`, { method: "DELETE" });
}

export async function resolveShortlink(slug: string): Promise<{ target_url: string }> {
  const res = await fetch(`${API_BASE}/shortlinks/r/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "link not found");
  }
  return res.json() as Promise<{ target_url: string }>;
}

// ── Media Downloader ──

export interface MediaInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  qualities: number[];
  formats: string[];
  platform: string;
  hasQualityPicker: boolean;
}

export async function getMediaInfo(url: string): Promise<MediaInfo> {
  return request<MediaInfo>("/download/info", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

// ── Cloud Storage (S3-backed) ──

export interface CloudFile {
  id: string;
  filename: string;
  path: string;
  mime_type: string;
  size: number;
  uploaded_at: string;
}

export async function cloudPresign(
  filename: string,
  path: string,
  contentType: string,
  size: number
): Promise<{ fileId: string; uploadUrl: string; path: string }> {
  return request("/cloud/upload/presign", {
    method: "POST",
    body: JSON.stringify({ filename, path, contentType, size }),
  });
}

export async function cloudConfirm(
  fileId: string,
  filename: string,
  path: string,
  contentType: string,
  size: number
): Promise<{ ok: boolean; fileId: string; size: number }> {
  return request("/cloud/upload/confirm", {
    method: "POST",
    body: JSON.stringify({ fileId, filename, path, contentType, size }),
  });
}

export function getCloudDownloadUrl(fileId: string): string {
  return `${API_BASE}/cloud/download/${encodeURIComponent(fileId)}`;
}

export async function deleteCloudFile(fileId: string): Promise<{ ok: boolean }> {
  return request(`/cloud/file/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

export async function getCloudFiles(): Promise<CloudFile[]> {
  const data = await request<{ files: CloudFile[] }>("/cloud/files");
  return data.files;
}

export async function getCloudStats(): Promise<StorageStats> {
  return request<StorageStats>("/cloud/stats");
}

export async function migrateCloud(): Promise<{ ok: boolean; migrated: number; message: string }> {
  return request("/cloud/migrate", { method: "POST" });
}

export async function renameCloudFile(fileId: string, updates: { filename?: string; path?: string }): Promise<{ ok: boolean }> {
  return request(`/cloud/file/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function bulkMoveCloudFiles(moves: { id: string; filename?: string; path: string }[]): Promise<{ ok: boolean; updated: number }> {
  return request("/cloud/files/bulk-move", {
    method: "PATCH",
    body: JSON.stringify({ moves }),
  });
}

// ── Cloud Shares (public file links) ──

export interface CloudShare {
  id: string;
  file_id?: string;
  filename: string;
  size: number;
  mime_type: string;
  downloads: number;
  expires_at: string;
  created_at: string;
  expired: boolean;
  url?: string;
  has_password?: boolean;
}

export async function createCloudShare(
  fileId: string,
  password?: string,
  expiryDays?: number,
): Promise<CloudShare & { url: string }> {
  return request(`/cloud/share/${encodeURIComponent(fileId)}`, {
    method: "POST",
    body: JSON.stringify({
      ...(password ? { password } : {}),
      ...(expiryDays !== undefined ? { expiry_days: expiryDays } : {}),
    }),
  });
}

export async function getShareForFile(fileId: string): Promise<(CloudShare & { url: string }) | null> {
  const data = await request<{ share: (CloudShare & { url: string }) | null }>(`/cloud/share-for/${encodeURIComponent(fileId)}`);
  return data.share;
}

export async function getCloudShares(): Promise<CloudShare[]> {
  const data = await request<{ shares: CloudShare[] }>("/cloud/shares");
  return data.shares;
}

export async function deleteCloudShare(shareId: string): Promise<{ ok: boolean }> {
  return request(`/cloud/share/${encodeURIComponent(shareId)}`, { method: "DELETE" });
}

export interface ShareFolderResult {
  id: string;
  url: string;
  zip_file_id: string;
  zip_filename: string;
  zip_size: number;
  files_zipped: number;
  expires_at: string;
  has_password: boolean;
  downloads: number;
}

export async function shareFolder(
  path: string,
  password?: string,
  expiryDays?: number,
): Promise<ShareFolderResult> {
  return request("/cloud/share-folder", {
    method: "POST",
    body: JSON.stringify({
      path,
      ...(password ? { password } : {}),
      ...(expiryDays !== undefined ? { expiry_days: expiryDays } : {}),
    }),
  });
}

export async function getPublicShareInfo(shareId: string): Promise<CloudShare> {
  const res = await fetch(`${API_BASE}/cloud/share/public/${encodeURIComponent(shareId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "share not found");
  }
  const data = await res.json() as CloudShare;
  return data;
}

export function getShareDownloadUrl(shareId: string, password?: string): string {
  const base = `${API_BASE}/cloud/share/public/${encodeURIComponent(shareId)}/download`;
  if (password) return `${base}?pw=${encodeURIComponent(password)}`;
  return base;
}

// ── Promo Codes ──

export interface PromoValidation {
  valid: boolean;
  type?: "discount_pct" | "free_sub";
  value?: number;
  sub_tier?: string | null;
  error?: string;
}

export interface PromoCode {
  code: string;
  type: string;
  value: number;
  sub_tier: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  created_at: string;
  active: number;
}

export async function validatePromo(code: string): Promise<PromoValidation> {
  return request<PromoValidation>("/promo/validate", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function redeemPromo(code: string): Promise<{ ok: boolean; sub_tier: string; days: number; message: string }> {
  return request("/promo/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getPromos(): Promise<PromoCode[]> {
  const data = await request<{ promos: PromoCode[] }>("/admin/promos");
  return data.promos;
}

export async function createPromo(data: {
  code: string;
  type: string;
  value: number;
  sub_tier?: string;
  max_uses?: number;
  expires_in_hours?: number;
}): Promise<PromoCode> {
  const res = await request<{ promo: PromoCode }>("/admin/promos", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.promo;
}

export async function deletePromo(code: string): Promise<void> {
  await request(`/admin/promos/${encodeURIComponent(code)}`, { method: "DELETE" });
}

// ── Chess ──

export async function chessCreate(opts: {
  color?: 'white' | 'black' | 'random';
  timeControl?: number;
  botLevel?: number;
}): Promise<{ gameId: string; token: string; botToken?: string; color: 'white' | 'black'; shareUrl: string }> {
  return request("/chess/create", { method: "POST", body: JSON.stringify(opts) });
}

export async function chessJoin(gameId: string, name?: string): Promise<{ token: string; color: 'white' | 'black'; game: unknown }> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/chess/join/${encodeURIComponent(gameId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "join failed");
  }
  return res.json() as Promise<{ token: string; color: 'white' | 'black'; game: unknown }>;
}

export async function chessGet(gameId: string): Promise<{ game: unknown }> {
  const res = await fetch(`${API_BASE}/chess/${encodeURIComponent(gameId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "game not found");
  }
  return res.json() as Promise<{ game: unknown }>;
}

export async function chessPoll(gameId: string, token: string, since: number, draw?: string): Promise<{ updated: boolean; game?: unknown }> {
  const params = new URLSearchParams({ token, since: String(since) });
  if (draw) params.set("draw", draw);
  const res = await fetch(`${API_BASE}/chess/${encodeURIComponent(gameId)}/poll?${params}`);
  if (!res.ok) return { updated: false };
  return res.json() as Promise<{ updated: boolean; game?: unknown }>;
}

export async function chessMove(gameId: string, token: string, from: string, to: string, promotion?: string): Promise<{ ok: boolean } & Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/chess/${encodeURIComponent(gameId)}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, from, to, promotion }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "move failed");
  }
  return res.json() as Promise<{ ok: boolean } & Record<string, unknown>>;
}

export async function chessResign(gameId: string, token: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/chess/${encodeURIComponent(gameId)}/resign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "resign failed");
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export async function chessDraw(gameId: string, token: string): Promise<{ ok: boolean; drawOffered?: boolean; result?: string }> {
  const res = await fetch(`${API_BASE}/chess/${encodeURIComponent(gameId)}/draw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? "draw failed");
  }
  return res.json() as Promise<{ ok: boolean; drawOffered?: boolean; result?: string }>;
}

export async function chessMyGames(): Promise<{ games: unknown[] }> {
  return request("/chess/my/games");
}
