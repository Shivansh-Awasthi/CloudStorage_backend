/**
 * Upload Cleanup Service
 * Cleans up expired upload sessions and their temp chunks
 */
import fs from 'fs/promises';
import path from 'path';
import { UploadSession } from '../models/index.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

class UploadCleanupService {
    constructor() {
        this.tempDir = path.join(config.storage.ssdPath, 'temp');
        this.cleanupInterval = null;
    }

    /**
     * Start the cleanup scheduler
     */
    start() {
        // Run cleanup every 30 minutes
        const interval = 30 * 60 * 1000;
        this.cleanupInterval = setInterval(() => this.cleanup(), interval);

        // Also run immediately on start
        this.cleanup();

        logger.info('Upload cleanup service started', { intervalMs: interval });
    }

    /**
     * Stop the cleanup scheduler
     */
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        logger.info('Upload cleanup service stopped');
    }

    /**
     * Clean up expired sessions and orphaned temp folders
     */
    async cleanup() {
        try {
            logger.info('Starting upload cleanup');

            // 1. Find and delete expired sessions from database
            const expiredSessions = await UploadSession.find({
                $or: [
                    { expiresAt: { $lt: new Date() } },
                    { status: 'failed' },
                    // Delete sessions that have been pending for more than 24 hours
                    {
                        status: 'uploading',
                        createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                    }
                ]
            }).limit(100);

            let sessionsCleaned = 0;
            let foldersCleaned = 0;
            let bytesFreed = 0;

            for (const session of expiredSessions) {
                try {
                    // Delete temp folder for this session
                    const sessionDir = path.join(this.tempDir, session.sessionId);
                    const stats = await this._deleteDirectory(sessionDir);
                    bytesFreed += stats.bytes;
                    foldersCleaned += stats.deleted ? 1 : 0;

                    // Delete session from database
                    await UploadSession.deleteOne({ _id: session._id });
                    sessionsCleaned++;
                } catch (err) {
                    logger.error('Failed to clean up session', {
                        sessionId: session.sessionId,
                        error: err.message
                    });
                }
            }

            // 2. Clean up orphaned temp folders (folders with no matching session)
            const orphaned = await this._cleanOrphanedFolders();
            foldersCleaned += orphaned.folders;
            bytesFreed += orphaned.bytes;

            logger.info('Upload cleanup completed', {
                sessionsCleaned,
                foldersCleaned,
                bytesFreed: this._formatBytes(bytesFreed)
            });

        } catch (error) {
            logger.error('Upload cleanup failed', { error: error.message });
        }
    }

    /**
     * Clean up orphaned temp folders
     */
    async _cleanOrphanedFolders() {
        let folders = 0;
        let bytes = 0;

        try {
            const entries = await fs.readdir(this.tempDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const sessionId = entry.name;
                const session = await UploadSession.findOne({ sessionId });

                // If no session exists and folder is older than 1 hour, delete it
                if (!session) {
                    const folderPath = path.join(this.tempDir, sessionId);
                    const stat = await fs.stat(folderPath);
                    const ageMs = Date.now() - stat.mtimeMs;

                    // Only delete if folder is older than 1 hour
                    if (ageMs > 60 * 60 * 1000) {
                        const stats = await this._deleteDirectory(folderPath);
                        if (stats.deleted) {
                            folders++;
                            bytes += stats.bytes;
                            logger.info('Deleted orphaned temp folder', { sessionId });
                        }
                    }
                }
            }
        } catch (error) {
            // Temp dir might not exist yet
            if (error.code !== 'ENOENT') {
                logger.error('Failed to clean orphaned folders', { error: error.message });
            }
        }

        return { folders, bytes };
    }

    /**
     * Delete a directory and return stats
     */
    async _deleteDirectory(dirPath) {
        try {
            const stat = await fs.stat(dirPath);
            if (!stat.isDirectory()) {
                return { deleted: false, bytes: 0 };
            }

            // Calculate size before deleting
            let bytes = await this._getDirectorySize(dirPath);

            await fs.rm(dirPath, { recursive: true, force: true });
            return { deleted: true, bytes };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { deleted: false, bytes: 0 };
            }
            throw error;
        }
    }

    /**
     * Get total size of a directory
     */
    async _getDirectorySize(dirPath) {
        let size = 0;
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isFile()) {
                    const stat = await fs.stat(entryPath);
                    size += stat.size;
                } else if (entry.isDirectory()) {
                    size += await this._getDirectorySize(entryPath);
                }
            }
        } catch {
            // Ignore errors
        }
        return size;
    }

    /**
     * Format bytes for logging
     */
    _formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
}

const uploadCleanupService = new UploadCleanupService();
export default uploadCleanupService;
