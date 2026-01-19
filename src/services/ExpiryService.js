/**
 * Expiry Service
 * Manages file expiration and cleanup
 */

import config from '../config/index.js';
import { File, Quota } from '../models/index.js';
import storageProvider from '../providers/storage/index.js';
import cacheProvider from '../providers/cache/index.js';
import logger from '../utils/logger.js';

class ExpiryService {
    /**
     * Get expired files for cleanup
     */
    async getExpiredFiles(limit = 100) {
        return File.findExpiredFiles(limit);
    }

    /**
     * Check if file is expired
     */
    isExpired(file) {
        return file.expiresAt && file.expiresAt < new Date();
    }

    /**
     * Extend file expiry
     */
    async extendExpiry(fileId, days = null) {
        const extensionDays = days || config.expiry.extensionDays;

        const file = await File.findById(fileId);
        if (!file) {
            throw new Error(`File not found: ${fileId}`);
        }

        if (!file.expiresAt) {
            // File doesn't expire (premium user)
            return { success: true, message: 'File does not expire' };
        }

        const newExpiry = new Date(Date.now() + extensionDays * 24 * 60 * 60 * 1000);

        // Only extend if new date is later
        if (newExpiry > file.expiresAt) {
            file.expiresAt = newExpiry;
            await file.save();

            // Invalidate cache
            await cacheProvider.delete(`file:${fileId}`);

            logger.debug('File expiry extended', { fileId, newExpiry });
        }

        return {
            success: true,
            expiresAt: file.expiresAt,
        };
    }

    /**
     * Remove expiry from file (for premium upgrade)
     */
    async removeExpiry(fileId) {
        const file = await File.findById(fileId);
        if (!file) {
            throw new Error(`File not found: ${fileId}`);
        }

        file.expiresAt = null;
        await file.save();

        // Invalidate cache
        await cacheProvider.delete(`file:${fileId}`);

        logger.info('File expiry removed', { fileId });

        return { success: true, message: 'Expiry removed' };
    }

    /**
     * Set expiry on file (for premium downgrade)
     */
    async setExpiry(fileId, days = null) {
        const expiryDays = days || config.expiry.daysFree;

        const file = await File.findById(fileId);
        if (!file) {
            throw new Error(`File not found: ${fileId}`);
        }

        file.expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
        await file.save();

        // Invalidate cache
        await cacheProvider.delete(`file:${fileId}`);

        logger.info('File expiry set', { fileId, expiresAt: file.expiresAt });

        return {
            success: true,
            expiresAt: file.expiresAt,
        };
    }

    /**
     * Delete an expired file
     */
    async deleteExpiredFile(fileId) {
        const file = await File.findById(fileId);

        if (!file) {
            return { success: false, message: 'File not found' };
        }

        if (!this.isExpired(file)) {
            return { success: false, message: 'File not expired' };
        }

        return this._deleteFile(file);
    }

    /**
     * Delete file (internal)
     */
    async _deleteFile(file) {
        try {
            // Delete from storage
            await storageProvider.delete(file.storageKey, file.storageTier);

            // Soft delete in database
            await file.softDelete();

            // Update quota
            const quota = await Quota.getOrCreate(file.userId);
            await quota.removeFile(file.size);

            // Invalidate cache
            await cacheProvider.delete(`file:${file._id}`);

            logger.info('Expired file deleted', {
                fileId: file._id,
                storageKey: file.storageKey,
                size: file.size,
                userId: file.userId,
            });

            return { success: true, fileId: file._id };
        } catch (error) {
            logger.error('Failed to delete expired file', {
                fileId: file._id,
                error: error.message,
            });

            return { success: false, error: error.message };
        }
    }

    /**
     * Process batch of expired files
     */
    async processExpiredBatch(limit = 100) {
        const files = await this.getExpiredFiles(limit);

        const results = {
            processed: 0,
            deleted: 0,
            failed: 0,
            errors: [],
        };

        for (const file of files) {
            results.processed++;

            const result = await this.deleteExpiredFile(file._id);

            if (result.success) {
                results.deleted++;
            } else {
                results.failed++;
                results.errors.push({
                    fileId: file._id,
                    error: result.message || result.error,
                });
            }
        }

        if (results.processed > 0) {
            logger.info('Expiry batch processed', results);
        }

        return results;
    }

    /**
     * Get expiry statistics
     */
    async getStats() {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const [expired, expiringToday, expiringWeek, noExpiry] = await Promise.all([
            File.countDocuments({
                expiresAt: { $lte: now },
                isDeleted: false,
            }),
            File.countDocuments({
                expiresAt: { $gt: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
                isDeleted: false,
            }),
            File.countDocuments({
                expiresAt: { $gt: now, $lte: oneWeekFromNow },
                isDeleted: false,
            }),
            File.countDocuments({
                expiresAt: null,
                isDeleted: false,
            }),
        ]);

        return {
            expired,
            expiringToday,
            expiringWeek,
            noExpiry,
        };
    }
}

// Export singleton instance
const expiryService = new ExpiryService();
export default expiryService;
