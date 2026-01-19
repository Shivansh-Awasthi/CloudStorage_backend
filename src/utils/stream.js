/**
 * Stream Utilities
 * Helpers for working with file streams
 */

import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

/**
 * Create a range read stream for partial file downloads
 * @param {string} filePath - Path to file
 * @param {number} start - Start byte
 * @param {number} end - End byte (inclusive)
 * @returns {ReadStream} Partial file stream
 */
export function createRangeStream(filePath, start, end) {
    return createReadStream(filePath, { start, end });
}

/**
 * Parse HTTP Range header
 * @param {string} rangeHeader - Range header value (e.g., "bytes=0-1023")
 * @param {number} fileSize - Total file size
 * @returns {Object|null} { start, end } or null if invalid
 */
export function parseRange(rangeHeader, fileSize) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }

    const range = rangeHeader.replace('bytes=', '');
    const parts = range.split('-');

    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    // Handle suffix range (e.g., bytes=-500 means last 500 bytes)
    if (isNaN(start)) {
        start = fileSize - end;
        end = fileSize - 1;
    }

    // Validate range
    if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return null;
    }

    return { start, end };
}

/**
 * Calculate content range header value
 * @param {number} start - Start byte
 * @param {number} end - End byte (inclusive)
 * @param {number} total - Total file size
 * @returns {string} Content-Range header value
 */
export function contentRangeHeader(start, end, total) {
    return `bytes ${start}-${end}/${total}`;
}

/**
 * Create a progress tracking transform stream
 * @param {Function} onProgress - Callback called with bytes processed
 * @returns {Transform} Transform stream
 */
export function createProgressStream(onProgress) {
    let bytesProcessed = 0;

    return new Transform({
        transform(chunk, encoding, callback) {
            bytesProcessed += chunk.length;
            if (onProgress) {
                onProgress(bytesProcessed, chunk.length);
            }
            callback(null, chunk);
        },
    });
}

/**
 * Copy file with progress tracking
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<void>}
 */
export async function copyFileWithProgress(source, destination, onProgress) {
    const readStream = createReadStream(source);
    const writeStream = createWriteStream(destination);
    const progressStream = createProgressStream(onProgress);

    await pipeline(readStream, progressStream, writeStream);
}

/**
 * Safely pipe stream with automatic cleanup
 * @param {ReadStream} source - Source stream
 * @param {WriteStream} destination - Destination stream
 * @returns {Promise<void>}
 */
export async function safePipe(source, destination) {
    return pipeline(source, destination);
}

/**
 * Get MIME type from file extension
 * @param {string} filename - Filename with extension
 * @returns {string} MIME type
 */
export function getMimeType(filename) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    const mimeTypes = {
        // Images
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',

        // Documents
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

        // Text
        txt: 'text/plain',
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        xml: 'application/xml',
        md: 'text/markdown',

        // Archives
        zip: 'application/zip',
        rar: 'application/vnd.rar',
        '7z': 'application/x-7z-compressed',
        tar: 'application/x-tar',
        gz: 'application/gzip',

        // Media
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        mp4: 'video/mp4',
        webm: 'video/webm',
        avi: 'video/x-msvideo',
        mkv: 'video/x-matroska',

        // Misc
        exe: 'application/x-msdownload',
        dmg: 'application/x-apple-diskimage',
        iso: 'application/x-iso9660-image',
    };

    return mimeTypes[ext] || 'application/octet-stream';
}
