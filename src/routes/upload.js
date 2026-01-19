/**
 * Upload Routes
 */
import { Router } from 'express';
import * as uploadController from '../controllers/uploadController.js';
import authenticate from '../middleware/auth.js';
import { uploadRateLimit, trackChunkFailure } from '../middleware/rateLimiter.js';
import { validateObjectId } from '../middleware/security.js';
import express from 'express';

const router = Router();

// All upload routes require authentication
router.use(authenticate);
router.use(uploadRateLimit);

// Initialize upload session
router.post('/init', uploadController.initUpload);

// Upload chunk - use raw body parser for binary data
router.put(
    '/chunk/:sessionId/:chunkIndex',
    express.raw({ type: '*/*', limit: '15mb' }),
    trackChunkFailure,
    uploadController.uploadChunk
);

// Get upload status
router.get('/status/:sessionId', uploadController.getUploadStatus);

// Resume upload
router.get('/resume/:sessionId', uploadController.resumeUpload);

// Complete upload
router.post('/complete/:sessionId', uploadController.completeUpload);

// Abort upload
router.delete('/abort/:sessionId', uploadController.abortUpload);

export default router;
