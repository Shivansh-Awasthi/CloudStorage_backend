/**
 * Download Service
 * Handles file downloads with streaming and range support
 */

import config from '../config/index.js';
import { File, Quota } from '../models/index.js';
import storageProvider from '../providers/storage/index.js';
import cacheProvider from '../providers/cache/index.js';
import { parseRange, contentRangeHeader } from '../utils/stream.js';
import { NotFoundError, AuthorizationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Cache TTL for file metadata (5 minutes)
 */
const METADATA_CACHE_TTL = 300;

class DownloadService {
    /**
     * Get file metadata (with caching)
     */
    async getFileMetadata(fileId) {
        const cacheKey = `file:${fileId}`;

        // Try cache first
        const cached = await cacheProvider.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Fetch from database
        const file = await File.findById(fileId);

        if (!file || file.isDeleted) {
            throw new NotFoundError('File');
        }

        // Check if expired
        if (file.isExpired) {
            throw new NotFoundError('File has expired');
        }

        const metadata = {
            id: file._id.toString(),
            storageKey: file.storageKey,
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            storageTier: file.storageTier,
            isPublic: file.isPublic,
            hasPassword: !!file.password,
            userId: file.userId.toString(),
            downloads: file.downloads,
            createdAt: file.createdAt,
            expiresAt: file.expiresAt,
        };

        // Cache metadata
        await cacheProvider.set(cacheKey, metadata, METADATA_CACHE_TTL);

        return metadata;
    }

    /**
     * Prepare download response
     */
    async prepareDownload(fileId, options = {}) {
        const { userId, rangeHeader, password } = options;

        // Get file metadata
        const metadata = await this.getFileMetadata(fileId);

        // Check access
        await this._checkAccess(metadata, userId, password);

        // Parse range if provided
        let range = null;
        if (rangeHeader) {
            range = parseRange(rangeHeader, metadata.size);
        }

        // Get file stream from storage
        const streamOptions = range ? { start: range.start, end: range.end } : {};
        const stream = storageProvider.getStream(
            metadata.storageKey,
            metadata.storageTier,
            streamOptions
        );

        // Prepare response headers
        const headers = this._buildHeaders(metadata, range);

        // Only increment download counter for full downloads (not range requests)
        // Range requests are typically for streaming/seeking in video/audio
        if (!rangeHeader) {
            this._incrementDownload(fileId).catch(err => {
                logger.error('Failed to increment download counter', { fileId, error: err.message });
            });
        }

        // Track bandwidth for quota
        if (userId) {
            this._trackBandwidth(userId, range ? (range.end - range.start + 1) : metadata.size)
                .catch(err => {
                    logger.error('Failed to track bandwidth', { userId, error: err.message });
                });
        }

        return {
            stream,
            headers,
            statusCode: range ? 206 : 200,
            metadata,
        };
    }

    /**
     * Get download URL info (for clients)
     */
    async getDownloadInfo(fileId, userId = null) {
        const metadata = await this.getFileMetadata(fileId);

        // Check basic access
        if (!metadata.isPublic && (!userId || metadata.userId !== userId)) {
            if (!config.features.anonymousDownload && !userId) {
                throw new AuthorizationError('Authentication required');
            }
        }

        return {
            fileId: metadata.id,
            filename: metadata.originalName,
            mimeType: metadata.mimeType,
            size: metadata.size,
            friendlySize: this._formatBytes(metadata.size),
            downloads: metadata.downloads,
            hasPassword: metadata.hasPassword,
            createdAt: metadata.createdAt,
            expiresAt: metadata.expiresAt,
            userId: metadata.userId,
            downloadUrl: `/api/download/${metadata.id}`,
        };
    }

    /**
     * Check access to file
     */
    async _checkAccess(metadata, userId, password) {
        // Public files without password are accessible to everyone
        if (metadata.isPublic && !metadata.hasPassword) {
            return true;
        }

        // Check password if required
        if (metadata.hasPassword) {
            if (!password) {
                throw new AuthorizationError('Password required');
            }

            const file = await File.findById(metadata.id).select('+password');
            if (!file || file.password !== password) {
                throw new AuthorizationError('Invalid password');
            }
        }

        // Private files require ownership or admin
        if (!metadata.isPublic) {
            if (!userId) {
                throw new AuthorizationError('Authentication required');
            }

            if (metadata.userId !== userId.toString()) {
                // Check if admin
                const User = (await import('../models/User.js')).default;
                const user = await User.findById(userId);

                if (!user || !user.isAdmin()) {
                    throw new AuthorizationError('Access denied');
                }
            }
        }

        return true;
    }

    /**
     * Build response headers
     */
    _buildHeaders(metadata, range) {
        const headers = {
            'Content-Type': metadata.mimeType,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.originalName)}"`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
            'ETag': `"${metadata.id}-${metadata.size}"`,
            'X-File-Id': metadata.id,
            'X-Download-Count': metadata.downloads + 1,
        };

        if (range) {
            headers['Content-Range'] = contentRangeHeader(range.start, range.end, metadata.size);
            headers['Content-Length'] = range.end - range.start + 1;
        } else {
            headers['Content-Length'] = metadata.size;
        }

        return headers;
    }

    /**
     * Increment download counter and extend expiry
     */
    async _incrementDownload(fileId) {
        const file = await File.findById(fileId);
        if (file) {
            await file.incrementDownload(config.expiry.extensionDays);

            // Invalidate cache
            await cacheProvider.delete(`file:${fileId}`);

            logger.debug('Download counter incremented', {
                fileId,
                downloads: file.downloads + 1
            });
        }
    }

    /**
     * Track bandwidth usage for user
     */
    async _trackBandwidth(userId, bytes) {
        const quota = await Quota.getOrCreate(userId);
        await quota.addBandwidth(bytes);
    }

    /**
     * Format bytes to human readable
     */
    _formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Get user's files with pagination
     */
    async getUserFiles(userId, options = {}) {
        const { page = 1, limit = 20, sort = '-createdAt' } = options;
        const skip = (page - 1) * limit;

        const [files, total] = await Promise.all([
            File.find({ userId, isDeleted: false })
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            File.countDocuments({ userId, isDeleted: false }),
        ]);

        return {
            files: files.map(f => ({
                id: f._id,
                filename: f.originalName,
                mimeType: f.mimeType,
                size: f.size,
                friendlySize: this._formatBytes(f.size),
                downloads: f.downloads,
                storageTier: f.storageTier,
                createdAt: f.createdAt,
                expiresAt: f.expiresAt,
                downloadUrl: `/api/download/${f._id}`,
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Delete a file
     */
    async deleteFile(fileId, userId) {
        const file = await File.findById(fileId);

        if (!file) {
            throw new NotFoundError('File');
        }

        // Check ownership
        if (file.userId.toString() !== userId.toString()) {
            const User = (await import('../models/User.js')).default;
            const user = await User.findById(userId);

            if (!user || !user.isAdmin()) {
                throw new AuthorizationError('Access denied');
            }
        }

        // Delete from storage
        await storageProvider.delete(file.storageKey, file.storageTier);

        // Soft delete in database
        await file.softDelete();

        // Update quota
        const quota = await Quota.getOrCreate(file.userId);
        await quota.removeFile(file.size);

        // Invalidate cache
        await cacheProvider.delete(`file:${fileId}`);

        logger.info('File deleted', { fileId, userId, size: file.size });

        return { success: true, message: 'File deleted' };
    }

    /**
     * Rename a file
     */
    async renameFile(fileId, userId, newFilename) {
        const file = await File.findById(fileId);

        if (!file) {
            throw new NotFoundError('File');
        }

        // Check ownership
        if (file.userId.toString() !== userId.toString()) {
            const User = (await import('../models/User.js')).default;
            const user = await User.findById(userId);

            if (!user || !user.isAdmin()) {
                throw new AuthorizationError('Access denied');
            }
        }

        // Sanitize filename
        const sanitizedFilename = newFilename
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 255)
            .trim();

        if (!sanitizedFilename) {
            throw new NotFoundError('Invalid filename');
        }

        // Update file
        file.originalName = sanitizedFilename;
        await file.save();

        // Invalidate cache
        await cacheProvider.delete(`file:${fileId}`);

        logger.info('File renamed', { fileId, userId, newFilename: sanitizedFilename });

        return {
            success: true,
            message: 'File renamed',
            filename: sanitizedFilename
        };
    }
}

// Export singleton instance
const downloadService = new DownloadService();
export default downloadService;
