/**
 * Upload Service
 * Handles chunked file uploads with resume support
 */

import { v4 as uuidv4 } from 'uuid';
import config from '../config/index.js';
import { sessionClient } from '../config/redis.js';
import { File, UploadSession, Quota } from '../models/index.js';
import storageProvider, { StorageTier } from '../providers/storage/index.js';
import { md5, sha256, verifyHash } from '../utils/hash.js';
import { sanitizeFilename, validateFileType } from '../middleware/security.js';
import { getMimeType } from '../utils/stream.js';
import {
    ValidationError,
    UploadError,
    ChunkValidationError,
    SessionExpiredError,
    FileSizeLimitError,
} from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Redis key prefix for upload sessions
 */
const SESSION_PREFIX = 'upload_session:';

class UploadService {
    /**
     * Initialize an upload session
     */
    async initializeUpload(userId, { filename, size, hash, mimeType, folderId }) {
        // Validate filename
        const sanitizedFilename = sanitizeFilename(filename);

        // Determine MIME type
        const detectedMimeType = mimeType || getMimeType(sanitizedFilename);

        // Validate file type
        validateFileType(detectedMimeType, sanitizedFilename);

        // Check user quota
        const quota = await Quota.getOrCreate(userId);
        const canUpload = await quota.canUpload(size);

        if (!canUpload.allowed) {
            throw new ValidationError(canUpload.reasons[0].message, {
                reasons: canUpload.reasons,
            });
        }

        // Calculate chunks
        const chunkSize = config.upload.chunkSize;
        const totalChunks = Math.ceil(size / chunkSize);

        // Generate session ID
        const sessionId = uuidv4();

        // Create session in MongoDB for persistence
        const session = await UploadSession.create({
            sessionId,
            userId,
            filename: sanitizedFilename,
            mimeType: detectedMimeType,
            totalSize: size,
            expectedHash: hash,
            folderId: folderId || null,
            chunkSize,
            totalChunks,
            expiresAt: new Date(Date.now() + config.upload.sessionTtl * 1000),
        });

        // Cache session data in Redis for fast access
        await this._cacheSession(session);

        logger.info('Upload session created', {
            sessionId,
            userId,
            filename: sanitizedFilename,
            size,
            totalChunks,
        });

        return {
            sessionId,
            chunkSize,
            totalChunks,
            expiresAt: session.expiresAt,
            uploadUrls: this._generateChunkUrls(sessionId, totalChunks),
        };
    }

    /**
     * Upload a single chunk
     */
    async uploadChunk(sessionId, chunkIndex, chunkData, chunkHash) {
        // Get session from cache or DB
        const session = await this._getSession(sessionId);

        if (!session) {
            throw new SessionExpiredError(sessionId);
        }

        // Validate chunk index
        if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
            throw new ChunkValidationError(chunkIndex, 'Invalid chunk index');
        }

        // Check if chunk already uploaded
        if (await this._isChunkUploaded(sessionId, chunkIndex)) {
            logger.debug('Chunk already uploaded, skipping', { sessionId, chunkIndex });
            return {
                sessionId,
                chunkIndex,
                status: 'already_uploaded',
                progress: await this._getProgress(sessionId),
            };
        }

        // Validate chunk data
        if (!chunkData || chunkData.length === 0) {
            throw new ChunkValidationError(chunkIndex, 'Empty chunk data');
        }

        // Validate chunk hash if provided
        if (chunkHash) {
            const actualHash = md5(chunkData);
            if (!verifyHash(actualHash, chunkHash)) {
                throw new ChunkValidationError(chunkIndex, 'Chunk hash mismatch');
            }
        }

        // Validate chunk size
        const expectedSize = this._getExpectedChunkSize(
            chunkIndex,
            session.totalChunks,
            session.chunkSize,
            session.totalSize
        );

        if (chunkData.length !== expectedSize) {
            throw new ChunkValidationError(
                chunkIndex,
                `Invalid chunk size. Expected: ${expectedSize}, Got: ${chunkData.length}`
            );
        }

        // Store chunk
        await storageProvider.writeChunk(sessionId, chunkIndex, chunkData);

        // Mark chunk as completed
        const computedHash = md5(chunkData);
        await this._markChunkComplete(sessionId, chunkIndex, chunkData.length, computedHash);

        // Update MongoDB session
        const dbSession = await UploadSession.findOne({ sessionId });
        if (dbSession) {
            await dbSession.markChunkComplete(chunkIndex, chunkData.length, computedHash);
        }

        const progress = await this._getProgress(sessionId);

        logger.debug('Chunk uploaded', {
            sessionId,
            chunkIndex,
            size: chunkData.length,
            progress: progress.percentage,
        });

