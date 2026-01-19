/**
 * Storage Tier Service
 * Manages SSD/HDD tiered storage and migrations
 */

import config from '../config/index.js';
import { File } from '../models/index.js';
import storageProvider, { StorageTier } from '../providers/storage/index.js';
import logger from '../utils/logger.js';

class StorageTierService {
    /**
     * Determine initial storage tier for a file
     */
    async getInitialTier(userId) {
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(userId);

        // All new files start on SSD for fast initial access
        // Migration to HDD happens via background worker
        return StorageTier.HOT;
    }

    /**
     * Check if file should be migrated to cold storage
     */
    async shouldMigrateToCold(file) {
        // Don't migrate premium user files
        const User = (await import('../models/User.js')).default;
        const user = await User.findById(file.userId);

        if (user && user.isPremiumOrAdmin()) {
            return false;
        }

        // Already on cold storage
        if (file.storageTier === StorageTier.COLD) {
            return false;
        }

        // Check last access time
        const inactiveDays = config.tierMigration.hotToColdDays;
        const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

        return file.lastAccessAt < cutoffDate;
    }

    /**
     * Check if file should be migrated to hot storage
     */
    async shouldMigrateToHot(file) {
        // Already on hot storage
        if (file.storageTier === StorageTier.HOT) {
            return false;
        }

        // Check recent download activity
        const downloadThreshold = config.tierMigration.coldToHotDownloads;
        const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // File has high recent download activity
        if (file.lastDownloadAt && file.lastDownloadAt >= recentDate) {
            return file.downloads >= downloadThreshold;
        }

        return false;
    }

    /**
     * Migrate a file between tiers
     */
    async migrateFile(fileId, targetTier) {
        const file = await File.findById(fileId);

        if (!file) {
            throw new Error(`File not found: ${fileId}`);
        }

        const sourceTier = file.storageTier;

        if (sourceTier === targetTier) {
            logger.debug('File already on target tier', { fileId, tier: targetTier });
            return { success: true, message: 'Already on target tier' };
        }

        // Mark as pending migration
        file.migrationStatus = 'in_progress';
        await file.save();

        try {
            // Perform migration
            await storageProvider.migrate(file.storageKey, sourceTier, targetTier);

            // Update file record
            await file.updateTier(targetTier);

            logger.info('File migrated', {
                fileId,
                storageKey: file.storageKey,
                from: sourceTier,
                to: targetTier,
            });

            return {
                success: true,
                from: sourceTier,
                to: targetTier,
            };
        } catch (error) {
            // Mark migration as failed
            file.migrationStatus = 'failed';
            await file.save();

            logger.error('File migration failed', {
                fileId,
                from: sourceTier,
                to: targetTier,
                error: error.message,
            });

            throw error;
        }
    }

    /**
     * Get files eligible for cold migration
     */
    async getColdMigrationCandidates(limit = 100) {
        return File.findColdMigrationCandidates(
            config.tierMigration.hotToColdDays,
            limit
        );
    }

    /**
     * Get files eligible for hot migration
     */
    async getHotMigrationCandidates(limit = 100) {
        return File.findHotMigrationCandidates(
            config.tierMigration.coldToHotDownloads,
            limit
        );
    }

    /**
     * Get storage tier statistics
     */
    async getStats() {
        const [hotStats, coldStats] = await Promise.all([
            File.aggregate([
                { $match: { storageTier: StorageTier.HOT, isDeleted: false } },
                { $group: { _id: null, count: { $sum: 1 }, size: { $sum: '$size' } } },
            ]),
            File.aggregate([
                { $match: { storageTier: StorageTier.COLD, isDeleted: false } },
                { $group: { _id: null, count: { $sum: 1 }, size: { $sum: '$size' } } },
            ]),
        ]);

        const hot = hotStats[0] || { count: 0, size: 0 };
        const cold = coldStats[0] || { count: 0, size: 0 };

        const providerStats = await storageProvider.getStats();

        return {
            hot: {
                fileCount: hot.count,
                totalSize: hot.size,
                friendlySize: this._formatBytes(hot.size),
            },
            cold: {
                fileCount: cold.count,
                totalSize: cold.size,
                friendlySize: this._formatBytes(cold.size),
            },
            total: {
                fileCount: hot.count + cold.count,
                totalSize: hot.size + cold.size,
                friendlySize: this._formatBytes(hot.size + cold.size),
            },
            storage: providerStats,
        };
    }

    /**
     * Force migrate a file (admin only)
     */
    async forceMigrate(fileId, targetTier) {
        return this.migrateFile(fileId, targetTier);
    }

    /**
     * Format bytes helper
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
}

// Export singleton instance
const storageTierService = new StorageTierService();
export default storageTierService;
