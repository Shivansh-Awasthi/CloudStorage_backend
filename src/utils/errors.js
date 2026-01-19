/**
 * Custom Error Classes
 * Standardized error handling across the application
 */

/**
 * Base Application Error
 */
export class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                statusCode: this.statusCode,
            },
        };
    }
}

/**
 * Validation Error (400)
 */
export class ValidationError extends AppError {
    constructor(message, fields = {}) {
        super(message, 400, 'VALIDATION_ERROR');
        this.fields = fields;
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                statusCode: this.statusCode,
                fields: this.fields,
            },
        };
    }
}

/**
 * Authentication Error (401)
 */
export class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

/**
 * Authorization Error (403)
 */
export class AuthorizationError extends AppError {
    constructor(message = 'Permission denied') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

/**
 * Not Found Error (404)
 */
export class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
        this.resource = resource;
    }
}

/**
 * Conflict Error (409)
 */
export class ConflictError extends AppError {
    constructor(message = 'Resource already exists') {
        super(message, 409, 'CONFLICT');
    }
}

/**
 * Rate Limit Error (429)
 */
export class RateLimitError extends AppError {
    constructor(retryAfter = 60) {
        super('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');
        this.retryAfter = retryAfter;
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                statusCode: this.statusCode,
                retryAfter: this.retryAfter,
            },
        };
    }
}

/**
 * Storage Error (500)
 */
export class StorageError extends AppError {
    constructor(message = 'Storage operation failed', operation = 'unknown') {
        super(message, 500, 'STORAGE_ERROR');
        this.operation = operation;
    }
}

/**
 * Upload Error (400/500)
 */
export class UploadError extends AppError {
    constructor(message, statusCode = 400, code = 'UPLOAD_ERROR') {
        super(message, statusCode, code);
    }
}

/**
 * Chunk Validation Error (400)
 */
export class ChunkValidationError extends UploadError {
    constructor(chunkIndex, reason) {
        super(`Chunk ${chunkIndex} validation failed: ${reason}`, 400, 'CHUNK_VALIDATION_ERROR');
        this.chunkIndex = chunkIndex;
        this.reason = reason;
    }
}

/**
 * File Size Limit Error (413)
 */
export class FileSizeLimitError extends AppError {
    constructor(maxSize, currentSize) {
        super(`File size exceeds limit. Max: ${maxSize}, Got: ${currentSize}`, 413, 'FILE_SIZE_LIMIT');
        this.maxSize = maxSize;
        this.currentSize = currentSize;
    }
}

/**
 * Session Expired Error (410)
 */
export class SessionExpiredError extends AppError {
    constructor(sessionId) {
        super('Upload session expired or not found', 410, 'SESSION_EXPIRED');
        this.sessionId = sessionId;
    }
}