        return {
            sessionId,
            chunkIndex,
            status: 'uploaded',
            progress,
        };
    }

    /**
     * Get upload status
     */
    async getUploadStatus(sessionId) {
        const session = await this._getSession(sessionId);

        if (!session) {
            throw new SessionExpiredError(sessionId);
        }

        const progress = await this._getProgress(sessionId);
        const completedChunks = await this._getCompletedChunks(sessionId);
        const remainingChunks = [];

        for (let i = 0; i < session.totalChunks; i++) {
            if (!completedChunks.includes(i)) {
                remainingChunks.push(i);
            }
        }

        return {
            sessionId,
            filename: session.filename,
            totalSize: session.totalSize,
            totalChunks: session.totalChunks,
            completedChunks: completedChunks.length,
            remainingChunks,
            progress,
            status: session.status,
            expiresAt: session.expiresAt,
        };
    }

    /**
     * Complete upload and assemble file
     */
    async completeUpload(sessionId, userId) {
        const session = await this._getSession(sessionId);

        if (!session) {
            throw new SessionExpiredError(sessionId);
        }

        // Verify ownership
        if (session.userId.toString() !== userId.toString()) {
            throw new ValidationError('Unauthorized access to upload session');
        }

        // Check all chunks uploaded
        const completedChunks = await this._getCompletedChunks(sessionId);

        if (completedChunks.length !== session.totalChunks) {
            throw new UploadError(
                `Upload incomplete. ${session.totalChunks - completedChunks.length} chunks remaining`
            );
        }

        // Update session status
        const dbSession = await UploadSession.findOne({ sessionId });
        if (dbSession) {
            await dbSession.startAssembly();
        }

        try {
            // Generate storage key
            const storageKey = this._generateStorageKey(userId, session.filename);

            // Determine storage tier based on user role
            const tier = await this._getStorageTier(userId);

            // Assemble chunks
            const result = await storageProvider.assembleChunks(
                sessionId,
                storageKey,
                session.totalChunks,
                tier
            );

            // Verify final hash
            if (session.expectedHash && !verifyHash(result.hash, session.expectedHash)) {
                // Clean up the assembled file
                await storageProvider.delete(storageKey, tier);
                throw new UploadError('File hash verification failed', 400, 'HASH_MISMATCH');
            }

            // Create file record
            const file = await File.create({
                userId,
                storageKey,
                originalName: session.filename,
                mimeType: session.mimeType,
                size: result.size,
                hash: result.hash,
                storageTier: tier,
                folderId: session.folderId || null,
                expiresAt: await this._getExpiryDate(userId),
            });

            // Update quota
            const quota = await Quota.getOrCreate(userId);
            await quota.addFile(result.size);

            // Mark session as completed
            if (dbSession) {
                await dbSession.markCompleted(file._id, tier);
            }

            // Clean up Redis cache
            await this._deleteSessionCache(sessionId);

            logger.info('Upload completed', {
                sessionId,
                fileId: file._id,
                storageKey,
                size: result.size,
                hash: result.hash,
                tier,
            });

            return {
                fileId: file._id,
                filename: file.originalName,
                size: file.size,
                hash: file.hash,
                mimeType: file.mimeType,
                downloadUrl: file.downloadUrl,
                expiresAt: file.expiresAt,
            };
        } catch (error) {
            // Mark session as failed
            if (dbSession) {
                await dbSession.markFailed(error);
            }

            // Clean up chunks
            await storageProvider.deleteChunks(sessionId);

            throw error;
        }
    }

    /**
     * Abort an upload session
     */
    async abortUpload(sessionId, userId) {
        const session = await this._getSession(sessionId);

        if (!session) {
            return { success: true, message: 'Session not found or already expired' };
        }

        // Verify ownership
        if (session.userId.toString() !== userId.toString()) {
            throw new ValidationError('Unauthorized access to upload session');
        }

        // Clean up chunks
        await storageProvider.deleteChunks(sessionId);

        // Update MongoDB session
        const dbSession = await UploadSession.findOne({ sessionId });
        if (dbSession) {
            await dbSession.markFailed({ message: 'Aborted by user', code: 'ABORTED' });
        }

        // Clean up Redis cache
        await this._deleteSessionCache(sessionId);

        logger.info('Upload aborted', { sessionId, userId });

        return { success: true, message: 'Upload aborted' };
    }

    /**
     * Resume an upload (get missing chunks)
     */
    async resumeUpload(sessionId, userId) {
        const session = await this._getSession(sessionId);

        if (!session) {
            throw new SessionExpiredError(sessionId);
        }

        // Verify ownership
        if (session.userId.toString() !== userId.toString()) {
            throw new ValidationError('Unauthorized access to upload session');
        }

        const status = await this.getUploadStatus(sessionId);

        return {
            ...status,
            uploadUrls: this._generateChunkUrls(sessionId, session.totalChunks),
        };
    }

    // ==================== Private Methods ====================

    /**
     * Cache session in Redis
     */
    async _cacheSession(session) {
        const key = `${SESSION_PREFIX}${session.sessionId}`;
        const data = {
            sessionId: session.sessionId,
            userId: session.userId.toString(),
            filename: session.filename,
            mimeType: session.mimeType,
            totalSize: session.totalSize,
            expectedHash: session.expectedHash,
            folderId: session.folderId ? session.folderId.toString() : null,
            chunkSize: session.chunkSize,
            totalChunks: session.totalChunks,
            status: session.status,
            expiresAt: session.expiresAt.toISOString(),
        };

        await sessionClient.setex(
            key,
            config.upload.sessionTtl,
            JSON.stringify(data)
        );
    }

    /**
     * Get session from cache or DB
     */
    async _getSession(sessionId) {
        const key = `${SESSION_PREFIX}${sessionId}`;

        // Try cache first
        const cached = await sessionClient.get(key);
        if (cached) {
            const data = JSON.parse(cached);
            data.expiresAt = new Date(data.expiresAt);
            return data;
        }

        // Fall back to DB
        const dbSession = await UploadSession.findOne({
            sessionId,
            expiresAt: { $gt: new Date() },
            status: { $in: ['pending', 'uploading'] },
        });

        if (dbSession) {
            // Re-cache
            await this._cacheSession(dbSession);
            return {
                sessionId: dbSession.sessionId,
                userId: dbSession.userId.toString(),
                filename: dbSession.filename,
                mimeType: dbSession.mimeType,
                totalSize: dbSession.totalSize,
                expectedHash: dbSession.expectedHash,
                chunkSize: dbSession.chunkSize,
                totalChunks: dbSession.totalChunks,
                status: dbSession.status,
                expiresAt: dbSession.expiresAt,
            };
        }

        return null;
    }

    /**
     * Delete session cache
     */
    async _deleteSessionCache(sessionId) {
        const sessionKey = `${SESSION_PREFIX}${sessionId}`;
        const chunksKey = `${SESSION_PREFIX}${sessionId}:chunks`;

        await sessionClient.del(sessionKey, chunksKey);
    }

    /**
     * Check if chunk is already uploaded
     */
    async _isChunkUploaded(sessionId, chunkIndex) {
        const key = `${SESSION_PREFIX}${sessionId}:chunks`;
        const result = await sessionClient.sismember(key, chunkIndex.toString());
        return result === 1;
    }

    /**
     * Mark chunk as complete in Redis
     */
    async _markChunkComplete(sessionId, chunkIndex, size, hash) {
        const key = `${SESSION_PREFIX}${sessionId}:chunks`;
        await sessionClient.sadd(key, chunkIndex.toString());
        await sessionClient.expire(key, config.upload.sessionTtl);
    }

    /**
     * Get completed chunks from Redis
     */
    async _getCompletedChunks(sessionId) {
        const key = `${SESSION_PREFIX}${sessionId}:chunks`;
        const chunks = await sessionClient.smembers(key);
        return chunks.map(c => parseInt(c, 10)).sort((a, b) => a - b);
    }

    /**
     * Get upload progress
     */
    async _getProgress(sessionId) {
        const session = await this._getSession(sessionId);
        if (!session) return null;

        const completedChunks = await this._getCompletedChunks(sessionId);
        const percentage = (completedChunks.length / session.totalChunks) * 100;

        // Calculate uploaded bytes
        let uploadedBytes = 0;
        for (const chunkIndex of completedChunks) {
            uploadedBytes += this._getExpectedChunkSize(
                chunkIndex,
                session.totalChunks,
                session.chunkSize,
                session.totalSize
            );
        }

        return {
            percentage: Math.round(percentage * 100) / 100,
            uploadedChunks: completedChunks.length,
            totalChunks: session.totalChunks,
            uploadedBytes,
            totalBytes: session.totalSize,
        };
    }

    /**
     * Calculate expected chunk size
     */
    _getExpectedChunkSize(chunkIndex, totalChunks, chunkSize, totalSize) {
        if (chunkIndex === totalChunks - 1) {
            // Last chunk may be smaller
            const remainder = totalSize % chunkSize;
            return remainder === 0 ? chunkSize : remainder;
        }
        return chunkSize;
    }

    /**
     * Generate chunk upload URLs
     */
    _generateChunkUrls(sessionId, totalChunks) {
        const urls = [];
        for (let i = 0; i < totalChunks; i++) {
            urls.push({
                chunkIndex: i,
                url: `/api/upload/chunk/${sessionId}/${i}`,
                method: 'PUT',
            });
        }
        return urls;
    }

    /**
     * Generate storage key for file
     */
    _generateStorageKey(userId, filename) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const ext = filename.split('.').pop() || '';
        return `${userId}_${timestamp}_${random}.${ext}`;
    }

    /**
     * Determine storage tier based on user role
     */
    async _getStorageTier(userId) {
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(userId);

        if (!user) return StorageTier.HOT;

        // Premium users get SSD by default
        if (user.isPremiumOrAdmin()) {
            return StorageTier.HOT;
        }

        // Free users also start on SSD, migrate later if unused
        return StorageTier.HOT;
    }

    /**
     * Get expiry date based on user role
     */
    async _getExpiryDate(userId) {
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(userId);

        if (!user) {
            return new Date(Date.now() + config.expiry.daysFree * 24 * 60 * 60 * 1000);
        }

        // Premium users don't have expiry
        if (user.isPremiumOrAdmin()) {
            return null;
        }

        // Free users get 5 day expiry
        return new Date(Date.now() + config.expiry.daysFree * 24 * 60 * 60 * 1000);
    }
}

// Export singleton instance
const uploadService = new UploadService();
export default uploadService;
