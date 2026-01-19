/**
 * Authentication Middleware
 * JWT verification and user extraction
 */

import authService from '../services/AuthService.js';
import { AuthenticationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Extract token from Authorization header
 */
function extractToken(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return null;
    }

    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    return null;
}

/**
 * Authentication middleware
 * Requires valid JWT access token
 */
export async function authenticate(req, res, next) {
    try {
        const token = extractToken(req);

        if (!token) {
            throw new AuthenticationError('Authentication required');
        }

        const user = await authService.getUserFromToken(token);

        // Attach user to request
        req.user = user;
        req.token = token;

        next();
    } catch (error) {
        next(error);
    }
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't require it
 */
export async function optionalAuth(req, res, next) {
    try {
        const token = extractToken(req);

        if (token) {
            try {
                const user = await authService.getUserFromToken(token);
                req.user = user;
                req.token = token;
            } catch (error) {
                // Token invalid, but that's okay for optional auth
                logger.debug('Optional auth failed', { error: error.message });
            }
        }

        next();
    } catch (error) {
        next(error);
    }
}

export default authenticate;
