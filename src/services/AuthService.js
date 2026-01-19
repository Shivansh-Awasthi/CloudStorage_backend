/**
 * Authentication Service
 * Handles JWT token generation, validation, and refresh
 */

import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { User } from '../models/index.js';
import { sessionClient } from '../config/redis.js';
import { generateToken } from '../utils/hash.js';
import {
    AuthenticationError,
    ValidationError,
    ConflictError,
} from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Token types
 */
const TokenType = {
    ACCESS: 'access',
    REFRESH: 'refresh',
};

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration) {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 60 * 60 * 1000; // Default 1 hour

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
}

class AuthService {
    /**
     * Register a new user
     */
    async register(email, password) {
        // Validate input
        if (!email || !password) {
            throw new ValidationError('Email and password are required');
        }

        if (password.length < 8) {
            throw new ValidationError('Password must be at least 8 characters');
        }

        // Check for existing user
        const existing = await User.findByEmail(email);
        if (existing) {
            throw new ConflictError('Email already registered');
        }

        // Create user
        const user = new User({ email, password });
        await user.save();

        logger.info('User registered', { userId: user._id, email: user.email });

        // Generate tokens
        const tokens = await this.generateTokens(user);

        return {
            user: user.toJSON(),
            ...tokens,
        };
    }

    /**
     * Login user
     */
    async login(email, password) {
        // Validate input
        if (!email || !password) {
            throw new ValidationError('Email and password are required');
        }

        // Find user
        const user = await User.findByEmail(email);
        if (!user) {
            throw new AuthenticationError('Invalid email or password');
        }

        // Check lockout
        if (user.isLockedOut()) {
            throw new AuthenticationError('Account is temporarily locked. Try again later.');
        }

        // Verify password
        const isValid = await user.comparePassword(password);
        if (!isValid) {
            await user.incrementFailedLogins();
            throw new AuthenticationError('Invalid email or password');
        }

        // Reset failed attempts and update last login
        await user.resetFailedLogins();
        user.lastLogin = new Date();
        await user.save();

        // Generate tokens
        const tokens = await this.generateTokens(user);

        logger.info('User logged in', { userId: user._id, email: user.email });

        return {
            user: user.toJSON(),
            ...tokens,
        };
    }

    /**
     * Logout user (invalidate refresh token)
     */
    async logout(userId, refreshToken) {
        const user = await User.findById(userId);
        if (user && refreshToken) {
            await user.removeRefreshToken(refreshToken);

            // Blacklist the access token
            // (In production, you might want to blacklist the access token in Redis)
        }

        logger.info('User logged out', { userId });
    }

    /**
     * Logout from all devices
     */
    async logoutAll(userId) {
        const user = await User.findById(userId);
        if (user) {
            await user.removeAllRefreshTokens();
        }

        logger.info('User logged out from all devices', { userId });
    }

    /**
     * Refresh access token
     */
    async refreshToken(refreshToken) {
        if (!refreshToken) {
            throw new AuthenticationError('Refresh token required');
        }

        try {
            // Verify refresh token
            const payload = jwt.verify(refreshToken, config.jwt.refreshSecret);

            if (payload.type !== TokenType.REFRESH) {
                throw new AuthenticationError('Invalid token type');
            }

            // Find user and validate refresh token
            const user = await User.findById(payload.sub);
            if (!user || !user.isActive) {
                throw new AuthenticationError('User not found or inactive');
            }

            // Check if refresh token exists in user's tokens
            if (!user.validateRefreshToken(refreshToken)) {
                throw new AuthenticationError('Refresh token revoked or expired');
            }

            // Generate new tokens (token rotation)
            await user.removeRefreshToken(refreshToken);
            const tokens = await this.generateTokens(user);

            logger.debug('Token refreshed', { userId: user._id });

            return {
                user: user.toJSON(),
                ...tokens,
            };
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new AuthenticationError('Refresh token expired');
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthenticationError('Invalid refresh token');
            }
            throw error;
        }
    }

    /**
     * Verify access token
     */
    async verifyAccessToken(token) {
        if (!token) {
            throw new AuthenticationError('Access token required');
        }

        try {
            const payload = jwt.verify(token, config.jwt.accessSecret);

            if (payload.type !== TokenType.ACCESS) {
                throw new AuthenticationError('Invalid token type');
            }

            // Check if token is blacklisted
            const isBlacklisted = await this.isTokenBlacklisted(token);
            if (isBlacklisted) {
                throw new AuthenticationError('Token has been revoked');
            }

            return payload;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new AuthenticationError('Access token expired');
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthenticationError('Invalid access token');
            }
            throw error;
        }
    }

    /**
     * Get user from token
     */
    async getUserFromToken(token) {
        const payload = await this.verifyAccessToken(token);

        const user = await User.findById(payload.sub);
        if (!user || !user.isActive) {
            throw new AuthenticationError('User not found or inactive');
        }

        return user;
    }

    /**
     * Generate access and refresh tokens
     */
    async generateTokens(user) {
        const accessToken = this.generateAccessToken(user);
        const refreshToken = this.generateRefreshToken(user);

        // Calculate refresh token expiry
        const refreshExpiresIn = parseDuration(config.jwt.refreshExpiresIn);
        const expiresAt = new Date(Date.now() + refreshExpiresIn);

        // Store refresh token
        await user.addRefreshToken(refreshToken, expiresAt);

        return {
            accessToken,
            refreshToken,
            expiresIn: parseDuration(config.jwt.accessExpiresIn) / 1000, // In seconds
        };
    }

    /**
     * Generate access token
     */
    generateAccessToken(user) {
        return jwt.sign(
            {
                sub: user._id.toString(),
                email: user.email,
                role: user.role,
                type: TokenType.ACCESS,
            },
            config.jwt.accessSecret,
            { expiresIn: config.jwt.accessExpiresIn }
        );
    }

    /**
     * Generate refresh token
     */
    generateRefreshToken(user) {
        const tokenId = generateToken(16);

        return jwt.sign(
            {
                sub: user._id.toString(),
                jti: tokenId,
                type: TokenType.REFRESH,
            },
            config.jwt.refreshSecret,
            { expiresIn: config.jwt.refreshExpiresIn }
        );
    }

    /**
     * Blacklist an access token
     */
    async blacklistToken(token) {
        try {
            const payload = jwt.decode(token);
            if (!payload || !payload.exp) return;

            const ttl = payload.exp - Math.floor(Date.now() / 1000);
            if (ttl > 0) {
                await sessionClient.setex(`blacklist:${token}`, ttl, '1');
            }
        } catch (error) {
            logger.error('Failed to blacklist token', { error: error.message });
        }
    }

    /**
     * Check if token is blacklisted
     */
    async isTokenBlacklisted(token) {
        try {
            const result = await sessionClient.get(`blacklist:${token}`);
            return result === '1';
        } catch (error) {
            logger.error('Failed to check token blacklist', { error: error.message });
            return false;
        }
    }

    /**
     * Change password
     */
    async changePassword(userId, currentPassword, newPassword) {
        if (!newPassword || newPassword.length < 8) {
            throw new ValidationError('New password must be at least 8 characters');
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new AuthenticationError('User not found');
        }

        const isValid = await user.comparePassword(currentPassword);
        if (!isValid) {
            throw new AuthenticationError('Current password is incorrect');
        }

        user.password = newPassword;
        await user.save();

        // Invalidate all refresh tokens
        await user.removeAllRefreshTokens();

        logger.info('Password changed', { userId });

        return { message: 'Password changed successfully' };
    }
}

// Export singleton instance
const authService = new AuthService();
export default authService;
