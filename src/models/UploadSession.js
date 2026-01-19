/**
 * Upload Session Model
 * Tracks chunked upload progress (stored in Redis for performance)
 * MongoDB model for persistence and recovery
 */

import mongoose from 'mongoose';

const uploadSessionSchema = new mongoose.Schema({
    // Session identification
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },

    // Owner
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },

    // File info
    filename: {
        type: String,
        required: true,
    },
    mimeType: {
        type: String,
        required: true,
    },
    totalSize: {
        type: Number,
        required: true,
    },
    expectedHash: {
        type: String,
        required: false,  // Optional - frontend skips hash for large files
    },

    // Target folder (null = root)
    folderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Folder',
        default: null,
    },

    // Chunking
    chunkSize: {
        type: Number,
        required: true,
    },
    totalChunks: {
        type: Number,
        required: true,
    },
    completedChunks: [{
        index: Number,
        size: Number,
        hash: String,
        completedAt: Date,
    }],

    // Status
    status: {
        type: String,
        enum: ['pending', 'uploading', 'assembling', 'completed', 'failed', 'expired'],
        default: 'pending',
        index: true,
    },

    // Error tracking
    error: {
        message: String,
        code: String,
        chunkIndex: Number,
    },

    // Result (after completion)
    fileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
    },
    storageTier: {
        type: String,
    },

    // Timestamps
    startedAt: {
        type: Date,
        default: Date.now,
    },
    lastActivityAt: {
        type: Date,
        default: Date.now,
    },
    completedAt: {
        type: Date,
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true,
    },
}, {
    timestamps: true,
});

// TTL index for auto-cleanup of old sessions
uploadSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes
uploadSessionSchema.index({ userId: 1, status: 1 });

/**
 * Virtual: upload progress percentage
 */
uploadSessionSchema.virtual('progress').get(function () {
    return (this.completedChunks.length / this.totalChunks) * 100;
});

/**
 * Virtual: is complete
 */
uploadSessionSchema.virtual('isComplete').get(function () {
    return this.completedChunks.length === this.totalChunks;
});

/**
 * Virtual: remaining chunks
 */
uploadSessionSchema.virtual('remainingChunks').get(function () {
    const completed = new Set(this.completedChunks.map(c => c.index));
    const remaining = [];

    for (let i = 0; i < this.totalChunks; i++) {
        if (!completed.has(i)) {
            remaining.push(i);
        }
    }

    return remaining;
});

/**
 * Mark chunk as completed
 */
uploadSessionSchema.methods.markChunkComplete = async function (index, size, hash) {
    // Check if already completed
    if (this.completedChunks.some(c => c.index === index)) {
        return false;
    }

    this.completedChunks.push({
        index,
        size,
        hash,
        completedAt: new Date(),
    });

    this.lastActivityAt = new Date();
    this.status = 'uploading';

    await this.save();
    return true;
};

/**
 * Mark as assembling
 */
uploadSessionSchema.methods.startAssembly = async function () {
    this.status = 'assembling';
    this.lastActivityAt = new Date();
    await this.save();
};

/**
 * Mark as completed
 */
uploadSessionSchema.methods.markCompleted = async function (fileId, storageTier) {
    this.status = 'completed';
    this.fileId = fileId;
    this.storageTier = storageTier;
    this.completedAt = new Date();
    await this.save();
};

/**
 * Mark as failed
 */
uploadSessionSchema.methods.markFailed = async function (error, chunkIndex = null) {
    this.status = 'failed';
    this.error = {
        message: error.message || error,
        code: error.code || 'UNKNOWN',
        chunkIndex,
    };
    await this.save();
};

/**
 * Check if chunk is already completed
 */
uploadSessionSchema.methods.isChunkCompleted = function (index) {
    return this.completedChunks.some(c => c.index === index);
};

/**
 * Get chunk info
 */
uploadSessionSchema.methods.getChunkInfo = function (index) {
    return this.completedChunks.find(c => c.index === index);
};

/**
 * Static: Find active sessions for user
 */
uploadSessionSchema.statics.findActiveSessions = function (userId, limit = 10) {
    return this.find({
        userId,
        status: { $in: ['pending', 'uploading'] },
        expiresAt: { $gt: new Date() },
    })
        .sort({ lastActivityAt: -1 })
        .limit(limit);
};

/**
 * Static: Find expired sessions for cleanup
 */
uploadSessionSchema.statics.findExpiredSessions = function (limit = 100) {
    return this.find({
        status: { $in: ['pending', 'uploading', 'assembling'] },
        expiresAt: { $lte: new Date() },
    })
        .sort({ expiresAt: 1 })
        .limit(limit);
};

/**
 * Static: Clean up old completed/failed sessions
 */
uploadSessionSchema.statics.cleanupOldSessions = async function (daysOld = 7) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await this.deleteMany({
        status: { $in: ['completed', 'failed', 'expired'] },
        updatedAt: { $lt: cutoff },
    });

    return result.deletedCount;
};

const UploadSession = mongoose.model('UploadSession', uploadSessionSchema);

export default UploadSession;
