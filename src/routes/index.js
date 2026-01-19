/**
 * Routes Index
 */
import { Router } from 'express';
import authRoutes from './auth.js';
import uploadRoutes from './upload.js';
import downloadRoutes from './download.js';
import folderRoutes from './folders.js';
import adminRoutes from './admin.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/upload', uploadRoutes);
router.use('/download', downloadRoutes);
router.use('/files', downloadRoutes); // Alias
router.use('/folders', folderRoutes);
router.use('/admin', adminRoutes);

export default router;
