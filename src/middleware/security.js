/**
 * Security Middleware
 * Path traversal protection, file validation, and request sanitation
 */

import path from 'path';
import config from '../config/index.js';
import { ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Dangerous patterns for path traversal
 */
const DANGEROUS_PATTERNS = [
    /\.\./,                    // Parent directory
    /%2e%2e/i,                 // URL encoded ..
    /%252e%252e/i,             // Double encoded ..
    /\\/,                      // Backslash
    /%5c/i,                    // URL encoded backslash
    /%255c/i,                  // Double encoded backslash
    /\0/,                      // Null byte
    /%00/,                     // URL encoded null byte
];

/**
 * Dangerous MIME types
 */
const DANGEROUS_MIME_TYPES = [
    'application/x-msdownload',
    'application/x-executable',
    'application/x-dosexec',
];

/**
 * Validate and sanitize filename
 */
export function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        throw new ValidationError('Invalid filename');
    }

    // Check length
    if (filename.length > config.security.maxFilenameLength) {
        throw new ValidationError(`Filename too long (max ${config.security.maxFilenameLength} characters)`);
    }

    // Check for path traversal
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(filename)) {
            throw new ValidationError('Invalid filename: contains dangerous characters');
        }
    }

    // Get basename only (remove any path components)
    const basename = path.basename(filename);

    // Remove null bytes and control characters
    const sanitized = basename
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .trim();

    if (!sanitized || sanitized === '.' || sanitized === '..') {
        throw new ValidationError('Invalid filename');
    }

    return sanitized;
}

/**
 * Validate file type
 */
export function validateFileType(mimeType, filename) {
    // Check against dangerous MIME types
    if (DANGEROUS_MIME_TYPES.includes(mimeType)) {
        logger.warn('Dangerous file type blocked', { mimeType, filename });
        throw new ValidationError('File type not allowed');
    }

    // Check against allowed MIME types if configured
    if (config.security.allowedMimeTypes.length > 0) {
        if (!config.security.allowedMimeTypes.includes(mimeType)) {
            throw new ValidationError(`File type not allowed: ${mimeType}`);
        }
    }

    return true;
}

/**
 * Path traversal protection middleware
 */
export function preventPathTraversal(req, res, next) {
    // Check URL path
    const urlPath = decodeURIComponent(req.path);

    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(urlPath)) {
            logger.warn('Path traversal attempt blocked', {
                ip: req.ip,
                path: req.path,
                pattern: pattern.toString(),
            });

            // Record abuse if available
            if (req.recordAbuse) {
                req.recordAbuse(25);
            }

            return res.status(400).json({
                error: {
                    code: 'INVALID_PATH',
                    message: 'Invalid request path',
                },
            });
        }
    }

    // Check query parameters
    for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') {
            for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(value)) {
                    logger.warn('Path traversal in query blocked', {
                        ip: req.ip,
                        param: key,
                        value,
                    });

                    if (req.recordAbuse) {
                        req.recordAbuse(25);
                    }

                    return res.status(400).json({
                        error: {
                            code: 'INVALID_QUERY',
                            message: `Invalid query parameter: ${key}`,
                        },
                    });
                }
            }
        }
    }

    next();
}

/**
 * Request body size limit middleware
 */
export function limitRequestBody(maxSize) {
    return (req, res, next) => {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);

        if (contentLength > maxSize) {
            return res.status(413).json({
                error: {
                    code: 'REQUEST_TOO_LARGE',
                    message: `Request body too large. Maximum: ${formatBytes(maxSize)}`,
                },
            });
        }

        next();
    };
}

/**
 * Validate MongoDB ObjectId
 */
export function validateObjectId(paramName) {
    return (req, res, next) => {
        const id = req.params[paramName];

        if (!id) {
            return next(new ValidationError(`${paramName} is required`));
        }

        // MongoDB ObjectId pattern
        const objectIdPattern = /^[a-fA-F0-9]{24}$/;

        if (!objectIdPattern.test(id)) {
            return next(new ValidationError(`Invalid ${paramName}`));
        }

        next();
    };
}

/**
 * Input sanitization middleware
 */
export function sanitizeInput(req, res, next) {
    // Recursively sanitize object
    const sanitize = (obj) => {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        const result = Array.isArray(obj) ? [] : {};

        for (const [key, value] of Object.entries(obj)) {
            // Skip dangerous keys
            if (key.startsWith('$') || key.includes('.')) {
                continue;
            }

            if (typeof value === 'string') {
                // Remove null bytes
                result[key] = value.replace(/\0/g, '');
            } else if (typeof value === 'object') {
                result[key] = sanitize(value);
            } else {
                result[key] = value;
            }
        }

        return result;
    };

    if (req.body && typeof req.body === 'object') {
        req.body = sanitize(req.body);
    }

    next();
}

/**
 * Format bytes helper
 */
function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export default {
    sanitizeFilename,
    validateFileType,
    preventPathTraversal,
    limitRequestBody,
    validateObjectId,
    sanitizeInput,
};
