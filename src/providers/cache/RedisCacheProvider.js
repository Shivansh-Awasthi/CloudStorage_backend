/**
 * Redis Cache Provider
 * Redis-based cache implementation
 */

import { CacheProvider } from './CacheProvider.js';
import redis, { cacheClient } from '../../config/redis.js';
import logger from '../../utils/logger.js';

/**
 * Redis Cache Provider Implementation
 */
export class RedisCacheProvider extends CacheProvider {
    constructor(client = cacheClient) {
        super();
        this.client = client;
    }

    /**
     * Get a value from cache
     */
    async get(key) {
        try {
            const value = await this.client.get(key);
            if (!value) return null;

            try {
                return JSON.parse(value);
            } catch {
                return value; // Return as string if not JSON
            }
        } catch (error) {
            logger.error('Cache get failed', { key, error: error.message });
            return null;
        }
    }

    /**
     * Set a value in cache
     */
    async set(key, value, ttl = null) {
        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);

            if (ttl) {
                await this.client.setex(key, ttl, serialized);
            } else {
                await this.client.set(key, serialized);
            }
        } catch (error) {
            logger.error('Cache set failed', { key, error: error.message });
            throw error;
        }
    }

    /**
     * Delete a key
     */
    async delete(key) {
        try {
            const result = await this.client.del(key);
            return result > 0;
        } catch (error) {
            logger.error('Cache delete failed', { key, error: error.message });
            return false;
        }
    }

    /**
     * Check if key exists
     */
    async exists(key) {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            logger.error('Cache exists failed', { key, error: error.message });
            return false;
        }
    }

    /**
     * Increment a value
     */
    async increment(key, amount = 1) {
        try {
            if (amount === 1) {
                return await this.client.incr(key);
            }
            return await this.client.incrby(key, amount);
        } catch (error) {
            logger.error('Cache increment failed', { key, amount, error: error.message });
            throw error;
        }
    }

    /**
     * Set expiry on a key
     */
    async expire(key, ttl) {
        try {
            const result = await this.client.expire(key, ttl);
            return result === 1;
        } catch (error) {
            logger.error('Cache expire failed', { key, ttl, error: error.message });
            return false;
        }
    }

    /**
     * Get multiple keys
     */
    async mget(keys) {
        try {
            const values = await this.client.mget(...keys);
            const result = {};

            keys.forEach((key, index) => {
                const value = values[index];
                if (value) {
                    try {
                        result[key] = JSON.parse(value);
                    } catch {
                        result[key] = value;
                    }
                }
            });

            return result;
        } catch (error) {
            logger.error('Cache mget failed', { keys, error: error.message });
            return {};
        }
    }

    /**
     * Set multiple keys
     */
    async mset(items, ttl = null) {
        try {
            const pipeline = this.client.pipeline();

            for (const [key, value] of Object.entries(items)) {
                const serialized = typeof value === 'string' ? value : JSON.stringify(value);

                if (ttl) {
                    pipeline.setex(key, ttl, serialized);
                } else {
                    pipeline.set(key, serialized);
                }
            }

            await pipeline.exec();
        } catch (error) {
            logger.error('Cache mset failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Delete keys matching pattern
     */
    async deletePattern(pattern) {
        try {
            let cursor = '0';
            let deletedCount = 0;

            do {
                const [newCursor, keys] = await this.client.scan(
                    cursor,
                    'MATCH',
                    pattern,
                    'COUNT',
                    100
                );
                cursor = newCursor;

                if (keys.length > 0) {
                    // Remove prefix from keys for deletion
                    const keysWithoutPrefix = keys.map(k =>
                        k.replace(this.client.options.keyPrefix || '', '')
                    );
                    const result = await this.client.del(...keysWithoutPrefix);
                    deletedCount += result;
                }
            } while (cursor !== '0');

            return deletedCount;
        } catch (error) {
            logger.error('Cache deletePattern failed', { pattern, error: error.message });
            return 0;
        }
    }

    /**
     * Get TTL of a key
     */
    async ttl(key) {
        try {
            return await this.client.ttl(key);
        } catch (error) {
            logger.error('Cache ttl failed', { key, error: error.message });
            return -2;
        }
    }

    /**
     * Set hash field
     */
    async hset(key, field, value) {
        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            await this.client.hset(key, field, serialized);
        } catch (error) {
            logger.error('Cache hset failed', { key, field, error: error.message });
            throw error;
        }
    }

    /**
     * Get hash field
     */
    async hget(key, field) {
        try {
            const value = await this.client.hget(key, field);
            if (!value) return null;

            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        } catch (error) {
            logger.error('Cache hget failed', { key, field, error: error.message });
            return null;
        }
    }

    /**
     * Get all hash fields
     */
    async hgetall(key) {
        try {
            const data = await this.client.hgetall(key);
            if (!data || Object.keys(data).length === 0) return null;

            const result = {};
            for (const [field, value] of Object.entries(data)) {
                try {
                    result[field] = JSON.parse(value);
                } catch {
                    result[field] = value;
                }
            }

            return result;
        } catch (error) {
            logger.error('Cache hgetall failed', { key, error: error.message });
            return null;
        }
    }

    /**
     * Delete hash field
     */
    async hdel(key, field) {
        try {
            const result = await this.client.hdel(key, field);
            return result > 0;
        } catch (error) {
            logger.error('Cache hdel failed', { key, field, error: error.message });
            return false;
        }
    }
}

// Export singleton instance
const redisCacheProvider = new RedisCacheProvider();
export default redisCacheProvider;
