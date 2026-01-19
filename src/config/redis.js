/**
 * Redis Connection Manager
 * Handles connections with retry logic for cache, sessions, and queues
 */

import Redis from 'ioredis';
import config from './index.js';
import logger from '../utils/logger.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Create a Redis client with retry logic
 */
function createClient(name, options = {}) {
    const client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        keyPrefix: config.redis.keyPrefix,
        retryStrategy: (times) => {
            if (times > MAX_RETRIES) {
                logger.error(`Redis ${name} max retries exceeded`, { attempts: times });
                return null; // Stop retrying
            }
            const delay = Math.min(times * RETRY_DELAY_MS, 30000);
            logger.warn(`Redis ${name} retry attempt ${times}`, { delay });
            return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        tls: {},
        ...options,
    });

    client.on('connect', () => {
        logger.info(`Redis ${name} connecting...`);
    });

    client.on('ready', () => {
        logger.info(`Redis ${name} connected and ready`);
    });

    client.on('error', (err) => {
        logger.error(`Redis ${name} error`, { error: err.message });
    });

    client.on('close', () => {
        logger.warn(`Redis ${name} connection closed`);
    });

    return client;
}

/**
 * Redis Connection Manager
 * Manages multiple Redis clients for different purposes
 */
class RedisManager {
    constructor() {
        // Main cache client
        this.cache = createClient('cache');

        // Session client (for upload sessions, auth tokens)
        this.session = createClient('session');

        // Queue client (for Bull/worker queues)
        this.queue = createClient('queue', { keyPrefix: '' }); // No prefix for Bull

        // Subscriber client (for pub/sub)
        this.subscriber = createClient('subscriber', { keyPrefix: '' });

        this.clients = [this.cache, this.session, this.queue, this.subscriber];
    }

    /**
     * Connect all Redis clients
     */
    async connect() {
        try {
            await Promise.all(this.clients.map(client => client.connect()));
            logger.info('All Redis clients connected');
        } catch (error) {
            logger.error('Failed to connect Redis clients', { error: error.message });
            throw error;
        }
    }

    /**
     * Disconnect all Redis clients
     */
    async disconnect() {
        await Promise.all(this.clients.map(client => client.quit()));
        logger.info('All Redis clients disconnected');
    }

    /**
     * Get status of all clients
     */
    getStatus() {
        return {
            cache: this.cache.status,
            session: this.session.status,
            queue: this.queue.status,
            subscriber: this.subscriber.status,
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            await this.cache.ping();
            return true;
        } catch {
            return false;
        }
    }
}

// Export singleton instance
const redis = new RedisManager();
export default redis;

// Also export individual clients for convenience
export const cacheClient = redis.cache;
export const sessionClient = redis.session;
export const queueClient = redis.queue;
