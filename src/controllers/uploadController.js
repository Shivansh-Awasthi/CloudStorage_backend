/**
 * Upload Controller
 * With comprehensive upload logging
 */
import uploadService from '../services/UploadService.js';
import { ValidationError } from '../utils/errors.js';
import { logUpload } from '../utils/logger.js';

export async function initUpload(req, res, next) {
    try {
        const { filename, size, hash, mimeType, folderId } = req.body;

        if (!filename || !size) {
            throw new ValidationError('Filename and size are required');
        }

        const result = await uploadService.initializeUpload(req.user._id, {
            filename,
            size: parseInt(size, 10),
            hash,
            mimeType,
            folderId: folderId || null,
        });

        logUpload('started', {
            message: 'Upload session created',
            sessionId: result.sessionId,
            userId: req.user._id.toString(),
            userRole: req.user.role,
            filename,
            size: parseInt(size, 10),
            mimeType,
            folderId,
            totalChunks: result.totalChunks,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
            browser: req.logContext?.ua?.browser,
            os: req.logContext?.ua?.os,
        });

        res.status(201).json(result);
    } catch (error) {
        logUpload('init_failed', {
            message: 'Upload init failed',
            userId: req.user?._id?.toString(),
            filename: req.body?.filename,
            error: error.message,
            ip: req.logContext?.ip,
        });
        next(error);
    }
}

export async function uploadChunk(req, res, next) {
    try {
        const { sessionId, chunkIndex } = req.params;
        const chunkHash = req.headers['x-chunk-hash'];

        if (!req.body || req.body.length === 0) {
            throw new ValidationError('Chunk data required');
        }

        const result = await uploadService.uploadChunk(
            sessionId,
            parseInt(chunkIndex, 10),
            req.body,
            chunkHash
        );

        // Log chunk progress at 25%, 50%, 75%, 100%
        if ([25, 50, 75, 100].includes(result.progress)) {
            logUpload('chunk_progress', {
                message: `Upload ${result.progress}% complete`,
                sessionId,
                chunkIndex: parseInt(chunkIndex, 10),
                chunkSize: req.body.length,
                progress: result.progress,
            });
        }

        res.json(result);
    } catch (error) {
        if (req.recordAbuse && error.code === 'CHUNK_VALIDATION_ERROR') {
            req.recordAbuse(10);
            logUpload('chunk_validation_failed', {
                message: 'Chunk validation failed',
                sessionId: req.params?.sessionId,
                chunkIndex: req.params?.chunkIndex,
                ip: req.logContext?.ip,
            });
        }
        next(error);
    }
}

export async function getUploadStatus(req, res, next) {
    try {
        const { sessionId } = req.params;
        const result = await uploadService.getUploadStatus(sessionId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function completeUpload(req, res, next) {
    try {
        const { sessionId } = req.params;
        const result = await uploadService.completeUpload(sessionId, req.user._id);

        logUpload('completed', {
            message: 'Upload completed successfully',
            sessionId,
            fileId: result.fileId?.toString(),
            userId: req.user._id.toString(),
            filename: result.filename,
            size: result.size,
            hash: result.hash,
            mimeType: result.mimeType,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
        });

        res.json(result);
    } catch (error) {
        logUpload('complete_failed', {
            message: 'Upload completion failed',
            sessionId: req.params?.sessionId,
            userId: req.user?._id?.toString(),
            error: error.message,
            ip: req.logContext?.ip,
        });
        next(error);
    }
}

export async function abortUpload(req, res, next) {
    try {
        const { sessionId } = req.params;
        const result = await uploadService.abortUpload(sessionId, req.user._id);

        logUpload('aborted', {
            message: 'Upload aborted by user',
            sessionId,
            userId: req.user._id.toString(),
            ip: req.logContext?.ip,
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function resumeUpload(req, res, next) {
    try {
        const { sessionId } = req.params;
        const result = await uploadService.resumeUpload(sessionId, req.user._id);

        logUpload('resumed', {
            message: 'Upload session resumed',
            sessionId,
            userId: req.user._id.toString(),
            completedChunks: result.completedChunks?.length,
            ip: req.logContext?.ip,
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
}
