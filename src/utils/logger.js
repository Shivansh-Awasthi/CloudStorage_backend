/**
 * Enhanced Logger Utility
 * Winston with daily rotation, GeoIP, structured JSON, and security logging
 */
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dirname, '../../logs');

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Custom format for development console
const devFormat = printf(({ level, message, timestamp, ...meta }) => {
    // Extract key fields for concise display
    const { userId, ip, action, fileId, duration, ...rest } = meta;
    const keyInfo = [userId && `user:${userId}`, ip, action, fileId && `file:${fileId}`, duration && `${duration}ms`]
        .filter(Boolean).join(' | ');
    const metaStr = Object.keys(rest).length ? JSON.stringify(rest) : '';
    return `${timestamp} [${level}]: ${message} ${keyInfo ? `(${keyInfo})` : ''} ${metaStr}`;
});

// Custom format for structured JSON logs
const jsonFormat = combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    json()
);

// Create main logger
const logger = winston.createLogger({
    level: config.logging?.level || 'debug',
    defaultMeta: { service: 'storage-service' },
    format: jsonFormat,
    transports: [
        // Console transport with colors for dev
        new winston.transports.Console({
            format: combine(
                colorize({ all: true }),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                devFormat
            ),
        }),
        // Daily rotating combined log
        new DailyRotateFile({
            dirname: logsDir,
            filename: 'combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '50m',
            maxFiles: '30d',
            format: jsonFormat,
        }),
        // Daily rotating error log
        new DailyRotateFile({
            dirname: logsDir,
            filename: 'error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '30d',
            format: jsonFormat,
        }),
    ],
    exitOnError: false,
});

// Security logger for auth/audit events
const securityLogger = winston.createLogger({
    level: 'info',
    defaultMeta: { service: 'storage-service', category: 'security' },
    format: jsonFormat,
    transports: [
        new winston.transports.Console({
            format: combine(
                colorize({ all: true }),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                printf(({ level, message, timestamp, action, ip, userId }) =>
                    `${timestamp} [${level}] 🔐 ${action || 'SECURITY'}: ${message} (ip:${ip || 'unknown'} user:${userId || 'anonymous'})`
                )
            ),
        }),
        new DailyRotateFile({
            dirname: logsDir,
            filename: 'security-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '90d', // Keep security logs longer
            format: jsonFormat,
        }),
    ],
});

// Export helper functions for common log patterns
export const logSecurity = (action, data) => {
    securityLogger.info(data.message || action, { action, ...data });
};

export const logUpload = (event, data) => {
    logger.info(`Upload ${event}`, { category: 'upload', event, ...data });
};

export const logDownload = (event, data) => {
    logger.info(`Download ${event}`, { category: 'download', event, ...data });
};

export const logAdmin = (action, data) => {
    securityLogger.info(`Admin: ${action}`, { action: `admin:${action}`, ...data });
};

export const logAuth = (event, data) => {
    securityLogger.info(`Auth ${event}`, { action: `auth:${event}`, ...data });
};

export { securityLogger };
export default logger;
