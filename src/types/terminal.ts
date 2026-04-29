export type WindowId = string;

export interface WindowConfig {
  id?: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>;
  props?: Record<string, unknown>;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  minWidth?: number;
  minHeight?: number;
  appName?: string;
}

export interface WindowContentProps {
  windowId?: WindowId;
  closeWindow?: () => void;
  user: User;
  windowManager?: import("@/hooks/useWindowManager").WindowManager;
}

export interface WindowState {
  id: WindowId;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>;
  props: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  appName?: string;
}

export interface FileSystemNode {
  name: string;
  type: "file" | "directory";
  children?: Record<string, FileSystemNode>;
  content?: string;     // inline text content (write/touch commands)
  s3Key?: string;       // S3 file ID for uploaded files
  size?: number;        // actual byte size
  mimeType?: string;    // MIME type
}

export interface User {
  email: string;
  role: "admin" | "premium" | "basic" | "user";
  id?: string;
  permissions?: string[];
}

export interface ThemeColors {
  accent: string;
  accentSoft: string;
  accentMid: string;
  bgPrimary?: string;
  bgSurface?: string;
  bgElevated?: string;
  textPrimary?: string;
  textSecondary?: string;
  textMuted?: string;
  textGhost?: string;
  borderSubtle?: string;
  borderMedium?: string;
  error?: string;
  success?: string;
}

export interface CommandResult {
  text?: string;
  isError?: boolean;
  blocks?: OutputBlock[];
}

export interface OutputBlock {
  label: string;
  content: string;
  animated?: boolean;
}

export interface FullscreenConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>;
  props?: Record<string, unknown>;
}

export interface TerminalAPI {
  user: User;
  cwd: string;
  setCwd: (path: string) => void;
  setTheme: (theme: ThemeColors) => void;
  fs: FileSystemNode;
  clearHistory: () => void;
  print: (result: CommandResult) => void;
  logout: () => void;
  openWindow: (config: WindowConfig) => WindowId;
  openFullscreen: (config: FullscreenConfig) => void;
}

export interface CommandDef {
  name: string;
  description: string;
  usage?: string;
  category: "system" | "filesystem" | "apps";
  run: (args: string[], terminal: TerminalAPI) => CommandResult | Promise<CommandResult>;
}

export interface AppModule {
  name: string;
  description: string;
  run: (args: string[], terminal: TerminalAPI) => CommandResult | Promise<CommandResult>;
}

export interface HistoryEntry {
  id: number;
  command: string;
  result: CommandResult;
  cwd: string;
}

export type AppPhase = "login" | "subscribe" | "setup-password" | "theme-picker" | "terminal";

export interface AuthState {
  user: User | null;
  failedAttempts: number;
  lockedUntil: number | null;
}
