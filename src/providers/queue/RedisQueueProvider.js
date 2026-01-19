/**
 * Redis Queue Provider
 * Bull-based job queue implementation
 */

import Bull from 'bull';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { QueueProvider } from './QueueProvider.js';

/**
 * Queue names used in the application
 */
export const QueueNames = {
    EXPIRY: 'storage:expiry',
    MIGRATION: 'storage:migration',
    CLEANUP: 'storage:cleanup',
    FILE_PROCESSING: 'storage:file-processing',
};

/**
 * Redis Queue Provider using Bull
 */
export class RedisQueueProvider extends QueueProvider {
    constructor() {
        super();
        this.queues = new Map();
        this.redisConfig = {
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password || undefined,
            db: config.redis.db,
        };
    }

    /**
     * Get or create a queue
     */
    _getQueue(queueName) {
        if (!this.queues.has(queueName)) {
            const queue = new Bull(queueName, {
                redis: this.redisConfig,
                defaultJobOptions: {
                    removeOnComplete: 100, // Keep last 100 completed jobs
                    removeOnFail: 1000,    // Keep last 1000 failed jobs
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000,
                    },
                },
            });

            // Queue event handlers
            queue.on('error', (error) => {
                logger.error(`Queue ${queueName} error`, { error: error.message });
            });

            queue.on('failed', (job, error) => {
                logger.error(`Job failed in ${queueName}`, {
                    jobId: job.id,
                    data: job.data,
                    error: error.message,
                    attempts: job.attemptsMade,
                });
            });

            queue.on('completed', (job) => {
                logger.debug(`Job completed in ${queueName}`, {
                    jobId: job.id,
                    duration: Date.now() - job.timestamp,
                });
            });

            queue.on('stalled', (job) => {
                logger.warn(`Job stalled in ${queueName}`, { jobId: job.id });
            });

            this.queues.set(queueName, queue);
        }

        return this.queues.get(queueName);
    }

    /**
     * Add a job to the queue
     */
    async add(queueName, data, options = {}) {
        const queue = this._getQueue(queueName);

        const jobOptions = {
            ...options,
            delay: options.delay,
            priority: options.priority || 0,
            attempts: options.attempts || 3,
            jobId: options.jobId,
        };

        const job = await queue.add(data, jobOptions);

        logger.debug(`Job added to ${queueName}`, {
            jobId: job.id,
            data: job.data,
        });

        return {
            id: job.id,
            queueName,
            data: job.data,
            options: jobOptions,
        };
    }

    /**
     * Add multiple jobs at once
     */
    async addBulk(queueName, jobs) {
        const queue = this._getQueue(queueName);

        const bulkJobs = jobs.map(({ data, options = {} }) => ({
            data,
            opts: {
                ...options,
                attempts: options.attempts || 3,
            },
        }));

        const addedJobs = await queue.addBulk(bulkJobs);

        logger.debug(`Bulk jobs added to ${queueName}`, { count: addedJobs.length });

        return addedJobs.map(job => ({
            id: job.id,
            queueName,
            data: job.data,
        }));
    }

    /**
     * Process jobs from a queue
     */
    process(queueName, handler, options = {}) {
        const queue = this._getQueue(queueName);
        const concurrency = options.concurrency || 1;

        queue.process(concurrency, async (job) => {
            logger.debug(`Processing job in ${queueName}`, {
                jobId: job.id,
                data: job.data,
            });

            try {
                const result = await handler(job.data, job);
                return result;
            } catch (error) {
                logger.error(`Job processing failed in ${queueName}`, {
                    jobId: job.id,
                    error: error.message,
                });
                throw error;
            }
        });

        logger.info(`Queue processor started: ${queueName}`, { concurrency });
    }

    /**
     * Get queue statistics
     */
    async getStats(queueName) {
        const queue = this._getQueue(queueName);

        const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
            queue.getPausedCount(),
        ]);

        return {
            queueName,
            waiting,
            active,
            completed,
            failed,
            delayed,
            paused,
        };
    }

    /**
     * Get all queue statistics
     */
    async getAllStats() {
        const stats = {};

        for (const [name, queue] of this.queues) {
            stats[name] = await this.getStats(name);
        }

        return stats;
    }

    /**
     * Pause a queue
     */
    async pause(queueName) {
        const queue = this._getQueue(queueName);
        await queue.pause();
        logger.info(`Queue paused: ${queueName}`);
    }

    /**
     * Resume a queue
     */
    async resume(queueName) {
        const queue = this._getQueue(queueName);
        await queue.resume();
        logger.info(`Queue resumed: ${queueName}`);
    }

    /**
     * Clean old jobs
     */
    async clean(queueName, gracePeriod = 24 * 60 * 60 * 1000, status = 'completed') {
        const queue = this._getQueue(queueName);
        const cleaned = await queue.clean(gracePeriod, status);
        logger.info(`Cleaned jobs from ${queueName}`, { count: cleaned.length, status });
        return cleaned.length;
    }

    /**
     * Close all queues
     */
    async close() {
        for (const [name, queue] of this.queues) {
            await queue.close();
            logger.debug(`Queue closed: ${name}`);
        }
        this.queues.clear();
        logger.info('All queues closed');
    }

    /**
     * Get a specific job by ID
     */
    async getJob(queueName, jobId) {
        const queue = this._getQueue(queueName);
        return await queue.getJob(jobId);
    }

    /**
     * Retry a failed job
     */
    async retryJob(queueName, jobId) {
        const queue = this._getQueue(queueName);
        const job = await queue.getJob(jobId);

        if (job) {
            await job.retry();
            logger.info(`Job retried: ${jobId}`, { queueName });
            return true;
        }

        return false;
    }
}

// Export singleton instance
const redisQueueProvider = new RedisQueueProvider();
export default redisQueueProvider;
