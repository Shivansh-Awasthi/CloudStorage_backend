/**
 * Admin Controller
 */
import adminService from '../services/AdminService.js';

export async function getUsers(req, res, next) {
    try {
        const { page, limit, role, search } = req.query;
        const result = await adminService.getUsers({
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
            role,
            search,
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function promoteUser(req, res, next) {
    try {
        const result = await adminService.promoteUser(req.params.userId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function demoteUser(req, res, next) {
    try {
        const result = await adminService.demoteUser(req.params.userId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function setUserQuota(req, res, next) {
    try {
        const result = await adminService.setUserQuota(req.params.userId, req.body);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function forceDeleteFile(req, res, next) {
    try {
        const result = await adminService.forceDeleteFile(req.params.fileId);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function forceMigrateFile(req, res, next) {
    try {
        const { tier } = req.body;
        const result = await adminService.forceMigrateFile(req.params.fileId, tier);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function setFileExpiry(req, res, next) {
    try {
        const { expiresAt } = req.body;
        const result = await adminService.setFileExpiry(req.params.fileId, expiresAt);
        res.json(result);
    } catch (error) {
        next(error);
    }
}

export async function getSystemStats(req, res, next) {
    try {
        const result = await adminService.getSystemStats();
        res.json(result);
    } catch (error) {
        next(error);
    }
}
