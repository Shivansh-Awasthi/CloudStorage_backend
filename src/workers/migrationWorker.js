/**
 * Migration Worker
 * Handles SSD/HDD tier migrations
 */
import config from '../config/index.js';
import storageTierService from '../services/StorageTierService.js';
import { StorageTier } from '../providers/storage/index.js';
import logger from '../utils/logger.js';

class MigrationWorker {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
    }

    async start() {
        if (this.isRunning) return;

        this.isRunning = true;
        logger.info('Migration worker started');

        await this.run();

        this.intervalId = setInterval(
            () => this.run(),
            config.workers.migrationInterval
        );
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('Migration worker stopped');
    }

    async run() {
        if (!this.isRunning) return;

        try {
            logger.debug('Migration worker running...');

            // Process cold migrations (SSD -> HDD)
            await this.processColdMigrations();

            // Process hot migrations (HDD -> SSD)
            await this.processHotMigrations();

        } catch (error) {
            logger.error('Migration worker error', { error: error.message });
        }
    }

    async processColdMigrations() {
        const candidates = await storageTierService.getColdMigrationCandidates(
            config.workers.batchSize
        );

        let migrated = 0;
        let failed = 0;

        for (const file of candidates) {
            try {
                await storageTierService.migrateFile(file._id, StorageTier.COLD);
                migrated++;
            } catch (error) {
                failed++;
                logger.error('Cold migration failed', {
                    fileId: file._id,
                    error: error.message,
                });
            }
        }

        if (migrated > 0 || failed > 0) {
            logger.info('Cold migrations completed', { migrated, failed });
        }
    }

    async processHotMigrations() {
        const candidates = await storageTierService.getHotMigrationCandidates(
            config.workers.batchSize
        );

        let migrated = 0;
        let failed = 0;

        for (const file of candidates) {
            try {
                await storageTierService.migrateFile(file._id, StorageTier.HOT);
                migrated++;
            } catch (error) {
                failed++;
                logger.error('Hot migration failed', {
                    fileId: file._id,
                    error: error.message,
                });
            }
        }

        if (migrated > 0 || failed > 0) {
            logger.info('Hot migrations completed', { migrated, failed });
        }
    }
}

const migrationWorker = new MigrationWorker();
export default migrationWorker;
