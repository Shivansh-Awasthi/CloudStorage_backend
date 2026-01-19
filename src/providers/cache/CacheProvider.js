/**
 * Cache Provider Interface
 * Abstract base class for cache implementations
 */

/**
 * Abstract Cache Provider
 */
export class CacheProvider {
    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any>} Cached value or null
     */
    async get(key) {
        throw new Error('Method not implemented: get()');
    }

    /**
     * Set a value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<void>}
     */
    async set(key, value, ttl = null) {
        throw new Error('Method not implemented: set()');
    }

    /**
     * Delete a key from cache
     * @param {string} key - Cache key
     * @returns {Promise<boolean>}
     */
    async delete(key) {
        throw new Error('Method not implemented: delete()');
    }

    /**
     * Check if key exists
     * @param {string} key - Cache key
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        throw new Error('Method not implemented: exists()');
    }

    /**
     * Increment a numeric value
     * @param {string} key - Cache key
     * @param {number} amount - Amount to increment
     * @returns {Promise<number>} New value
     */
    async increment(key, amount = 1) {
        throw new Error('Method not implemented: increment()');
    }

    /**
     * Set expiry on a key
     * @param {string} key - Cache key
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<boolean>}
     */
    async expire(key, ttl) {
        throw new Error('Method not implemented: expire()');
    }

    /**
     * Get multiple keys
     * @param {string[]} keys - Cache keys
     * @returns {Promise<Object>} Key-value map
     */
    async mget(keys) {
        throw new Error('Method not implemented: mget()');
    }

    /**
     * Set multiple keys
     * @param {Object} items - Key-value map
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<void>}
     */
    async mset(items, ttl = null) {
        throw new Error('Method not implemented: mset()');
    }

    /**
     * Delete keys matching a pattern
     * @param {string} pattern - Key pattern
     * @returns {Promise<number>} Number of deleted keys
     */
    async deletePattern(pattern) {
        throw new Error('Method not implemented: deletePattern()');
    }
}
