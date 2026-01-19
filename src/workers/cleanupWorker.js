/**
 * Cleanup Worker
 * Cleans orphaned chunks and temp files
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import config from '../config/index.js';
import { UploadSession } from '../models/index.js';
import storageProvider from '../providers/storage/index.js';
import logger from '../utils/logger.js';

class CleanupWorker {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
    }

    async start() {
        if (this.isRunning) return;

        this.isRunning = true;
        logger.info('Cleanup worker started');

        await this.run();

        this.intervalId = setInterval(
            () => this.run(),
            config.workers.cleanupInterval
        );
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger.info('Cleanup worker stopped');
    }

    async run() {
        if (!this.isRunning) return;

        try {
            logger.debug('Cleanup worker running...');

            // Clean expired upload sessions
            await this.cleanExpiredSessions();

            // Clean orphaned temp directories
            await this.cleanOrphanedTempDirs();

            // Clean old completed/failed sessions from DB
            await this.cleanOldSessions();

        } catch (error) {
            logger.error('Cleanup worker error', { error: error.message });
        }
    }

    async cleanExpiredSessions() {
        const sessions = await UploadSession.findExpiredSessions(
            config.workers.batchSize
        );

        let cleaned = 0;

        for (const session of sessions) {
            try {
                await storageProvider.deleteChunks(session.sessionId);
                session.status = 'expired';
                await session.save();
                cleaned++;
            } catch (error) {
                logger.error('Failed to clean session', {
                    sessionId: session.sessionId,
                    error: error.message,
                });
            }
        }

        if (cleaned > 0) {
            logger.info('Expired sessions cleaned', { count: cleaned });
        }
    }

    async cleanOrphanedTempDirs() {
        const tempPath = config.storage.tempPath;

        try {
            const dirs = await fs.readdir(tempPath);
            let cleaned = 0;

            for (const dir of dirs) {
                // Skip health check files
                if (dir.startsWith('.')) continue;

                const dirPath = join(tempPath, dir);
                const stats = await fs.stat(dirPath);

                // Skip if not a directory
                if (!stats.isDirectory()) continue;

                // Check if session exists and is active
                const session = await UploadSession.findOne({
                    sessionId: dir,
                    status: { $in: ['pending', 'uploading', 'assembling'] },
                });

                if (!session) {
                    // Orphaned directory, delete it
                    await fs.rm(dirPath, { recursive: true, force: true });
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                logger.info('Orphaned temp directories cleaned', { count: cleaned });
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Failed to clean orphaned dirs', { error: error.message });
            }
        }
    }

    async cleanOldSessions() {
        const deleted = await UploadSession.cleanupOldSessions(7);

        if (deleted > 0) {
            logger.info('Old sessions cleaned from DB', { count: deleted });
        }
    }
}

const cleanupWorker = new CleanupWorker();
export default cleanupWorker;
