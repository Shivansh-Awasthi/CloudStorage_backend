/**
 * User Model
 * Stores user accounts with roles and authentication
 */

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

/**
 * User roles enum
 */
export const UserRole = {
    FREE: 'free',
    PREMIUM: 'premium',
    ADMIN: 'admin',
};

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
    },
    password: {
        type: String,
        required: true,
        select: false, // Don't include password by default
    },
    role: {
        type: String,
        enum: Object.values(UserRole),
        default: UserRole.FREE,
        index: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    lastLogin: {
        type: Date,
    },
    refreshTokens: [{
        token: String,
        expiresAt: Date,
        createdAt: { type: Date, default: Date.now },
    }],
    // Rate limiting / abuse tracking
    failedLoginAttempts: {
        type: Number,
        default: 0,
    },
    lockoutUntil: {
        type: Date,
    },
    // Storage quota (overrides defaults based on role)
    quotaOverride: {
        maxStorage: Number,       // Bytes, null = use role default
        maxFileSize: Number,      // Bytes, null = use role default
    },
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (doc, ret) => {
            delete ret.password;
            delete ret.refreshTokens;
            delete ret.__v;
            return ret;
        },
    },
});

// Indexes
userSchema.index({ createdAt: 1 });
userSchema.index({ 'refreshTokens.token': 1 });
userSchema.index({ 'refreshTokens.expiresAt': 1 }, { expireAfterSeconds: 0 });

/**
 * Pre-save hook to hash password
 */
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

/**
 * Compare password
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
    // Need to explicitly select password since it's excluded by default
    const user = await mongoose.model('User').findById(this._id).select('+password');
    if (!user || !user.password) return false;
    return bcrypt.compare(candidatePassword, user.password);
};

/**
 * Check if user is locked out
 */
userSchema.methods.isLockedOut = function () {
    return this.lockoutUntil && this.lockoutUntil > new Date();
};

/**
 * Increment failed login attempts
 */
userSchema.methods.incrementFailedLogins = async function () {
    this.failedLoginAttempts += 1;

    // Lock account after 5 failed attempts
    if (this.failedLoginAttempts >= 5) {
        this.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    }

    await this.save();
};

/**
 * Reset failed login attempts
 */
userSchema.methods.resetFailedLogins = async function () {
    if (this.failedLoginAttempts > 0 || this.lockoutUntil) {
        this.failedLoginAttempts = 0;
        this.lockoutUntil = null;
        await this.save();
    }
};

/**
 * Add refresh token
 */
userSchema.methods.addRefreshToken = async function (token, expiresAt) {
    // Limit to 5 active refresh tokens per user
    if (this.refreshTokens.length >= 5) {
        this.refreshTokens = this.refreshTokens.slice(-4);
    }

    this.refreshTokens.push({ token, expiresAt });
    await this.save();
};

/**
 * Remove refresh token
 */
userSchema.methods.removeRefreshToken = async function (token) {
    this.refreshTokens = this.refreshTokens.filter(t => t.token !== token);
    await this.save();
};

/**
 * Remove all refresh tokens (logout all devices)
 */
userSchema.methods.removeAllRefreshTokens = async function () {
    this.refreshTokens = [];
    await this.save();
};

/**
 * Validate refresh token
 */
userSchema.methods.validateRefreshToken = function (token) {
    const tokenDoc = this.refreshTokens.find(t => t.token === token);
    if (!tokenDoc) return false;
    if (tokenDoc.expiresAt < new Date()) {
        // Token expired, remove it
        this.refreshTokens = this.refreshTokens.filter(t => t.token !== token);
        this.save(); // Fire and forget
        return false;
    }
    return true;
};

/**
 * Check if user is premium or admin
 */
userSchema.methods.isPremiumOrAdmin = function () {
    return this.role === UserRole.PREMIUM || this.role === UserRole.ADMIN;
};

/**
 * Check if user is admin
 */
userSchema.methods.isAdmin = function () {
    return this.role === UserRole.ADMIN;
};

/**
 * Static: Find by email
 */
userSchema.statics.findByEmail = function (email) {
    return this.findOne({ email: email.toLowerCase() });
};

const User = mongoose.model('User', userSchema);

export default User;
