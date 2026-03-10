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
  windowId: WindowId;
  closeWindow: () => void;
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
  content?: string;
}

export interface User {
  username: string;
  role: "admin" | "club" | "user" | "code";
  id?: string;
  permissions?: string[];
}

export interface ThemeColors {
  accent: string;
  accentSoft: string;
  accentMid: string;
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

export type AppPhase = "login" | "terminal";

export interface AuthState {
  user: User | null;
  failedAttempts: number;
  lockedUntil: number | null;
}
