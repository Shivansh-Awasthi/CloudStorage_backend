/**
 * MongoDB Connection Manager
 * Handles connection with retry logic and failover
 */

import mongoose from 'mongoose';
import config from './index.js';
import logger from '../utils/logger.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

class DatabaseConnection {
    constructor() {
        this.isConnected = false;
        this.retryCount = 0;

        // Handle connection events
        mongoose.connection.on('connected', () => {
            this.isConnected = true;
            this.retryCount = 0;
            logger.info('MongoDB connected successfully');
        });

        mongoose.connection.on('disconnected', () => {
            this.isConnected = false;
            logger.warn('MongoDB disconnected');
        });

        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error', { error: err.message });
        });

        // Graceful shutdown
        process.on('SIGINT', this.gracefulShutdown.bind(this));
        process.on('SIGTERM', this.gracefulShutdown.bind(this));
    }

    /**
     * Connect to MongoDB with retry logic
     */
    async connect() {
        const options = {
            maxPoolSize: config.mongodb.maxPoolSize,
            minPoolSize: config.mongodb.minPoolSize,
            connectTimeoutMS: config.mongodb.connectTimeoutMs,
            socketTimeoutMS: config.mongodb.socketTimeoutMs,
            serverSelectionTimeoutMS: config.mongodb.connectTimeoutMs,
            retryWrites: true,
            retryReads: true,
        };

        while (this.retryCount < MAX_RETRIES) {
            try {
                logger.info('Connecting to MongoDB...', {
                    uri: config.mongodb.uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
                    attempt: this.retryCount + 1
                });

                await mongoose.connect(config.mongodb.uri, options);
                return mongoose.connection;
            } catch (error) {
                this.retryCount++;
                logger.error('MongoDB connection failed', {
                    error: error.message,
                    attempt: this.retryCount,
                    maxRetries: MAX_RETRIES,
                });

                if (this.retryCount >= MAX_RETRIES) {
                    throw new Error(`Failed to connect to MongoDB after ${MAX_RETRIES} attempts`);
                }

                logger.info(`Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
                await this.delay(RETRY_DELAY_MS);
            }
        }
    }

    /**
     * Disconnect from MongoDB
     */
    async disconnect() {
        if (this.isConnected) {
            await mongoose.disconnect();
            logger.info('MongoDB disconnected');
        }
    }

    /**
     * Graceful shutdown handler
     */
    async gracefulShutdown(signal) {
        logger.info(`Received ${signal}. Closing MongoDB connection...`);
        await this.disconnect();
        process.exit(0);
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            readyState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            name: mongoose.connection.name,
        };
    }

    /**
     * Helper to delay execution
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
const database = new DatabaseConnection();
export default database;
