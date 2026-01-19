/**
 * Auth Controller
 * With security audit logging
 */
import authService from '../services/AuthService.js';
import { ValidationError } from '../utils/errors.js';
import { logAuth } from '../utils/logger.js';

export async function register(req, res, next) {
    try {
        const { email, password } = req.body;
        const result = await authService.register(email, password);

        logAuth('register_success', {
            message: 'New user registered',
            email,
            userId: result.user.id,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
            browser: req.logContext?.ua?.browser,
        });

        res.status(201).json(result);
    } catch (error) {
        logAuth('register_failed', {
            message: 'Registration failed',
            email: req.body?.email,
            error: error.message,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
        });
        next(error);
    }
}

export async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        const result = await authService.login(email, password);

        logAuth('login_success', {
            message: 'User logged in',
            email,
            userId: result.user.id,
            role: result.user.role,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
            city: req.logContext?.geo?.city,
            browser: req.logContext?.ua?.browser,
            os: req.logContext?.ua?.os,
            device: req.logContext?.ua?.device,
        });

        res.json(result);
    } catch (error) {
        logAuth('login_failed', {
            message: 'Login attempt failed',
            email: req.body?.email,
            error: error.message,
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
            browser: req.logContext?.ua?.browser,
        });
        next(error);
    }
}

export async function logout(req, res, next) {
    try {
        const refreshToken = req.body.refreshToken;
        await authService.logout(req.user._id, refreshToken);

        logAuth('logout', {
            message: 'User logged out',
            userId: req.user._id.toString(),
            ip: req.logContext?.ip,
        });

        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
}

export async function refresh(req, res, next) {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) throw new ValidationError('Refresh token required');
        const result = await authService.refreshToken(refreshToken);
        res.json(result);
    } catch (error) {
        logAuth('refresh_failed', {
            message: 'Token refresh failed',
            error: error.message,
            ip: req.logContext?.ip,
        });
        next(error);
    }
}

export async function me(req, res, next) {
    try {
        // Get quota data for the user
        const { Quota } = await import('../models/index.js');
        const quota = await Quota.getOrCreate(req.user._id);
        const quotaSummary = await quota.getSummary();

        res.json({
            user: req.user.toJSON(),
            quota: quotaSummary
        });
    } catch (error) {
        next(error);
    }
}

export async function changePassword(req, res, next) {
    try {
        const { currentPassword, newPassword } = req.body;
        const result = await authService.changePassword(req.user._id, currentPassword, newPassword);

        logAuth('password_changed', {
            message: 'User changed password',
            userId: req.user._id.toString(),
            ip: req.logContext?.ip,
            country: req.logContext?.geo?.country,
        });

        res.json(result);
    } catch (error) {
        logAuth('password_change_failed', {
            message: 'Password change failed',
            userId: req.user._id?.toString(),
            error: error.message,
            ip: req.logContext?.ip,
        });
        next(error);
    }
}
