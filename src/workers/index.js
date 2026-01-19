/**
 * Worker Manager
 * Coordinates all background workers
 */
import expiryWorker from './expiryWorker.js';
import migrationWorker from './migrationWorker.js';
import cleanupWorker from './cleanupWorker.js';
import logger from '../utils/logger.js';

class WorkerManager {
    constructor() {
        this.workers = [
            { name: 'expiry', instance: expiryWorker },
            { name: 'migration', instance: migrationWorker },
            { name: 'cleanup', instance: cleanupWorker },
        ];
    }

    async startAll() {
        logger.info('Starting all workers...');

        for (const worker of this.workers) {
            try {
                await worker.instance.start();
                logger.info(`Worker started: ${worker.name}`);
            } catch (error) {
                logger.error(`Failed to start worker: ${worker.name}`, {
                    error: error.message,
                });
            }
        }
    }

    stopAll() {
        logger.info('Stopping all workers...');

        for (const worker of this.workers) {
            try {
                worker.instance.stop();
                logger.info(`Worker stopped: ${worker.name}`);
            } catch (error) {
                logger.error(`Failed to stop worker: ${worker.name}`, {
                    error: error.message,
                });
            }
        }
    }

    getStatus() {
        return this.workers.map(w => ({
            name: w.name,
            isRunning: w.instance.isRunning,
        }));
    }
}

const workerManager = new WorkerManager();
export default workerManager;

// Allow running workers standalone
if (process.argv[1]?.endsWith('workers/index.js')) {
    import('../config/database.js').then(async (db) => {
        await db.default.connect();
        import('../config/redis.js').then(async (redis) => {
            await redis.default.connect();
            await workerManager.startAll();

            process.on('SIGINT', () => {
                workerManager.stopAll();
                process.exit(0);
            });
        });
    });
}
