/**
 * Download Routes
 */
import { Router } from 'express';
import * as downloadController from '../controllers/downloadController.js';
import authenticate, { optionalAuth } from '../middleware/auth.js';
import { downloadRateLimit } from '../middleware/rateLimiter.js';
import { validateObjectId } from '../middleware/security.js';

const router = Router();

// Get file info (optional auth)
router.get(
    '/info/:fileId',
    optionalAuth,
    validateObjectId('fileId'),
    downloadController.getFileInfo
);

// Download file (optional auth, rate limited)
router.get(
    '/:fileId',
    optionalAuth,
    downloadRateLimit,
    validateObjectId('fileId'),
    downloadController.downloadFile
);

// User's files (requires auth)
router.get('/', authenticate, downloadController.getUserFiles);

// Delete file (requires auth)
router.delete(
    '/:fileId',
    authenticate,
    validateObjectId('fileId'),
    downloadController.deleteFile
);

// Rename file (requires auth)
router.patch(
    '/:fileId/rename',
    authenticate,
    validateObjectId('fileId'),
    downloadController.renameFile
);

export default router;

