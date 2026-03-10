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
  role: "admin" | "club" | "user" | "guest" | "code";
  created_at?: string;
  permissions?: string[];
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
    recent: { username: string; role: string; created_at: string }[];
  };
  storage: {
    total_bytes: number;
    total_human: string;
    top_users: { username: string; bytes: number; human: string }[];
  };
  chat: {
    total_rooms: number;
    total_messages: number;
    active_rooms_24h: number;
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
  games: {
    total_scores: number;
    by_game: { game: string; count: number }[];
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

// ── Access Code Login ──

interface CodeLoginResponse {
  token: string;
  user: AuthUser;
}

export async function codeLogin(
  code: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  try {
    const data = await request<CodeLoginResponse>("/auth/code-login", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    setToken(data.token);
    return { ok: true, user: data.user };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "code login failed.";
    return { ok: false, error: message };
  }
}

// ── Access Code Admin CRUD ──

export interface AccessCode {
  id: number;
  code: string;
  name: string;
  permissions: string;
  expires_hours: number;
  is_active: number;
  created_by: number;
  created_at: string;
  temp_user_count: number;
}

export async function getAccessCodes(): Promise<AccessCode[]> {
  const data = await request<{ codes: AccessCode[] }>("/codes");
  return data.codes;
}

export async function createAccessCode(data: {
  name: string;
  code?: string;
  permissions?: string[];
  expires_hours?: number;
}): Promise<AccessCode> {
  const resp = await request<{ code: AccessCode }>("/codes", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return resp.code;
}

export async function updateAccessCode(
  id: number,
  updates: { name?: string; permissions?: string[]; expires_hours?: number; is_active?: boolean }
): Promise<AccessCode> {
  const resp = await request<{ code: AccessCode }>(`/codes/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  return resp.code;
}

export async function deleteAccessCode(id: number): Promise<{ ok: boolean; deleted_users: number }> {
  return request<{ ok: boolean; deleted_users: number }>(`/codes/${id}`, { method: "DELETE" });
}

// ── Slots (Casino) ──

export interface SlotsBalance {
  bonus_bytes: number;
  base_limit: number;
  effective_limit: number;
  used: number;
  available_to_bet: number;
  free_spins: number;
  niggabytes: number;
  bonus: SlotsBonusInfo | null;
  stats: {
    total_won: number;
    total_lost: number;
    spins: number;
    win_rate: number;
  };
}

export interface SlotsLineWin {
  line: number;
  line_name: string;
  symbols: string[];
  multiplier: number;
  payout_bytes: number;
}

export interface SlotsBonusInfo {
  type: string;
  symbol: string;
  emoji: string;
  tier: string;
  multiplier: number;
  spins_remaining: number;
  spins_total: number;
  total_bonus: number;
  hits_this_spin: number;
  hit_payout: number;
  bet_mb: number;
  currency: string;
}

export interface SlotsSpinResult {
  grid: string[][];
  wins: SlotsLineWin[];
  total_payout_bytes: number;
  bet_bytes: number;
  is_free_spin: boolean;
  free_spins_awarded: number;
  free_spins_remaining: number;
  has_jackpot: boolean;
  combo_multiplier: number;
  message: string;
  currency: string;
  nb_balance: number;
  bonus: SlotsBonusInfo | null;
  bonus_awarded: SlotsBonusInfo | null;
  bonus_final: SlotsBonusInfo | null;
  balance: {
    bonus_bytes: number;
    effective_limit: number;
    used: number;
    available_to_bet: number;
  };
  stats: {
    total_won: number;
    total_lost: number;
    spins: number;
    win_rate: number;
  };
}

export interface SlotsHistoryEntry {
  id: number;
  bet_bytes: number;
  result: string;
  payout_bytes: number;
  grid: string[][];
  created_at: string;
}

export async function getSlotsBalance(): Promise<SlotsBalance> {
  return request<SlotsBalance>("/slots/balance");
}

export async function spinSlots(bet_mb: number, theme?: string, currency?: string): Promise<SlotsSpinResult> {
  return request<SlotsSpinResult>("/slots/spin", {
    method: "POST",
    body: JSON.stringify({ bet_mb, theme, currency }),
  });
}

export async function getSlotsHistory(): Promise<SlotsHistoryEntry[]> {
  const data = await request<{ history: SlotsHistoryEntry[] }>("/slots/history");
  return data.history;
}

// ── Coinflip ──

export interface CoinflipBalance {
  bonus_bytes: number;
  niggabytes: number;
  base_limit: number;
  effective_limit: number;
  used: number;
  available_to_bet: number;
  stats: {
    total_flips: number;
    wins: number;
    total_won: number;
    total_lost: number;
    win_rate: number;
  };
  streak: number;
}

export interface CoinflipResult {
  choice: string;
  outcome: string;
  won: boolean;
  bet_bytes: number;
  payout_bytes: number;
  message: string;
  streak: number;
  currency: string;
  nb_balance: number;
  balance: {
    bonus_bytes: number;
    effective_limit: number;
    used: number;
    available_to_bet: number;
  };
}

export interface CoinflipHistoryEntry {
  id: number;
  bet_bytes: number;
  choice: string;
  outcome: string;
  payout_bytes: number;
  created_at: string;
}

export async function getCoinflipBalance(): Promise<CoinflipBalance> {
  return request<CoinflipBalance>("/coinflip/balance");
}

export async function flipCoin(bet_mb: number, choice: string, currency?: string): Promise<CoinflipResult> {
  return request<CoinflipResult>("/coinflip/flip", {
    method: "POST",
    body: JSON.stringify({ bet_mb, choice, currency }),
  });
}

export async function getCoinflipHistory(): Promise<CoinflipHistoryEntry[]> {
  const data = await request<{ history: CoinflipHistoryEntry[] }>("/coinflip/history");
  return data.history;
}

// ── Coinflip Admin ──

export interface CoinflipPlayer {
  userId: number;
  username: string;
  role: string;
  bonus_bytes: number;
  flips: number;
  wins: number;
  total_won: number;
  total_lost: number;
  win_rate: number;
}

export async function getCoinflipPlayers(): Promise<CoinflipPlayer[]> {
  const data = await request<{ players: CoinflipPlayer[] }>("/coinflip/admin/players");
  return data.players;
}

export async function resetCoinflipPlayer(userId: number): Promise<void> {
  await request(`/coinflip/admin/reset/${userId}`, { method: "DELETE" });
}

export async function getCoinflipConfig(): Promise<{ win_chance: number }> {
  return request<{ win_chance: number }>("/coinflip/admin/config");
}

export async function setCoinflipConfig(win_chance: number): Promise<{ win_chance: number }> {
  return request<{ ok: boolean; win_chance: number }>("/coinflip/admin/config", {
    method: "PUT",
    body: JSON.stringify({ win_chance }),
  });
}

// ── Slots Admin ──

export interface SlotsPlayer {
  userId: number;
  username: string;
  role: string;
  bonus_bytes: number;
  total_won: number;
  total_lost: number;
  spins: number;
  free_spins: number;
  win_rate: number;
}

export async function getSlotsPlayers(): Promise<SlotsPlayer[]> {
  const data = await request<{ players: SlotsPlayer[] }>("/slots/admin/players");
  return data.players;
}

export async function resetSlotsPlayer(userId: number): Promise<void> {
  await request(`/slots/admin/reset/${userId}`, { method: "DELETE" });
}

export interface SlotsConfig {
  rtp_target: number;
  payout_factor: number;
  house_edge: string;
  win_frequency?: number;
}

export async function getSlotsConfig(): Promise<SlotsConfig> {
  return request<SlotsConfig>("/slots/admin/config");
}

export async function setSlotsConfig(rtp_target: number): Promise<SlotsConfig & { ok: boolean }> {
  return request<SlotsConfig & { ok: boolean }>("/slots/admin/config", {
    method: "PUT",
    body: JSON.stringify({ rtp_target }),
  });
}

// ── Unified Casino Admin ──

export interface CasinoPlayer {
  userId: number;
  username: string;
  role: string;
  niggabytes: number;
  bonus_bytes: number;
  slots_spins: number;
  slots_wr: number;
  cf_flips: number;
  cf_wr: number;
}

export interface CasinoConfig {
  slots_rtp_target: number;
  slots_payout_factor: number;
  slots_house_edge: string;
  slots_win_frequency?: number;
  coinflip_win_chance: number;
}

export async function getCasinoPlayers(): Promise<CasinoPlayer[]> {
  const data = await request<{ players: CasinoPlayer[] }>("/casino/admin/players");
  return data.players;
}

export async function getCasinoConfig(): Promise<CasinoConfig> {
  return request<CasinoConfig>("/casino/admin/config");
}

export async function setCasinoConfig(updates: { slots_rtp_target?: number; coinflip_win_chance?: number }): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/casino/admin/config", {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function grantNiggaBytes(userId: number, amount: number): Promise<{ ok: boolean; niggabytes: number; message: string }> {
  return request<{ ok: boolean; niggabytes: number; message: string }>("/casino/admin/grant-nb", {
    method: "POST",
    body: JSON.stringify({ userId, amount }),
  });
}

export async function resetCasinoPlayer(userId: number): Promise<void> {
  await request(`/casino/admin/reset/${userId}`, { method: "DELETE" });
}

// ── Casino Player Detail ──

export interface CasinoHistoryEntry {
  type: string;
  bet: number;
  payout: number;
  result: string;
  detail: string;
  created_at: string;
}

export interface CasinoBalancePoint {
  nb: number;
  ts: string;
}

export interface CasinoPlayerDetailData {
  player: {
    userId: number;
    username: string;
    role: string;
    niggabytes: number;
    bonus_bytes: number;
    total_won: number;
    total_lost: number;
    slots_spins: number;
    slots_wins: number;
    cf_flips: number;
    cf_wins: number;
    free_spins: number;
  };
  history: CasinoHistoryEntry[];
  balance_history: CasinoBalancePoint[];
}

export async function getCasinoPlayerDetail(userId: number): Promise<CasinoPlayerDetailData> {
  return request<CasinoPlayerDetailData>(`/casino/admin/players/${userId}`);
}

// ── Nigdit (Terminal Reddit) ──

export interface NigditAttachment {
  id: number;
  filename: string;
  mime_type: string;
  size: number;
}

export interface NigditBoard {
  id: number;
  name: string;
  description: string;
}

export interface NigditAwardBadge {
  award_type: string;
  count: number;
}

export interface NigditAwardType {
  key: string;
  label: string;
  cost: number;
  aura: number;
}

export interface NigditPollOption {
  id: number;
  label: string;
  vote_count: number;
}

export interface NigditPoll {
  options: NigditPollOption[];
  my_vote: number | null;
  total_votes: number;
}

export interface NigditPost {
  id: number;
  user_id: number;
  username: string;
  real_username?: string;
  title: string;
  body: string;
  body_preview: string;
  board: string;
  upvotes: number;
  downvotes: number;
  score: number;
  comment_count: number;
  my_vote: number;
  author_aura: number;
  is_pinned: boolean;
  is_edited: boolean;
  is_anonymous: boolean;
  post_type: string;
  expires_at: string | null;
  time_remaining: number | null;
  time_ago: string;
  created_at: string;
  attachments: NigditAttachment[];
  awards: NigditAwardBadge[];
  bookmarked: boolean;
  poll: NigditPoll | null;
}

export interface NigditComment {
  id: number;
  post_id: number;
  parent_id: number | null;
  user_id: number;
  username: string;
  body: string;
  upvotes: number;
  downvotes: number;
  score: number;
  depth: number;
  my_vote: number;
  author_aura: number;
  is_op: boolean;
  is_edited: boolean;
  is_anonymous: boolean;
  time_ago: string;
  created_at: string;
  awards: NigditAwardBadge[];
}

export interface NigditAura {
  username: string;
  post_aura: number;
  comment_aura: number;
  total: number;
}

export interface NigditVoteResult {
  ok: boolean;
  my_vote: number;
  score: number;
}

export interface NigditNotification {
  id: number;
  type: string;
  from_username: string;
  post_id: number | null;
  comment_id: number | null;
  meme_id: number | null;
  message: string;
  is_read: boolean;
  time_ago: string;
  created_at: string;
}

export interface NigditUserProfile {
  username: string;
  created_at: string;
  aura: NigditAura;
  post_count: number;
  comment_count: number;
  awards_received: number;
  streak: number;
}

export interface NigditUserProfilePost {
  id: number;
  title: string;
  board: string;
  score: number;
  comment_count: number;
  time_ago: string;
  post_type: string;
  is_pinned: boolean;
}

export async function getNigditPosts(
  board = "all",
  sort = "hot",
  page = 1,
  search = "",
  bookmarks = false
): Promise<{ posts: NigditPost[]; page: number; total: number; pages: number }> {
  let path = `/nigdit/posts?board=${board}&sort=${sort}&page=${page}`;
  if (search) path += `&search=${encodeURIComponent(search)}`;
  if (bookmarks) path += `&bookmarks=1`;
  return request(path);
}

export async function getNigditPost(id: number): Promise<{ post: NigditPost; comments: NigditComment[] }> {
  return request(`/nigdit/posts/${id}`);
}

export async function createNigditPost(data: {
  title: string;
  body: string;
  board: string;
  post_type?: string;
  is_anonymous?: boolean;
  poll_options?: string[];
  attachments?: File[];
}): Promise<{ ok: boolean; post: NigditPost }> {
  const formData = new FormData();
  formData.append("title", data.title);
  formData.append("body", data.body);
  formData.append("board", data.board);
  if (data.post_type) formData.append("post_type", data.post_type);
  if (data.is_anonymous) formData.append("is_anonymous", "true");
  if (data.poll_options && data.poll_options.length > 0) {
    formData.append("poll_options", JSON.stringify(data.poll_options));
  }
  if (data.attachments) {
    for (const file of data.attachments) {
      formData.append("attachments", file);
    }
  }

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/nigdit/posts`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (b as { error?: string }).error ?? "post failed");
  }
  return res.json() as Promise<{ ok: boolean; post: NigditPost }>;
}

export async function editNigditPost(id: number, updates: { title?: string; body?: string }): Promise<{ ok: boolean }> {
  return request(`/nigdit/posts/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteNigditPost(id: number): Promise<{ ok: boolean }> {
  return request(`/nigdit/posts/${id}`, { method: "DELETE" });
}

export async function createNigditComment(
  post_id: number,
  body: string,
  parent_id?: number,
  is_anonymous?: boolean
): Promise<{ ok: boolean; comment: NigditComment }> {
  return request("/nigdit/comments", {
    method: "POST",
    body: JSON.stringify({ post_id, body, parent_id, is_anonymous }),
  });
}

export async function editNigditComment(id: number, body: string): Promise<{ ok: boolean }> {
  return request(`/nigdit/comments/${id}`, {
    method: "PUT",
    body: JSON.stringify({ body }),
  });
}

export async function deleteNigditComment(id: number): Promise<{ ok: boolean }> {
  return request(`/nigdit/comments/${id}`, { method: "DELETE" });
}

export async function voteNigdit(
  target_id: number,
  target_type: "post" | "comment",
  value: 1 | -1
): Promise<NigditVoteResult> {
  return request("/nigdit/vote", {
    method: "POST",
    body: JSON.stringify({ target_id, target_type, value }),
  });
}

export async function giveNigditAward(
  award_type: string,
  post_id?: number,
  comment_id?: number
): Promise<{ ok: boolean; nb_remaining: number }> {
  return request("/nigdit/awards", {
    method: "POST",
    body: JSON.stringify({ award_type, post_id, comment_id }),
  });
}

export async function getNigditAwardTypes(): Promise<NigditAwardType[]> {
  const data = await request<{ award_types: NigditAwardType[] }>("/nigdit/award-types");
  return data.award_types;
}

export async function voteNigditPoll(postId: number, option_id: number): Promise<{ ok: boolean; poll: NigditPoll }> {
  return request(`/nigdit/polls/${postId}/vote`, {
    method: "POST",
    body: JSON.stringify({ option_id }),
  });
}

export async function toggleNigditBookmark(postId: number): Promise<{ ok: boolean; bookmarked: boolean }> {
  return request(`/nigdit/bookmarks/${postId}`, { method: "POST" });
}

export async function getNigditNotifications(): Promise<NigditNotification[]> {
  const data = await request<{ notifications: NigditNotification[] }>("/nigdit/notifications");
  return data.notifications;
}

export async function getNigditNotificationCount(): Promise<number> {
  const data = await request<{ count: number }>("/nigdit/notifications/count");
  return data.count;
}

export async function markNigditNotificationsRead(): Promise<void> {
  await request("/nigdit/notifications/read", { method: "PUT" });
}

export async function pinNigditPost(id: number): Promise<{ ok: boolean; is_pinned: boolean }> {
  return request(`/nigdit/posts/${id}/pin`, { method: "POST" });
}

export async function getNigditUserProfile(username: string): Promise<{ user: NigditUserProfile; posts: NigditUserProfilePost[] }> {
  return request(`/nigdit/users/${encodeURIComponent(username)}`);
}

export async function getNigditAura(username?: string): Promise<NigditAura> {
  const path = username ? `/nigdit/aura/${encodeURIComponent(username)}` : "/nigdit/aura";
  return request(path);
}

export async function getNigditBoards(): Promise<NigditBoard[]> {
  const data = await request<{ boards: NigditBoard[] }>("/nigdit/boards");
  return data.boards;
}

export async function createNigditBoard(name: string, description: string): Promise<NigditBoard[]> {
  const data = await request<{ ok: boolean; boards: NigditBoard[] }>("/nigdit/admin/boards", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
  return data.boards;
}

export async function updateNigditBoard(id: number, updates: { name?: string; description?: string }): Promise<NigditBoard[]> {
  const data = await request<{ ok: boolean; boards: NigditBoard[] }>(`/nigdit/admin/boards/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  return data.boards;
}

export async function deleteNigditBoard(id: number): Promise<NigditBoard[]> {
  const data = await request<{ ok: boolean; boards: NigditBoard[] }>(`/nigdit/admin/boards/${id}`, {
    method: "DELETE",
  });
  return data.boards;
}

export interface NigditAdminStats {
  totalPosts: number;
  totalComments: number;
  totalVotes: number;
  topPosters: { username: string; post_count: number }[];
  topAura: { username: string; total_aura: number }[];
  boards: NigditBoard[];
}

export async function getNigditAdminStats(): Promise<NigditAdminStats> {
  return request<NigditAdminStats>("/nigdit/admin/stats");
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
  total_slots: number;
  max_slots: number;
  sold_out: boolean;
  price_schedule: number[];
}

export interface ShopItemsResponse {
  items: ShopItem[];
  nb_balance: number;
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

// ── Online Users ──

export interface OnlineUser {
  username: string;
  role: string;
}

export async function getOnlineUsers(): Promise<OnlineUser[]> {
  const data = await request<{ users: OnlineUser[] }>("/who");
  return data.users;
}

// ── Memes (Image Gallery) ──

export interface Meme {
  id: number;
  username: string;
  upvotes: number;
  downvotes: number;
  score: number;
  my_vote: number;
  time_ago: string;
  created_at: string;
  image_url: string;
}

export interface MemeVoteResult {
  ok: boolean;
  my_vote: number;
  score: number;
}

export async function getMemes(
  sort = "hot",
  page = 1
): Promise<{ memes: Meme[]; has_more: boolean }> {
  return request(`/memes?sort=${sort}&page=${page}`);
}

export async function voteMeme(
  meme_id: number,
  value: 1 | -1
): Promise<MemeVoteResult> {
  return request("/memes/vote", {
    method: "POST",
    body: JSON.stringify({ meme_id, value }),
  });
}

export async function deleteMeme(id: number): Promise<{ ok: boolean }> {
  return request(`/memes/${id}`, { method: "DELETE" });
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

export async function getTransferPresignedUrl(id: string): Promise<{ uploadUrl: string }> {
  const res = await fetch(`${API_BASE}/transfers/${encodeURIComponent(id)}/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
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

export async function uploadMeme(
  file: File
): Promise<{ ok: boolean; meme: Meme }> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch(`${API_BASE}/memes`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (b as { error?: string }).error ?? "upload failed");
  }

  return res.json() as Promise<{ ok: boolean; meme: Meme }>;
}
