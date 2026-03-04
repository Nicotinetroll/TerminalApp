import { readFileSync } from 'fs';
import { createServer } from 'http';
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
await import('./db.js');

const { default: authRouter } = await import('./routes/auth.js');
const { default: syncRouter } = await import('./routes/sync.js');
const { default: adminRouter } = await import('./routes/admin.js');
const { default: chatRouter } = await import('./routes/chat.js');
const { setupSocket } = await import('./socket.js');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// CORS — whitelist only our domains
const ALLOWED_ORIGINS = ['https://mynig.ga', 'http://localhost:5173'];
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
  next();
});

app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/sync', syncRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin', chatRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Create HTTP server and attach Socket.IO
const server = createServer(app);
setupSocket(server);

server.listen(PORT, () => {
  console.log(`mynigga-api running on port ${PORT}`);
});
