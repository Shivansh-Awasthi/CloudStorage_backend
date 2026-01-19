/**
 * Expiry Worker
 * Processes expired files for deletion
 */
import config from '../config/index.js';
import expiryService from '../services/ExpiryService.js';
import logger from '../utils/logger.js';

class ExpiryWorker {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
    }

    async start() {
        if (this.isRunning) return;

        this.isRunning = true;
        logger.info('Expiry worker started');

        // Run immediately, then on interval
        await this.run();

        this.intervalId = setInterval(
            () => this.run(),
            config.workers.expiryInterval
        );
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('Expiry worker stopped');
    }

    async run() {
        if (!this.isRunning) return;

        try {
            logger.debug('Expiry worker running...');

            const result = await expiryService.processExpiredBatch(
                config.workers.batchSize
            );

            if (result.processed > 0) {
                logger.info('Expiry worker completed batch', result);
            }
        } catch (error) {
            logger.error('Expiry worker error', { error: error.message });
        }
    }
}

const expiryWorker = new ExpiryWorker();
export default expiryWorker;
