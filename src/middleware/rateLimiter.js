/**
 * Rate Limiting Middleware
 * Redis-based sliding window rate limiting
 */

import config from '../config/index.js';
import { cacheClient } from '../config/redis.js';
import { RateLimitError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Rate limit types
 */
export const RateLimitType = {
    UPLOAD: 'upload',
    DOWNLOAD: 'download',
    AUTH: 'auth',
};

/**
 * Get rate limit for user/IP
 */
function getLimit(type, user) {
    if (!user) {
        // IP-based limits for unauthenticated requests
        return config.rateLimit.ip[type];
    }

    // User-based limits
    if (user.isPremiumOrAdmin && user.isPremiumOrAdmin()) {
        return config.rateLimit.premium[type];
    }

    return config.rateLimit.free[type];
}

/**
 * Sliding window rate limiter implementation
 */
async function checkRateLimit(identifier, type, limit, windowSeconds) {
    const key = `ratelimit:${type}:${identifier}`;
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    try {
        // Use Redis sorted set for sliding window
        const pipeline = cacheClient.pipeline();

        // Remove old entries outside the window
        pipeline.zremrangebyscore(key, 0, windowStart);

        // Count entries in current window
        pipeline.zcard(key);

        // Add current request
        pipeline.zadd(key, now, `${now}:${Math.random()}`);

        // Set expiry on the key
        pipeline.expire(key, windowSeconds);

        const results = await pipeline.exec();
        const count = results[1][1]; // Get zcard result

        if (count >= limit) {
            // Calculate retry after
            const oldestEntry = await cacheClient.zrange(key, 0, 0, 'WITHSCORES');
            const retryAfter = oldestEntry.length >= 2
                ? Math.ceil((parseInt(oldestEntry[1]) + windowSeconds * 1000 - now) / 1000)
                : windowSeconds;

            return {
                allowed: false,
                remaining: 0,
                retryAfter: Math.max(1, retryAfter),
                limit,
            };
        }

        return {
            allowed: true,
            remaining: limit - count - 1,
            retryAfter: 0,
            limit,
        };
    } catch (error) {
        logger.error('Rate limit check failed', { error: error.message, identifier, type });
        // Fail open - allow request if Redis is down
        return { allowed: true, remaining: limit, retryAfter: 0, limit };
    }
}

/**
 * Create rate limiter middleware for a specific type
 */
export function rateLimit(type) {
    return async (req, res, next) => {
        const user = req.user;
        const limit = getLimit(type, user);
        const identifier = user ? `user:${user._id}` : `ip:${req.ip}`;

        const result = await checkRateLimit(
            identifier,
            type,
            limit,
            config.rateLimit.windowSeconds
        );

        // Set rate limit headers
        res.set('X-RateLimit-Limit', result.limit);
        res.set('X-RateLimit-Remaining', result.remaining);
        res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + config.rateLimit.windowSeconds);

        if (!result.allowed) {
            res.set('Retry-After', result.retryAfter);
            return next(new RateLimitError(result.retryAfter));
        }

        next();
    };
}

/**
 * Upload rate limiter
 */
export const uploadRateLimit = rateLimit(RateLimitType.UPLOAD);

/**
 * Download rate limiter
 */
export const downloadRateLimit = rateLimit(RateLimitType.DOWNLOAD);

/**
 * Auth rate limiter
 */
export const authRateLimit = rateLimit(RateLimitType.AUTH);

/**
 * Abuse detection middleware
 * Tracks suspicious behavior patterns
 */
export async function detectAbuse(req, res, next) {
    const ip = req.ip;
    const key = `abuse:${ip}`;

    try {
        // Check abuse score
        const score = await cacheClient.get(key);

        if (score && parseInt(score) >= 100) {
            // IP is blocked
            const ttl = await cacheClient.ttl(key);
            return res.status(403).json({
                error: {
                    code: 'IP_BLOCKED',
                    message: 'Your IP has been temporarily blocked due to suspicious activity',
                    retryAfter: ttl > 0 ? ttl : 3600,
                },
            });
        }

        // Attach abuse tracking to request
        req.abuseKey = key;
        req.recordAbuse = async (points = 10) => {
            try {
                const newScore = await cacheClient.incrby(key, points);
                await cacheClient.expire(key, 3600); // 1 hour TTL

                if (newScore >= 100) {
                    logger.warn('IP blocked due to abuse', { ip, score: newScore });
                }
            } catch (error) {
                logger.error('Failed to record abuse', { error: error.message });
            }
        };

        next();
    } catch (error) {
        // Fail open
        logger.error('Abuse detection failed', { error: error.message });
        next();
    }
}

/**
 * Failed upload chunk tracker
 * Block IPs with too many failed chunk uploads
 */
export async function trackChunkFailure(req, res, next) {
    const ip = req.ip;
    const key = `chunk_fail:${ip}`;

    // Store original json method
    const originalJson = res.json.bind(res);

    res.json = function (data) {
        // If chunk upload failed, increment counter
        if (res.statusCode >= 400 && req.path.includes('/chunk')) {
            cacheClient.incr(key)
                .then(count => {
                    cacheClient.expire(key, 600); // 10 minute window

                    if (count >= 10) {
                        // Record abuse for too many failures
                        if (req.recordAbuse) {
                            req.recordAbuse(50);
                        }
                    }
                })
                .catch(() => { });
        }

        return originalJson(data);
    };

    next();
}

export default rateLimit;
