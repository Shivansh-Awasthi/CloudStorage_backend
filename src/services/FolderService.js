/**
 * Folder Service
 * Manages folder CRUD operations and file organization
 */
import { Folder, File } from '../models/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

class FolderService {
    /**
     * Create a new folder
     */
    async createFolder(userId, name, parentId = null) {
        // Validate name
        const sanitizedName = this._sanitizeName(name);
        if (!sanitizedName) {
            throw new ValidationError('Folder name is required');
        }

        // If parent specified, verify it exists and belongs to user
        if (parentId) {
            const parent = await Folder.findOne({ _id: parentId, userId });
            if (!parent) {
                throw new NotFoundError('Parent folder');
            }
        }

        // Check for duplicate name in same location
        const existing = await Folder.findOne({
            userId,
            parentId: parentId || null,
            name: sanitizedName,
        });
        if (existing) {
            throw new ValidationError('Folder with this name already exists');
        }

        const folder = await Folder.create({
            userId,
            name: sanitizedName,
            parentId: parentId || null,
        });

        logger.info('Folder created', { folderId: folder._id, name: sanitizedName, userId });
        return folder.toJSON();
    }

    /**
     * Get folders in a location
     */
    async getFolders(userId, parentId = null) {
        const query = { userId, parentId: parentId || null };
        const folders = await Folder.find(query).sort({ name: 1 }).lean();

        return folders.map(f => ({
            id: f._id,
            name: f.name,
            parentId: f.parentId,
            path: f.path,
            depth: f.depth,
            createdAt: f.createdAt,
        }));
    }

    /**
     * Get folder contents (subfolders + files)
     */
    async getFolderContents(userId, folderId = null, options = {}) {
        const { page = 1, limit = 50, sort = 'name' } = options;
        const skip = (page - 1) * limit;

        // Get folder info if specified
        let folder = null;
        let breadcrumb = [];

        if (folderId) {
            folder = await Folder.findOne({ _id: folderId, userId });
            if (!folder) {
                throw new NotFoundError('Folder');
            }
            breadcrumb = await folder.getAncestors();
            breadcrumb.push(folder);
        }

        // Get subfolders
        const folders = await Folder.find({ userId, parentId: folderId || null })
            .sort({ name: 1 })
            .lean();

        // Get files in this folder
        const sortOption = sort === 'name' ? { originalName: 1 } : { createdAt: -1 };
        const [files, totalFiles] = await Promise.all([
            File.find({ userId, folderId: folderId || null, isDeleted: false })
                .sort(sortOption)
                .skip(skip)
                .limit(limit)
                .lean(),
            File.countDocuments({ userId, folderId: folderId || null, isDeleted: false }),
        ]);

        return {
            folder: folder ? folder.toJSON() : null,
            breadcrumb: breadcrumb.map(f => ({ id: f._id, name: f.name })),
            folders: folders.map(f => ({
                id: f._id,
                name: f.name,
                type: 'folder',
                createdAt: f.createdAt,
            })),
            files: files.map(f => ({
                id: f._id,
                filename: f.originalName,
                mimeType: f.mimeType,
                size: f.size,
                downloads: f.downloads,
                type: 'file',
                createdAt: f.createdAt,
                expiresAt: f.expiresAt,
                downloadUrl: `/api/download/${f._id}`,
            })),
            pagination: {
                page,
                limit,
                totalFiles,
                totalFolders: folders.length,
            },
        };
    }

    /**
     * Rename a folder
     */
    async renameFolder(userId, folderId, newName) {
        const folder = await Folder.findOne({ _id: folderId, userId });
        if (!folder) {
            throw new NotFoundError('Folder');
        }

        const sanitizedName = this._sanitizeName(newName);
        if (!sanitizedName) {
            throw new ValidationError('Folder name is required');
        }

        // Check for duplicate name
        const existing = await Folder.findOne({
            userId,
            parentId: folder.parentId,
            name: sanitizedName,
            _id: { $ne: folderId },
        });
        if (existing) {
            throw new ValidationError('Folder with this name already exists');
        }

        const oldPath = folder.path;
        folder.name = sanitizedName;
        await folder.save();

        // Update descendant paths
        await folder.updateDescendantPaths(oldPath);

        logger.info('Folder renamed', { folderId, newName: sanitizedName });
        return folder.toJSON();
    }

