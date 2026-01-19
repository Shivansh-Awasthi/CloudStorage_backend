/**
 * Folder Controller
 */
import folderService from '../services/FolderService.js';
import { ValidationError } from '../utils/errors.js';

export async function createFolder(req, res, next) {
    try {
        const { name, parentId } = req.body;
        if (!name) {
            throw new ValidationError('Folder name is required');
        }
        const result = await folderService.createFolder(req.user._id, name, parentId);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
}

export async function getFolders(req, res, next) {
    try {
        const { parentId } = req.query;
        const result = await folderService.getFolders(req.user._id, parentId || null);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function getFolderContents(req, res, next) {
    try {
        const { folderId } = req.params;
        const { page, limit, sort } = req.query;
        const result = await folderService.getFolderContents(
            req.user._id,
            folderId === 'root' ? null : folderId,
            {
                page: parseInt(page, 10) || 1,
                limit: parseInt(limit, 10) || 50,
                sort,
            }
        );
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function getFolder(req, res, next) {
    try {
        const { folderId } = req.params;
        const result = await folderService.getFolder(req.user._id, folderId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function renameFolder(req, res, next) {
    try {
        const { folderId } = req.params;
        const { name } = req.body;
        if (!name) {
            throw new ValidationError('New name is required');
        }
        const result = await folderService.renameFolder(req.user._id, folderId, name);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function moveFolder(req, res, next) {
    try {
        const { folderId } = req.params;
        const { parentId } = req.body;
        const result = await folderService.moveFolder(req.user._id, folderId, parentId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function deleteFolder(req, res, next) {
    try {
        const { folderId } = req.params;
        const { cascade } = req.query;
        const result = await folderService.deleteFolder(
            req.user._id,
            folderId,
            cascade === 'true'
        );
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function moveFile(req, res, next) {
    try {
        const { fileId } = req.params;
        const { folderId } = req.body;
        const result = await folderService.moveFile(req.user._id, fileId, folderId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}
