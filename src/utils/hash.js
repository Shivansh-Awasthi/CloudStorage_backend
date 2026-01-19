/**
 * Hash Utilities
 * Checksum and hash generation for files and chunks
 */

import crypto from 'crypto';
import { createReadStream } from 'fs';

/**
 * Compute MD5 hash of a buffer (fast, for chunk validation)
 * @param {Buffer} buffer - Data buffer
 * @returns {string} MD5 hash hex string
 */
export function md5(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Compute SHA-256 hash of a buffer (secure, for file verification)
 * @param {Buffer} buffer - Data buffer
 * @returns {string} SHA-256 hash hex string
 */
export function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute SHA-256 hash of a file stream (for large files)
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} SHA-256 hash hex string
 */
export function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Compute MD5 hash of a file stream (for quick validation)
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} MD5 hash hex string
 */
export function md5File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Generate a random token
 * @param {number} bytes - Number of random bytes
 * @returns {string} Hex string token
 */
export function generateToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Verify hash matches expected value
 * @param {string} actual - Actual hash
 * @param {string} expected - Expected hash
 * @returns {boolean} True if hashes match
 */
export function verifyHash(actual, expected) {
    if (!actual || !expected) return false;
    // Constant-time comparison to prevent timing attacks
    try {
        return crypto.timingSafeEqual(
            Buffer.from(actual.toLowerCase(), 'hex'),
            Buffer.from(expected.toLowerCase(), 'hex')
        );
    } catch {
        return false;
    }
}