    /**
     * Move a folder to new parent
     */
    async moveFolder(userId, folderId, newParentId) {
        const folder = await Folder.findOne({ _id: folderId, userId });
        if (!folder) {
            throw new NotFoundError('Folder');
        }

        // Can't move to self
        if (newParentId && newParentId.toString() === folderId.toString()) {
            throw new ValidationError('Cannot move folder into itself');
        }

        // Verify new parent if specified
        if (newParentId) {
            const newParent = await Folder.findOne({ _id: newParentId, userId });
            if (!newParent) {
                throw new NotFoundError('Target folder');
            }

            // Check for circular reference
            if (await folder.wouldCreateCircle(newParentId)) {
                throw new ValidationError('Cannot move folder into its own subfolder');
            }
        }

        // Check for duplicate name in target location
        const existing = await Folder.findOne({
            userId,
            parentId: newParentId || null,
            name: folder.name,
            _id: { $ne: folderId },
        });
        if (existing) {
            throw new ValidationError('Folder with this name already exists in target location');
        }

        const oldPath = folder.path;
        folder.parentId = newParentId || null;
        await folder.save();

        // Update descendant paths
        await folder.updateDescendantPaths(oldPath);

        logger.info('Folder moved', { folderId, newParentId });
        return folder.toJSON();
    }

    /**
     * Delete a folder and all its contents recursively
     */
    async deleteFolder(userId, folderId) {
        const folder = await Folder.findOne({ _id: folderId, userId });
        if (!folder) {
            throw new NotFoundError('Folder');
        }

        // Recursively delete all contents
        await this._deleteFolderRecursive(userId, folderId);

        logger.info('Folder deleted with all contents', { folderId });
        return { success: true };
    }

    /**
     * Recursively delete folder contents
     */
    async _deleteFolderRecursive(userId, folderId) {
        // Import storage provider and quota dynamically to avoid circular deps
        const storageModule = await import('../providers/storage/index.js');
        const storageProvider = storageModule.default;
        const { Quota } = await import('../models/index.js');

        // Get all subfolders
        const subfolders = await Folder.find({ parentId: folderId, userId });
        logger.info('Deleting folder contents', { folderId, subfolderCount: subfolders.length });

        // Recursively delete each subfolder
        for (const subfolder of subfolders) {
            await this._deleteFolderRecursive(userId, subfolder._id);
        }

        // Get ALL files in this folder (including already soft-deleted ones)
        const files = await File.find({ folderId, userId });
        logger.info('Found files to delete', { folderId, fileCount: files.length });

        // Delete each file from storage and update quota
        for (const file of files) {
            try {
                logger.info('Attempting to delete file', {
                    fileId: file._id,
                    storageKey: file.storageKey,
                    storageTier: file.storageTier,
                    isDeleted: file.isDeleted,
                    size: file.size
                });

                // Delete from storage
                const deleted = await storageProvider.delete(file.storageKey, file.storageTier);
                logger.info('Storage delete result', { fileId: file._id, deleted });

                // Update quota only if file wasn't already soft-deleted
                if (!file.isDeleted) {
                    const quota = await Quota.getOrCreate(userId);
                    await quota.removeFile(file.size);
                }

                logger.info('File deleted from storage', {
                    fileId: file._id,
                    storageKey: file.storageKey,
                    size: file.size
                });
            } catch (error) {
                logger.error('Failed to delete file from storage', {
                    fileId: file._id,
                    storageKey: file.storageKey,
                    storageTier: file.storageTier,
                    error: error.message
                });
            }
        }

        // Delete file records from database
        const deleteResult = await File.deleteMany({ folderId, userId });
        logger.info('Deleted file records', { folderId, deletedCount: deleteResult.deletedCount });

        // Delete the folder itself
        await Folder.deleteOne({ _id: folderId });
        logger.info('Deleted folder', { folderId });
    }

    /**
     * Move a file to a folder
     */
    async moveFile(userId, fileId, folderId) {
        const file = await File.findOne({ _id: fileId, userId, isDeleted: false });
        if (!file) {
            throw new NotFoundError('File');
        }

        // Verify folder if specified
        if (folderId) {
            const folder = await Folder.findOne({ _id: folderId, userId });
            if (!folder) {
                throw new NotFoundError('Target folder');
            }
        }

        file.folderId = folderId || null;
        await file.save();

        logger.info('File moved', { fileId, folderId });
        return { success: true };
    }

    /**
     * Get folder by ID
     */
    async getFolder(userId, folderId) {
        const folder = await Folder.findOne({ _id: folderId, userId });
        if (!folder) {
            throw new NotFoundError('Folder');
        }
        return folder.toJSON();
    }

    /**
     * Sanitize folder name
     */
    _sanitizeName(name) {
        if (!name) return null;
        // Remove invalid characters and trim
        return name
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .trim()
            .substring(0, 255);
    }
}

const folderService = new FolderService();
export default folderService;
