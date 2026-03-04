export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const EXT_ICONS: Record<string, string> = {
  // images
  png: "\u{1F5BC}", jpg: "\u{1F5BC}", jpeg: "\u{1F5BC}", gif: "\u{1F5BC}",
  webp: "\u{1F5BC}", svg: "\u{1F5BC}", bmp: "\u{1F5BC}", ico: "\u{1F5BC}",
  // audio
  mp3: "\u{1F3B5}", wav: "\u{1F3B5}", ogg: "\u{1F3B5}", flac: "\u{1F3B5}",
  aac: "\u{1F3B5}", m4a: "\u{1F3B5}",
  // video
  mp4: "\u{1F3AC}", webm: "\u{1F3AC}", mkv: "\u{1F3AC}", avi: "\u{1F3AC}",
  mov: "\u{1F3AC}",
  // code
  js: "\u{1F4BE}", ts: "\u{1F4BE}", tsx: "\u{1F4BE}", jsx: "\u{1F4BE}",
  py: "\u{1F4BE}", rs: "\u{1F4BE}", go: "\u{1F4BE}", c: "\u{1F4BE}",
  cpp: "\u{1F4BE}", h: "\u{1F4BE}", css: "\u{1F4BE}", html: "\u{1F4BE}",
  json: "\u{1F4BE}", xml: "\u{1F4BE}", yaml: "\u{1F4BE}", yml: "\u{1F4BE}",
  sh: "\u{1F4BE}", bash: "\u{1F4BE}",
};

const MIME_PREFIXES: Record<string, string> = {
  image: "\u{1F5BC}",
  audio: "\u{1F3B5}",
  video: "\u{1F3AC}",
};

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

function getMimePrefix(content?: string): string | null {
  if (!content?.startsWith("data:")) return null;
  const mime = content.slice(5, content.indexOf(";"));
  const prefix = mime.split("/")[0];
  return prefix ? MIME_PREFIXES[prefix] ?? null : null;
}

export function getFileIcon(filename: string, content?: string): string {
  const ext = getExtension(filename);
  if (ext && EXT_ICONS[ext]) return EXT_ICONS[ext]!;
  const mimeIcon = getMimePrefix(content);
  if (mimeIcon) return mimeIcon;
  return "\u{1F4C4}";
}

const EXT_TYPES: Record<string, string> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image",
  webp: "image", svg: "image", bmp: "image", ico: "icon",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio",
  aac: "audio", m4a: "audio",
  mp4: "video", webm: "video", mkv: "video", avi: "video", mov: "video",
  js: "javascript", ts: "typescript", tsx: "tsx", jsx: "jsx",
  py: "python", rs: "rust", go: "go", c: "c", cpp: "c++",
  h: "header", css: "stylesheet", html: "html",
  json: "json", xml: "xml", yaml: "yaml", yml: "yaml",
  sh: "shell", bash: "shell", txt: "text", md: "markdown",
  pdf: "pdf", zip: "archive", tar: "archive", gz: "archive",
};

export function getFileType(filename: string, content?: string): string {
  const ext = getExtension(filename);
  if (ext && EXT_TYPES[ext]) return EXT_TYPES[ext]!;
  if (content?.startsWith("data:")) {
    const mime = content.slice(5, content.indexOf(";"));
    return mime || "binary";
  }
  return "text";
}

export function getActualSize(content?: string): number {
  if (!content) return 0;
  if (content.startsWith("data:")) {
    const base64Start = content.indexOf(",");
    if (base64Start < 0) return content.length;
    const base64 = content.slice(base64Start + 1);
    return Math.floor(base64.length * 3 / 4);
  }
  return content.length;
}
