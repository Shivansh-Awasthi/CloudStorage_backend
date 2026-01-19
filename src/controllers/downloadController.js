/**
 * Download Controller
 * With comprehensive download logging
 */
import downloadService from '../services/DownloadService.js';
import { logDownload } from '../utils/logger.js';

export async function downloadFile(req, res, next) {
    try {
        const { fileId } = req.params;
        const password = req.headers['x-file-password'] || req.query.password;
        const startTime = Date.now();

        const { stream, headers, statusCode, metadata } = await downloadService.prepareDownload(
            fileId,
            {
                userId: req.user?._id,
                rangeHeader: req.headers.range,
                password,
            }
        );

        // Log download start
        logDownload('started', {
            message: 'Download started',
            fileId,
            filename: metadata?.filename,
            size: metadata?.size,
            userId: req.user?._id?.toString() || 'anonymous',
            isRange: !!req.headers.range,
            range: req.headers.range,
            storageTier: metadata?.storageTier,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
            city: req.logContext?.geo?.city,
            browser: req.logContext?.ua?.browser,
            os: req.logContext?.ua?.os,
            device: req.logContext?.ua?.device,
        });

        // Set headers
        for (const [key, value] of Object.entries(headers)) {
            res.set(key, value);
        }

        res.status(statusCode);

        // Track completion
        stream.on('end', () => {
            const duration = Date.now() - startTime;
            logDownload('completed', {
                message: 'Download completed',
                fileId,
                filename: metadata?.filename,
                size: metadata?.size,
                duration,
                userId: req.user?._id?.toString() || 'anonymous',
                ip: req.logContext?.ip,
                country: req.logContext?.geo?.country,
            });
        });

        // Pipe stream to response
        stream.on('error', (err) => {
            logDownload('error', {
                message: 'Download stream error',
                fileId,
                error: err.message,
                ip: req.logContext?.ip,
            });
            if (!res.headersSent) {
                next(err);
            }
        });

        stream.pipe(res);
    } catch (error) {
        logDownload('failed', {
            message: 'Download failed',
            fileId: req.params?.fileId,
            error: error.message,
            ip: req.logContext?.ip,
        });
        next(error);
    }
}

export async function getFileInfo(req, res, next) {
    try {
        const { fileId } = req.params;
        const result = await downloadService.getDownloadInfo(fileId, req.user?._id);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function getUserFiles(req, res, next) {
    try {
        const { page, limit, sort } = req.query;
        const result = await downloadService.getUserFiles(req.user._id, {
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
            sort,
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function deleteFile(req, res, next) {
    try {
        const { fileId } = req.params;
        const result = await downloadService.deleteFile(fileId, req.user._id);

        logDownload('file_deleted', {
            message: 'File deleted',
            fileId,
            userId: req.user._id.toString(),
            size: result.size,
            ip: req.logContext?.ip,
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function renameFile(req, res, next) {
    try {
        const { fileId } = req.params;
        const { filename } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: { message: 'Filename is required' } });
        }

        const result = await downloadService.renameFile(fileId, req.user._id, filename.trim());
        res.json(result);
    } catch (error) {
        next(error);
    }
}
