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

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: ENV.FRONTEND_URL, credentials: true, methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'] }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use('/api', apiLimiter);
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(ENV.PORT, () => logger.info(`🚀 Server on port ${ENV.PORT} [${ENV.NODE_ENV}]`));

process.on('SIGTERM', () => { logger.info('Shutting down...'); server.close(() => process.exit(0)); });
process.on('unhandledRejection', (r) => logger.error('Unhandled rejection:', r));

export default app;
