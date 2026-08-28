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
import routes from './routes';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(cors({
  origin: ENV.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: ENV.BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: ENV.BODY_LIMIT }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/ready', (_req, res) => res.status(200).json({ status: 'ready' }));

app.use('/api', apiLimiter);
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(ENV.PORT, () => logger.info(`🚀 Server on port ${ENV.PORT} [${ENV.NODE_ENV}]`));

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
