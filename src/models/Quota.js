/**
 * Quota Model
 * Tracks and enforces user storage quotas
 */

import mongoose from 'mongoose';
import config from '../config/index.js';
import { UserRole } from './User.js';

/**
 * Default quotas by role
 */
export const DefaultQuotas = {
    [UserRole.FREE]: {
        maxStorage: 50 * 1024 * 1024 * 1024,      // 50 GB
        maxFileSize: config.upload.maxFileSizeFree, // 10 GB
        maxFiles: 1000,
        bandwidthPriority: 'low',
    },
    [UserRole.PREMIUM]: {
        maxStorage: -1,                              // Unlimited
        maxFileSize: config.upload.maxFileSizePremium, // Unlimited
        maxFiles: -1,                                // Unlimited
        bandwidthPriority: 'high',
    },
    [UserRole.ADMIN]: {
        maxStorage: -1,
        maxFileSize: -1,
        maxFiles: -1,
        bandwidthPriority: 'highest',
    },
};

const quotaSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },

    // Limits (null = use role default)
    limits: {
        maxStorage: {
            type: Number,
            default: null,
        },
        maxFileSize: {
            type: Number,
            default: null,
        },
        maxFiles: {
            type: Number,
            default: null,
        },
    },

    // Current usage
    usage: {
        storage: {
            type: Number,
            default: 0,
        },
        files: {
            type: Number,
            default: 0,
        },
        bandwidth: {
            daily: { type: Number, default: 0 },
            monthly: { type: Number, default: 0 },
            lastReset: { type: Date, default: Date.now },
        },
    },

    // Overages (for soft limits)
    isOverQuota: {
        type: Boolean,
        default: false,
    },
    overQuotaSince: {
        type: Date,
    },
}, {
    timestamps: true,
});

/**
 * Get effective limit (custom or role default)
 */
quotaSchema.methods.getEffectiveLimit = async function (limitType) {
    const customLimit = this.limits[limitType];
    if (customLimit !== null) {
        return customLimit;
    }

    const user = await mongoose.model('User').findById(this.userId);
    if (!user) {
        return DefaultQuotas[UserRole.FREE][limitType];
    }

    return DefaultQuotas[user.role][limitType];
};

/**
 * Check if storage usage is within limit
 */
quotaSchema.methods.canUpload = async function (fileSize) {
    const maxStorage = await this.getEffectiveLimit('maxStorage');
    const maxFileSize = await this.getEffectiveLimit('maxFileSize');
    const maxFiles = await this.getEffectiveLimit('maxFiles');

    const result = {
        allowed: true,
        reasons: [],
    };

    // Check file size limit
    if (maxFileSize !== -1 && fileSize > maxFileSize) {
        result.allowed = false;
        result.reasons.push({
            code: 'FILE_TOO_LARGE',
            message: `File exceeds maximum size of ${formatBytes(maxFileSize)}`,
            limit: maxFileSize,
            current: fileSize,
        });
    }

    // Check total storage limit
    if (maxStorage !== -1 && (this.usage.storage + fileSize) > maxStorage) {
        result.allowed = false;
        result.reasons.push({
            code: 'STORAGE_EXCEEDED',
            message: `Upload would exceed storage quota of ${formatBytes(maxStorage)}`,
            limit: maxStorage,
            current: this.usage.storage,
            required: fileSize,
        });
    }

    // Check file count limit
    if (maxFiles !== -1 && this.usage.files >= maxFiles) {
        result.allowed = false;
        result.reasons.push({
            code: 'FILE_COUNT_EXCEEDED',
            message: `Maximum file count of ${maxFiles} reached`,
            limit: maxFiles,
            current: this.usage.files,
        });
    }

    return result;
};

/**
 * Update usage after upload
 */
quotaSchema.methods.addFile = async function (fileSize) {
    this.usage.storage += fileSize;
    this.usage.files += 1;

    // Check if over quota
    const maxStorage = await this.getEffectiveLimit('maxStorage');
    if (maxStorage !== -1 && this.usage.storage > maxStorage) {
        this.isOverQuota = true;
        if (!this.overQuotaSince) {
            this.overQuotaSince = new Date();
        }
    }

    await this.save();
};

/**
 * Update usage after delete
 */
quotaSchema.methods.removeFile = async function (fileSize) {
    this.usage.storage = Math.max(0, this.usage.storage - fileSize);
    this.usage.files = Math.max(0, this.usage.files - 1);

    // Check if back under quota
    const maxStorage = await this.getEffectiveLimit('maxStorage');
    if (maxStorage === -1 || this.usage.storage <= maxStorage) {
        this.isOverQuota = false;
        this.overQuotaSince = null;
    }

    await this.save();
};

/**
 * Track bandwidth usage
 */
quotaSchema.methods.addBandwidth = async function (bytes) {
    // Reset daily counter if needed
    const now = new Date();
    const lastReset = this.usage.bandwidth.lastReset;

    if (!lastReset || now.getDate() !== lastReset.getDate()) {
        this.usage.bandwidth.daily = 0;

        // Reset monthly if new month
        if (!lastReset || now.getMonth() !== lastReset.getMonth()) {
            this.usage.bandwidth.monthly = 0;
        }

        this.usage.bandwidth.lastReset = now;
    }

    this.usage.bandwidth.daily += bytes;
    this.usage.bandwidth.monthly += bytes;

    await this.save();
};

/**
 * Get usage summary
 */
quotaSchema.methods.getSummary = async function () {
    const maxStorage = await this.getEffectiveLimit('maxStorage');
    const maxFiles = await this.getEffectiveLimit('maxFiles');

    return {
        storage: {
            used: this.usage.storage,
            limit: maxStorage,
            percentage: maxStorage === -1 ? 0 : (this.usage.storage / maxStorage) * 100,
            unlimited: maxStorage === -1,
        },
        files: {
            count: this.usage.files,
            limit: maxFiles,
            percentage: maxFiles === -1 ? 0 : (this.usage.files / maxFiles) * 100,
            unlimited: maxFiles === -1,
        },
        bandwidth: {
            daily: this.usage.bandwidth.daily,
            monthly: this.usage.bandwidth.monthly,
        },
        isOverQuota: this.isOverQuota,
        overQuotaSince: this.overQuotaSince,
    };
};

/**
 * Static: Get or create quota for user
 */
quotaSchema.statics.getOrCreate = async function (userId) {
    let quota = await this.findOne({ userId });

    if (!quota) {
        quota = await this.create({ userId });
    }

    return quota;
};

/**
 * Static: Sync usage from files (recalculate)
 */
quotaSchema.statics.syncUsage = async function (userId) {
    const File = mongoose.model('File');

    const usage = await File.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                isDeleted: false,
            },
        },
        {
            $group: {
                _id: null,
                totalStorage: { $sum: '$size' },
                fileCount: { $sum: 1 },
            },
        },
    ]);

    const stats = usage[0] || { totalStorage: 0, fileCount: 0 };

    await this.findOneAndUpdate(
        { userId },
        {
            $set: {
                'usage.storage': stats.totalStorage,
                'usage.files': stats.fileCount,
            },
        },
        { upsert: true }
    );

    return stats;
};

/**
 * Helper: Format bytes
 */
function formatBytes(bytes) {
    if (bytes === -1) return 'Unlimited';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

const Quota = mongoose.model('Quota', quotaSchema);

export default Quota;
