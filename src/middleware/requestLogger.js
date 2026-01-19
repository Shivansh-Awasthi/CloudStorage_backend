/**
 * Request Logger Middleware
 * Extracts IP, GeoIP, User-Agent and attaches logging context to requests
 */
import geoip from 'geoip-lite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const UAParser = require('ua-parser-js');
import logger from '../utils/logger.js';

/**
 * Extract real IP address considering proxies
 */
function getClientIP(req) {
    // In order of preference
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // Take the first IP if there are multiple (client -> proxy chain)
        return forwardedFor.split(',')[0].trim();
    }

    const realIP = req.headers['x-real-ip'];
    if (realIP) return realIP;

    // Direct connection
    return req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * Normalize IPv6 to IPv4 if possible
 */
function normalizeIP(ip) {
    if (!ip) return 'unknown';

    // Handle IPv6 mapped IPv4 addresses
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }

    // Handle localhost
    if (ip === '::1') return '127.0.0.1';

    return ip;
}

/**
 * Get geo information from IP
 */
function getGeoInfo(ip) {
    if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return { country: 'LOCAL', city: null, region: null, timezone: null };
    }

    const geo = geoip.lookup(ip);
    if (!geo) {
        return { country: 'UNKNOWN', city: null, region: null, timezone: null };
    }

    return {
        country: geo.country,
        city: geo.city,
        region: geo.region,
        timezone: geo.timezone,
        ll: geo.ll, // Lat/Long
    };
}

/**
 * Parse User-Agent
 */
function parseUserAgent(uaString) {
    if (!uaString) {
        return { browser: 'unknown', os: 'unknown', device: 'unknown' };
    }

    const parser = new UAParser(uaString);
    const result = parser.getResult();

    return {
        browser: result.browser?.name ? `${result.browser.name} ${result.browser.version || ''}`.trim() : 'unknown',
        os: result.os?.name ? `${result.os.name} ${result.os.version || ''}`.trim() : 'unknown',
        device: result.device?.type || 'desktop',
        deviceVendor: result.device?.vendor || null,
        deviceModel: result.device?.model || null,
    };
}

/**
 * Request logging middleware
 */
export default function requestLogger(options = {}) {
    const { skipPaths = ['/health', '/api/health'] } = options;

    return (req, res, next) => {
        // Skip certain paths
        if (skipPaths.some(path => req.path.startsWith(path))) {
            return next();
        }

        const startTime = Date.now();

        // Extract IP
        const rawIP = getClientIP(req);
        const ip = normalizeIP(rawIP);

        // Get geo info
        const geo = getGeoInfo(ip);

        // Parse User-Agent
        const ua = parseUserAgent(req.headers['user-agent']);

        // Attach logging context to request
        req.logContext = {
            ip,
            ipv6: rawIP !== ip ? rawIP : undefined,
            geo,
            ua,
            userAgent: req.headers['user-agent'],
            requestId: req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            method: req.method,
            path: req.path,
            startTime,
        };

        // Set request ID header for tracing
        res.setHeader('X-Request-ID', req.logContext.requestId);

        // Log request start for non-static
        if (!req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
            logger.debug('Request started', {
                requestId: req.logContext.requestId,
                method: req.method,
                path: req.path,
                ip,
                country: geo.country,
                browser: ua.browser,
                os: ua.os,
            });
        }

        // Log response on finish
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const logData = {
                requestId: req.logContext.requestId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                duration,
                ip,
                userId: req.user?._id?.toString() || null,
                userRole: req.user?.role || null,
                country: geo.country,
                city: geo.city,
            };

            // Log level based on status code
            if (res.statusCode >= 500) {
                logger.error('Request completed with error', logData);
            } else if (res.statusCode >= 400) {
                logger.warn('Request completed with client error', logData);
            } else if (!req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
                logger.info('Request completed', logData);
            }
        });

        next();
    };
}

export { getClientIP, normalizeIP, getGeoInfo, parseUserAgent };
