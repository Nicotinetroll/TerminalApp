import { Router, type Response } from 'express';
import { spawn } from 'child_process';
import { mkdirSync, readdirSync, createReadStream, rmSync, statSync } from 'fs';
import { join } from 'path';
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

function recordDownload(userId: number, videoUrl: string, title: string, quality: string): void {
  db.prepare(
    'INSERT INTO youtube_downloads (user_id, video_url, title, quality) VALUES (?, ?, ?, ?)'
  ).run(userId, videoUrl, title, quality);
}

// ── Validate YouTube URL ──

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(www\.)?youtube\.com$/.test(u.hostname) ||
           u.hostname === 'youtu.be' ||
           u.hostname === 'm.youtube.com' ||
           u.hostname === 'music.youtube.com';
  } catch {
    return false;
  }
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

// ── POST /api/youtube/info — get video metadata ──

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

  if (!isYouTubeUrl(url)) {
    res.status(400).json({ error: "that's not a youtube url. try harder." });
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

  try {
    const { stdout, stderr, code } = await runYtDlp(
      ['-j', '--no-download', '--no-warnings', url],
      15000
    );

    if (code !== 0) {
      console.error('[youtube] yt-dlp info error:', stderr);
      res.status(400).json({ error: stderr.includes('Video unavailable') ? 'video unavailable or private.' : 'failed to fetch video info. might be private or region-locked.' });
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
    });
  } catch (err) {
    console.error('[youtube] info error:', err);
    res.status(500).json({ error: 'something broke fetching video info.' });
  }
});

// ── GET /api/youtube/download — download & stream file ──

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

  if (!isYouTubeUrl(url)) {
    res.status(400).json({ error: "not a youtube url." });
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

  const tmpId = randomUUID();
  const tmpDir = `/tmp/yt-${tmpId}`;
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Build yt-dlp args
    const args: string[] = [];

    if (format === 'audio') {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      const q = quality && quality !== 'best' ? parseInt(quality, 10) : 0;
      if (q > 0) {
        args.push('-f', `bestvideo[height<=${q}]+bestaudio/best[height<=${q}]`);
      } else {
        args.push('-f', 'bestvideo+bestaudio/best');
      }
      args.push('--merge-output-format', 'mp4');
    }

    args.push(
      '--no-playlist',
      '--no-warnings',
      '-o', join(tmpDir, '%(title).100s.%(ext)s'),
      url
    );

    const { stderr, code } = await runYtDlp(args, 300000); // 5 min timeout

    if (code !== 0) {
      console.error('[youtube] download error:', stderr);
      res.status(500).json({ error: 'download failed. video might be restricted.' });
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
    recordDownload(userId, url, titleFromFile, quality ?? 'best');

    // Stream file to browser
    res.setHeader('Content-Type', format === 'audio' ? 'audio/mpeg' : 'video/mp4');
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
    console.error('[youtube] download error:', err);
    // Cleanup on error
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    if (!res.headersSent) {
      res.status(500).json({ error: 'download exploded. try again.' });
    }
  }
});

export default router;
