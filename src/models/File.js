/**
 * File Model
 * Stores file metadata and tracking information
 */

import mongoose from 'mongoose';
import { StorageTier } from '../providers/storage/StorageProvider.js';

const fileSchema = new mongoose.Schema({
    // Owner reference
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },

    // Folder reference (null = root)
    folderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Folder',
        default: null,
        index: true,
    },

    // File identification
    storageKey: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },

    // Original file info
    originalName: {
        type: String,
        required: true,
    },
    mimeType: {
        type: String,
        required: true,
    },
    size: {
        type: Number,
        required: true,
    },

    // Integrity
    hash: {
        type: String,
        required: true,
        index: true, // For deduplication queries
    },

    // Storage tier
    storageTier: {
        type: String,
        enum: Object.values(StorageTier),
        default: StorageTier.HOT,
        index: true,
    },

    // Access tracking
    downloads: {
        type: Number,
        default: 0,
        index: true,
    },
    lastDownloadAt: {
        type: Date,
    },
    lastAccessAt: {
        type: Date,
        default: Date.now,
        index: true,
    },

    // Expiry (for free users)
    expiresAt: {
        type: Date,
        index: true,
    },

    // Visibility
    isPublic: {
        type: Boolean,
        default: true,
    },
    password: {
        type: String,
        select: false,
    },

    // Deletion tracking
    isDeleted: {
        type: Boolean,
        default: false,
        index: true,
    },
    deletedAt: {
        type: Date,
    },

    // Migration tracking
    migrationStatus: {
        type: String,
        enum: ['none', 'pending', 'in_progress', 'completed', 'failed'],
        default: 'none',
    },
    lastMigrationAt: {
        type: Date,
    },

    // Metadata
    metadata: {
        type: Map,
        of: String,
        default: {},
    },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (doc, ret) => {
            delete ret.password;
            delete ret.__v;
            return ret;
        },
    },
});

// Compound indexes for common queries
fileSchema.index({ userId: 1, createdAt: -1 });
fileSchema.index({ userId: 1, isDeleted: 1 });
fileSchema.index({ expiresAt: 1, isDeleted: 1 }); // For expiry worker
fileSchema.index({ storageTier: 1, lastAccessAt: 1 }); // For migration worker
fileSchema.index({ downloads: -1, storageTier: 1 }); // For hot file detection

// TTL index for auto-deletion (handled by worker instead for safety)
// fileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Virtual: file URL
 */
fileSchema.virtual('downloadUrl').get(function () {
    return `/api/download/${this._id}`;
});

/**
 * Virtual: is expired
 */
fileSchema.virtual('isExpired').get(function () {
    return this.expiresAt && this.expiresAt < new Date();
});

/**
 * Virtual: friendly size
 */
fileSchema.virtual('friendlySize').get(function () {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = this.size;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
});

/**
 * Increment download count and extend expiry
 */
fileSchema.methods.incrementDownload = async function (extensionDays = 5) {
    const now = new Date();

    this.downloads += 1;
    this.lastDownloadAt = now;
    this.lastAccessAt = now;

    // Extend expiry if set
    if (this.expiresAt) {
        const newExpiry = new Date(now.getTime() + extensionDays * 24 * 60 * 60 * 1000);
        if (newExpiry > this.expiresAt) {
            this.expiresAt = newExpiry;
        }
    }

    await this.save();
};

/**
 * Mark as deleted (soft delete)
 */
fileSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
};

/**
 * Update storage tier
 */
fileSchema.methods.updateTier = async function (newTier) {
    this.storageTier = newTier;
    this.lastMigrationAt = new Date();
    this.migrationStatus = 'completed';
    await this.save();
};

/**
 * Static: Find user files
 */
fileSchema.statics.findUserFiles = function (userId, options = {}) {
    const query = this.find({
        userId,
        isDeleted: false,
    });

    if (options.sort) {
        query.sort(options.sort);
    } else {
        query.sort({ createdAt: -1 });
    }

    if (options.limit) {
        query.limit(options.limit);
    }

    if (options.skip) {
        query.skip(options.skip);
    }

    return query;
};

/**
 * Static: Find expired files
 */
fileSchema.statics.findExpiredFiles = function (limit = 100) {
    return this.find({
        expiresAt: { $lte: new Date() },
        isDeleted: false,
    })
        .sort({ expiresAt: 1 })
        .limit(limit);
};

/**
 * Static: Find files eligible for cold migration
 */
fileSchema.statics.findColdMigrationCandidates = function (daysInactive, limit = 100) {
    const cutoffDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);

    return this.find({
        storageTier: StorageTier.HOT,
        lastAccessAt: { $lte: cutoffDate },
        isDeleted: false,
        migrationStatus: { $nin: ['pending', 'in_progress'] },
    })
        .sort({ lastAccessAt: 1 })
        .limit(limit);
};

/**
 * Static: Find files eligible for hot migration
 */
fileSchema.statics.findHotMigrationCandidates = function (downloadThreshold, limit = 100) {
    const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    return this.find({
        storageTier: StorageTier.COLD,
        downloads: { $gte: downloadThreshold },
        lastDownloadAt: { $gte: recentDate },
        isDeleted: false,
        migrationStatus: { $nin: ['pending', 'in_progress'] },
    })
        .sort({ downloads: -1 })
        .limit(limit);
};

/**
 * Static: Get user storage usage
 */
fileSchema.statics.getUserStorageUsage = async function (userId) {
    const result = await this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                isDeleted: false,
            },
        },
        {
            $group: {
                _id: '$userId',
                totalSize: { $sum: '$size' },
                fileCount: { $sum: 1 },
            },
        },
    ]);

    return result[0] || { totalSize: 0, fileCount: 0 };
};

/**
 * Static: Find by hash (for deduplication)
 */
fileSchema.statics.findByHash = function (hash) {
    return this.findOne({ hash, isDeleted: false });
};

const File = mongoose.model('File', fileSchema);

export default File;
