/**
 * Application Entry Point
 * Express application with all middleware and routes
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import config from './config/index.js';
import database from './config/database.js';
import redis from './config/redis.js';
import storageProvider from './providers/storage/index.js';
import routes from './routes/index.js';
import workerManager from './workers/index.js';
import uploadCleanupService from './services/UploadCleanupService.js';
import logger from './utils/logger.js';
import { AppError } from './utils/errors.js';
import { preventPathTraversal, sanitizeInput } from './middleware/security.js';
import { detectAbuse } from './middleware/rateLimiter.js';
import requestLogger from './middleware/requestLogger.js';

const app = express();

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging (GeoIP, UA parsing, timing)
app.use(requestLogger());

// Security
app.use(preventPathTraversal);
app.use(sanitizeInput);
app.use(detectAbuse);

// Health check
app.get('/health', async (req, res) => {
    const dbStatus = database.getStatus();
    const redisStatus = redis.getStatus();
    const storageHealthy = await storageProvider.healthCheck();

    const healthy = dbStatus.isConnected &&
        redisStatus.cache === 'ready' &&
        storageHealthy;

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
            database: dbStatus.isConnected ? 'connected' : 'disconnected',
            redis: redisStatus.cache,
            storage: storageHealthy ? 'healthy' : 'unhealthy',
        },
    });
});

// API routes
app.use(config.apiPrefix, routes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`,
        },
    });
});

// Error handler
app.use((err, req, res, next) => {
    // Log error
    if (err instanceof AppError && err.isOperational) {
        logger.warn('Operational error', {
            code: err.code,
            message: err.message,
            path: req.path,
        });
    } else {
        logger.error('Unexpected error', {
            error: err.message,
            stack: err.stack,
            path: req.path,
        });
    }

    // Send response
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: {
            code: err.code || 'INTERNAL_ERROR',
            message: config.isDev ? err.message : 'Internal server error',
        },
    });
});

// Start server
async function start() {
    try {
        // Connect to MongoDB
        await database.connect();

        // Connect to Redis
        await redis.connect();

        // Initialize storage
        await storageProvider.initialize();

        // Start background workers
        await workerManager.startAll();

        // Start upload cleanup service
        uploadCleanupService.start();

        // Start HTTP server
        app.listen(config.port, () => {
            logger.info(`Server started on port ${config.port}`, {
                env: config.env,
                apiPrefix: config.apiPrefix,
            });
        });
    } catch (error) {
        logger.error('Failed to start server', { error: error.message });
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down...`);

    uploadCleanupService.stop();
    workerManager.stopAll();
    await redis.disconnect();
    await database.disconnect();

    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
});

// Start the application
start();

export default app;
