/**
 * Role-Based Access Control Middleware
 */

import { AuthorizationError } from '../utils/errors.js';

/**
 * Require specific roles
 * @param {...string} roles - Required roles (user must have at least one)
 */
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return next(new AuthorizationError('Authentication required'));
        }

        if (!roles.includes(req.user.role)) {
            return next(new AuthorizationError(`Required role: ${roles.join(' or ')}`));
        }

        next();
    };
}

/**
 * Require admin role
 */
export function requireAdmin(req, res, next) {
    if (!req.user) {
        return next(new AuthorizationError('Authentication required'));
    }

    if (!req.user.isAdmin()) {
        return next(new AuthorizationError('Admin access required'));
    }

    next();
}

/**
 * Require premium or admin role
 */
export function requirePremium(req, res, next) {
    if (!req.user) {
        return next(new AuthorizationError('Authentication required'));
    }

    if (!req.user.isPremiumOrAdmin()) {
        return next(new AuthorizationError('Premium access required'));
    }

    next();
}

/**
 * Require resource ownership or admin
 * @param {Function} getOwnerId - Function to extract owner ID from request
 */
export function requireOwnership(getOwnerId) {
    return async (req, res, next) => {
        if (!req.user) {
            return next(new AuthorizationError('Authentication required'));
        }

        // Admins can access any resource
        if (req.user.isAdmin()) {
            return next();
        }

        try {
            const ownerId = await getOwnerId(req);

            if (!ownerId) {
                return next(new AuthorizationError('Resource not found'));
            }

            if (ownerId.toString() !== req.user._id.toString()) {
                return next(new AuthorizationError('Access denied'));
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}

export default requireRole;
