/**
 * Folder Routes
 */
import { Router } from 'express';
import * as folderController from '../controllers/folderController.js';
import authenticate from '../middleware/auth.js';
import { validateObjectId } from '../middleware/security.js';

const router = Router();

// All folder routes require authentication
router.use(authenticate);

// Create folder
router.post('/', folderController.createFolder);

// List folders (query: parentId)
router.get('/', folderController.getFolders);

// Get folder contents (files + subfolders)
router.get('/:folderId/contents', folderController.getFolderContents);

// Get folder info
router.get('/:folderId', validateObjectId('folderId'), folderController.getFolder);

// Rename folder
router.patch('/:folderId', validateObjectId('folderId'), folderController.renameFolder);

// Move folder
router.post('/:folderId/move', validateObjectId('folderId'), folderController.moveFolder);

// Delete folder
router.delete('/:folderId', validateObjectId('folderId'), folderController.deleteFolder);

// Move file to folder
router.post('/files/:fileId/move', validateObjectId('fileId'), folderController.moveFile);

export default router;
