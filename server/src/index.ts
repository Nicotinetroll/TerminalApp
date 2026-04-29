import { captureConsole, logHttp } from './logger.js';
captureConsole();

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env manually — no dotenv dependency
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '.env');

try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  console.warn('Warning: .env file not found, using environment variables only.');
}

// Import after env is loaded so db.ts and others can use process.env
const { default: express } = await import('express');
const { default: cors } = await import('cors');

// Importing db triggers migrations
const { default: db } = await import('./db.js');

const { default: authRouter } = await import('./routes/auth.js');
const { default: syncRouter } = await import('./routes/sync.js');
const { default: adminRouter } = await import('./routes/admin.js');
const { default: mailRouter } = await import('./routes/mail.js');
const { default: settingsRouter } = await import('./routes/settings.js');
const { default: aiRouter } = await import('./routes/ai.js');

const { default: pastesRouter } = await import('./routes/pastes.js');
const { default: shopRouter } = await import('./routes/shop.js');
const { default: transfersRouter } = await import('./routes/transfers.js');
const { default: shortlinksRouter } = await import('./routes/shortlinks.js');
const { default: downloadRouter } = await import('./routes/download.js');
const { default: paymentsRouter, checkExpiredSubscriptions, cleanupPendingUsers } = await import('./routes/payments.js');
const { default: cloudRouter } = await import('./routes/cloud.js');
const { default: promoRouter } = await import('./routes/promo.js');
const { default: chessRouter } = await import('./routes/chess.js');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// CORS — whitelist only our domains
const ALLOWED_ORIGINS = ['https://mynig.ga', 'https://dl.mynig.ga', 'http://localhost:5173'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(null, false);
  },
  credentials: true,
}));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Prevent browser/proxy caching of API responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.use(express.json({ limit: '100mb' }));

// HTTP request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logHttp(req.method, req.path, res.statusCode, Date.now() - start, (req as unknown as Record<string, unknown>).user ? ((req as unknown as Record<string, unknown>).user as { email?: string }).email : undefined);
  });
  next();
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/sync', syncRouter);
app.use('/api/admin', adminRouter);
app.use('/api/mail', mailRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);

app.use('/api/pastes', pastesRouter);
app.use('/api/shop', shopRouter);
app.use('/api/transfers', transfersRouter);
app.use('/api/shortlinks', shortlinksRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/download', downloadRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/promo', promoRouter);
app.use('/api/chess', chessRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Online users (stub — socket.io removed, kept for `who` command)
app.get('/api/who', (_req, res) => {
  res.json({ users: [] });
});

// Global error handlers — don't crash silently like a little bitch
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandled rejection:', reason);
});

// Subscription expiry cron — check every hour
setInterval(checkExpiredSubscriptions, 60 * 60 * 1000);
// Also check on startup
checkExpiredSubscriptions();

// Cleanup stale pending users — every 30 min
cleanupPendingUsers();
setInterval(cleanupPendingUsers, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`mynigga-api running on port ${PORT}`);
});
