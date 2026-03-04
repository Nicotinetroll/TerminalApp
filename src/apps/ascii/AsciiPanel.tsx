import { useState, useRef, useCallback, useEffect } from "react";
import type { WindowContentProps } from "@/types/terminal";

const CHARSETS: Record<string, string> = {
  standard: " .:-=+*#%@",
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  minimal: " .oO@",
  binary: " █",
  braille: " ⠁⠃⠇⡇⡏⡟⡿⣿",
  emoji: " ·•●◉◆■",
};

const CHARSET_NAMES: Record<string, string> = {
  standard: "standard",
  detailed: "detailed (hd)",
  blocks: "blocks ░▒▓█",
  minimal: "minimal",
  binary: "binary",
  braille: "braille",
  emoji: "shapes",
};

function imageToAscii(
  img: HTMLImageElement,
  width: number,
  charset: string,
  invert: boolean,
  contrast: number
): string {
  const chars = CHARSETS[charset] ?? CHARSETS["standard"]!;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Maintain aspect ratio — characters are ~2x taller than wide
  const aspectRatio = img.height / img.width;
  const height = Math.round(width * aspectRatio * 0.45);

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const lines: string[] = [];

  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Luminance from RGB
      let brightness = (pixels[i]! * 0.299 + pixels[i + 1]! * 0.587 + pixels[i + 2]! * 0.114) / 255;

      // Apply contrast
      if (contrast !== 0) {
        brightness = Math.max(0, Math.min(1, (brightness - 0.5) * (1 + contrast / 100) + 0.5));
      }

      if (invert) brightness = 1 - brightness;

      const charIndex = Math.floor(brightness * (chars.length - 1));
      line += chars[charIndex];
    }
    lines.push(line);
  }

  return lines.join("\n");
}

const EASTER_EGGS: Record<string, string> = {
  "69": "nice.",
  "420": "blaze it in ascii.",
  "1": "bro... one character? really?",
  "1337": "h4x0r mode activated.",
};

export function AsciiPanel(_props: WindowContentProps) {
  const [ascii, setAscii] = useState<string | null>(null);
  const [width, setWidth] = useState(80);
  const [charset, setCharset] = useState("standard");
  const [invert, setInvert] = useState(true); // dark bg = invert by default
  const [contrast, setContrast] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [easterEgg, setEasterEgg] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const processImage = useCallback((img: HTMLImageElement) => {
    setImgElement(img);
    const result = imageToAscii(img, width, charset, invert, contrast);
    setAscii(result);
    const egg = EASTER_EGGS[String(width)];
    setEasterEgg(egg ?? null);
  }, [width, charset, invert, contrast]);

  // Re-process when settings change
  useEffect(() => {
    if (imgElement) {
      const result = imageToAscii(imgElement, width, charset, invert, contrast);
      setAscii(result);
      const egg = EASTER_EGGS[String(width)];
      setEasterEgg(egg ?? null);
    }
  }, [imgElement, width, charset, invert, contrast]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => processImage(img);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, [processImage]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!ascii) return;
    try {
      await navigator.clipboard.writeText(ascii);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = ascii;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [ascii]);

  const handleReset = useCallback(() => {
    setAscii(null);
    setImgElement(null);
    setFileName(null);
    setEasterEgg(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          setFileName("pasted image");
          loadFile(file);
        }
        break;
      }
    }
  }, [loadFile]);

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // Upload / drop zone
  if (!ascii) {
    return (
      <div className="ascii-panel">
        <div
          className={`ascii-dropzone ${dragOver ? "ascii-dropzone-active" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="ascii-dropzone-icon">&lt;/&gt;</div>
          <div className="ascii-dropzone-title">drop image here</div>
          <div className="ascii-dropzone-sub">or click to browse. or paste from clipboard.</div>
          <div className="ascii-dropzone-formats">png, jpg, gif, webp, svg — whatever you got</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </div>

        <div className="ascii-settings">
          <div className="ascii-setting">
            <label>width</label>
            <input
              type="range"
              min="20"
              max="200"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <span className="ascii-setting-value">{width}</span>
          </div>
          <div className="ascii-setting">
            <label>charset</label>
            <select value={charset} onChange={(e) => setCharset(e.target.value)}>
              {Object.keys(CHARSETS).map((k) => (
                <option key={k} value={k}>{CHARSET_NAMES[k]}</option>
              ))}
            </select>
          </div>
          <div className="ascii-setting">
            <label>contrast</label>
            <input
              type="range"
              min="-100"
              max="100"
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
            />
            <span className="ascii-setting-value">{contrast}</span>
          </div>
          <div className="ascii-setting">
            <label>invert</label>
            <button
              className={`ascii-toggle ${invert ? "ascii-toggle-on" : ""}`}
              onClick={() => setInvert(!invert)}
            >
              {invert ? "ON" : "OFF"}
            </button>
            <span className="ascii-setting-hint">for dark backgrounds</span>
          </div>
        </div>
      </div>
    );
  }

  // Result view
  const lineCount = ascii.split("\n").length;
  const charCount = ascii.length;

  return (
    <div className="ascii-panel">
      <div className="ascii-toolbar">
        <button className="ascii-tool-btn" onClick={handleReset}>&lt; new image</button>
        <span className="ascii-toolbar-file">{fileName}</span>
        <span className="ascii-toolbar-info">{width}×{lineCount} · {charCount.toLocaleString()} chars</span>
        <button className="ascii-tool-btn ascii-tool-btn-accent" onClick={handleCopy}>
          {copied ? "copied!" : "copy"}
        </button>
      </div>

      {easterEgg && <div className="ascii-easter-egg">{easterEgg}</div>}

      <div className="ascii-settings ascii-settings-compact">
        <div className="ascii-setting">
          <label>w</label>
          <input
            type="range"
            min="20"
            max="200"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span className="ascii-setting-value">{width}</span>
        </div>
        <div className="ascii-setting">
          <label>charset</label>
          <select value={charset} onChange={(e) => setCharset(e.target.value)}>
            {Object.keys(CHARSETS).map((k) => (
              <option key={k} value={k}>{CHARSET_NAMES[k]}</option>
            ))}
          </select>
        </div>
        <div className="ascii-setting">
          <label>contrast</label>
          <input
            type="range"
            min="-100"
            max="100"
            value={contrast}
            onChange={(e) => setContrast(Number(e.target.value))}
          />
          <span className="ascii-setting-value">{contrast}</span>
        </div>
        <button
          className={`ascii-toggle-sm ${invert ? "ascii-toggle-on" : ""}`}
          onClick={() => setInvert(!invert)}
        >
          inv
        </button>
      </div>

      <div className="ascii-output-wrap">
        <pre ref={outputRef} className="ascii-output">{ascii}</pre>
      </div>
    </div>
  );
}
