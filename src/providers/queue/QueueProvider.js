/**
 * Queue Provider Interface
 * Abstract base class for queue implementations
 */

/**
 * Abstract Queue Provider
 */
export class QueueProvider {
    /**
     * Add a job to the queue
     * @param {string} queueName - Queue name
     * @param {Object} data - Job data
     * @param {Object} options - Job options (delay, priority, etc.)
     * @returns {Promise<Object>} Job info
     */
    async add(queueName, data, options = {}) {
        throw new Error('Method not implemented: add()');
    }

    /**
     * Process jobs from a queue
     * @param {string} queueName - Queue name
     * @param {Function} handler - Job handler function
     * @param {Object} options - Processing options
     */
    process(queueName, handler, options = {}) {
        throw new Error('Method not implemented: process()');
    }

    /**
     * Get queue statistics
     * @param {string} queueName - Queue name
     * @returns {Promise<Object>} Queue statistics
     */
    async getStats(queueName) {
        throw new Error('Method not implemented: getStats()');
    }

    /**
     * Pause a queue
     * @param {string} queueName - Queue name
     */
    async pause(queueName) {
        throw new Error('Method not implemented: pause()');
    }

    /**
     * Resume a queue
     * @param {string} queueName - Queue name
     */
    async resume(queueName) {
        throw new Error('Method not implemented: resume()');
    }

    /**
     * Close all queues
     */
    async close() {
        throw new Error('Method not implemented: close()');
    }
}
