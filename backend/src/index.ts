import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { ENV } from './config/env';
import { apiLimiter } from './middleware/rateLimiter';
import { errorHandler, notFound } from './middleware/errorHandler';
import { logger } from './utils/logger';

const app = express();
let apiReady = false;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'strict-origin-when-cross-origin' } }));

const explicitOrigins = new Set([
  ENV.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...ENV.CORS_ORIGINS,
]);

const isDevLanOrigin = (origin: string): boolean => {
  if (ENV.NODE_ENV !== 'development') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !/^[0-9]+$/.test(url.port || '3000') || Number(url.port || 3000) !== 3000) return false;
    const host = url.hostname;
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!ipv4) return false;
    const octets = ipv4.slice(1).map(Number);
    return (octets[0] === 10)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  } catch {
    return false;
  }
};

const isDevNgrokOrigin = (origin: string): boolean => {
  if (ENV.NODE_ENV !== 'development') return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.ngrok-free.app');
  } catch {
    return false;
  }
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || explicitOrigins.has(origin) || isDevLanOrigin(origin) || isDevNgrokOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: ENV.BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: ENV.BODY_LIMIT }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'rtc-platform-api' }));
app.get('/ready', (_req, res) => apiReady ? res.status(200).json({ status: 'ready' }) : res.status(503).json({ status: 'degraded', reason: 'Application services are still initializing' }));
app.use('/api', apiLimiter);

const server = app.listen(ENV.PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server on port ${ENV.PORT} [${ENV.NODE_ENV}]`);
  void loadApiRoutes();
});

async function loadApiRoutes(): Promise<void> {
  try {
    const { default: routes } = await import('./routes');
    app.use('/api', routes);
    app.use(notFound);
    app.use(errorHandler);
    apiReady = true;
    logger.info('✅ API routes initialized');
  } catch (error) {
    logger.error('❌ API initialization failed:', error);
    app.use((_req, res) => res.status(503).json({ error: 'API temporarily unavailable', code: 'API_INIT_FAILED' }));
  }
}

const shutdown = (signal: string) => {
  logger.info(`${signal}: shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));
process.on('uncaughtException', (error) => { logger.error('Uncaught exception:', error); shutdown('uncaughtException'); });

export default app;
