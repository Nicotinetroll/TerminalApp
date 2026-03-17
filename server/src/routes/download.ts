import { Router, type Response } from 'express';
import { spawn } from 'child_process';
import { mkdirSync, readdirSync, createReadStream, rmSync, statSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { authMiddleware, type AuthRequest } from '../middleware.js';

const router = Router();
router.use(authMiddleware);

// ── Rate limiting: 10 downloads/hour per user, admin unlimited ──

function checkRateLimit(userId: number, role: string): boolean {
  if (role === 'admin') return true;
  const count = (db.prepare(
    `SELECT COUNT(*) as cnt FROM youtube_downloads
     WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`
  ).get(userId) as { cnt: number }).cnt;
  return count < 10;
}

function recordDownload(userId: number, videoUrl: string, title: string, quality: string, platform: string): void {
  db.prepare(
    'INSERT INTO youtube_downloads (user_id, video_url, title, quality, platform) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, videoUrl, title, quality, platform);
}

// ── Validate URL (any http/https) ──

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Detect platform from URL hostname ──

function detectPlatform(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (/youtube\.com$|youtu\.be$|music\.youtube\.com$/.test(hostname)) return 'youtube';
    if (/instagram\.com$/.test(hostname)) return 'instagram';
    if (/tiktok\.com$/.test(hostname)) return 'tiktok';
    if (/twitter\.com$|x\.com$/.test(hostname)) return 'twitter';
    if (/soundcloud\.com$/.test(hostname)) return 'soundcloud';
    if (/reddit\.com$|redd\.it$/.test(hostname)) return 'reddit';
    if (/facebook\.com$|fb\.watch$/.test(hostname)) return 'facebook';
    if (/twitch\.tv$/.test(hostname)) return 'twitch';
    if (/vimeo\.com$/.test(hostname)) return 'vimeo';
    return 'other';
  } catch {
    return 'other';
  }
}

// ── Content-type from file extension ──

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ── Helper: run yt-dlp with timeout ──

function runYtDlp(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
}

// ── Platforms where quality picker makes sense ──

const QUALITY_PLATFORMS = new Set(['youtube', 'vimeo', 'twitch']);

// ── POST /api/download/info — get media metadata ──

interface YtDlpJson {
  title?: string;
  thumbnail?: string;
  duration?: number;
  formats?: { format_id?: string; height?: number; ext?: string; acodec?: string; vcodec?: string; filesize?: number; filesize_approx?: number }[];
  fulltitle?: string;
  uploader?: string;
}

router.post('/info', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "guests can't download shit. log in first." });
    return;
  }

  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url required, genius.' });
    return;
  }

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "that's not a valid url. try harder." });
    return;
  }

  // Check rate limit even for info (prevent spam)
  const dlCount = (db.prepare(
    `SELECT COUNT(*) as cnt FROM youtube_downloads
     WHERE user_id = ? AND created_at > datetime('now', '-1 hour')`
  ).get(userId) as { cnt: number }).cnt;
  if (role !== 'admin' && dlCount >= 10) {
    res.status(429).json({ error: "chill. you've been downloading too much. 10/hour limit." });
    return;
  }

  const platform = detectPlatform(url);

  try {
    const { stdout, stderr, code } = await runYtDlp(
      ['-j', '--no-download', '--no-warnings', url],
      15000
    );

    if (code !== 0) {
      console.error('[download] yt-dlp info error:', stderr);
      res.status(400).json({ error: stderr.includes('Video unavailable') ? 'video unavailable or private.' : 'yt-dlp couldn\'t fetch this url. might be private, geo-blocked, or unsupported.' });
      return;
    }

    const data = JSON.parse(stdout) as YtDlpJson;

    // Extract available video qualities
    const heights = new Set<number>();
    if (data.formats) {
      for (const f of data.formats) {
        if (f.height && f.vcodec && f.vcodec !== 'none') {
          heights.add(f.height);
        }
      }
    }

    const qualities = [2160, 1440, 1080, 720, 480, 360].filter(h => heights.has(h));
    if (qualities.length === 0) qualities.push(720); // fallback

    res.json({
      title: data.title ?? data.fulltitle ?? 'untitled',
      thumbnail: data.thumbnail ?? '',
      duration: data.duration ?? 0,
      uploader: data.uploader ?? '',
      qualities,
      formats: ['video', 'audio'],
      platform,
      hasQualityPicker: QUALITY_PLATFORMS.has(platform),
    });
  } catch (err) {
    console.error('[download] info error:', err);
    res.status(500).json({ error: 'something broke fetching media info.' });
  }
});

// ── GET /api/download/download — download & stream file ──

router.get('/download', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "guests can't download. you know the drill." });
    return;
  }

  const url = req.query['url'] as string | undefined;
  const format = req.query['format'] as string | undefined; // 'video' or 'audio'
  const quality = req.query['quality'] as string | undefined; // 'best', '1080', '720', '480', etc.

  if (!url || !format) {
    res.status(400).json({ error: 'url and format required.' });
    return;
  }

  if (!isValidUrl(url)) {
    res.status(400).json({ error: "not a valid url." });
    return;
  }

  if (!['video', 'audio'].includes(format)) {
    res.status(400).json({ error: "format must be 'video' or 'audio'." });
    return;
  }

  // Rate limit
  if (!checkRateLimit(userId, role)) {
    res.status(429).json({ error: "slow down, speed demon. 10 downloads per hour." });
    return;
  }

  const platform = detectPlatform(url);
  const tmpId = randomUUID();
  const tmpDir = `/tmp/dl-${tmpId}`;
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Build yt-dlp args
    const args: string[] = [];

    if (format === 'audio') {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      // Only apply quality selection for platforms that support it
      if (QUALITY_PLATFORMS.has(platform)) {
        const q = quality && quality !== 'best' ? parseInt(quality, 10) : 0;
        if (q > 0) {
          args.push('-f', `bestvideo[height<=${q}]+bestaudio/best[height<=${q}]`);
        } else {
          args.push('-f', 'bestvideo+bestaudio/best');
        }
        args.push('--merge-output-format', 'mp4');
      } else {
        // For other platforms, just get best available
        args.push('-f', 'best');
      }
    }

    args.push(
      '--no-playlist',
      '--no-warnings',
      '-o', join(tmpDir, '%(title).100s.%(ext)s'),
      url
    );

    const { stderr, code } = await runYtDlp(args, 300000); // 5 min timeout

    if (code !== 0) {
      console.error('[download] download error:', stderr);
      res.status(500).json({ error: 'download failed. content might be restricted or unavailable.' });
      return;
    }

    // Find the output file
    const files = readdirSync(tmpDir);
    if (files.length === 0) {
      res.status(500).json({ error: 'download produced no files. weird.' });
      return;
    }

    const outputFile = join(tmpDir, files[0]!);
    const stat = statSync(outputFile);
    const filename = files[0]!;

    // Record download
    const titleFromFile = filename.replace(/\.[^.]+$/, '');
    recordDownload(userId, url, titleFromFile, quality ?? 'best', platform);

    // Stream file to browser — detect content type from actual file
    const contentType = format === 'audio' ? 'audio/mpeg' : getMimeType(filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename).replace(/%20/g, ' ')}"`
    );

    const stream = createReadStream(outputFile);
    stream.pipe(res);

    // Cleanup when done
    stream.on('end', () => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    });
    stream.on('error', () => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    });
    res.on('close', () => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    });
  } catch (err) {
    console.error('[download] download error:', err);
    // Cleanup on error
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    if (!res.headersSent) {
      res.status(500).json({ error: 'download exploded. try again.' });
    }
  }
});

export default router;
