/**
 * Admin Routes
 */
import { Router } from 'express';
import * as adminController from '../controllers/adminController.js';
import authenticate from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roles.js';
import { validateObjectId } from '../middleware/security.js';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// System stats
router.get('/stats', adminController.getSystemStats);

// User management
router.get('/users', adminController.getUsers);
router.post('/users/:userId/promote', validateObjectId('userId'), adminController.promoteUser);
router.post('/users/:userId/demote', validateObjectId('userId'), adminController.demoteUser);
router.put('/users/:userId/quota', validateObjectId('userId'), adminController.setUserQuota);

// File management
router.delete('/files/:fileId', validateObjectId('fileId'), adminController.forceDeleteFile);
router.post('/files/:fileId/migrate', validateObjectId('fileId'), adminController.forceMigrateFile);
router.put('/files/:fileId/expiry', validateObjectId('fileId'), adminController.setFileExpiry);

export default router;
