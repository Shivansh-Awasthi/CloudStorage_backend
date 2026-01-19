/**
 * Cache Provider Factory
 */

import { RedisCacheProvider } from './RedisCacheProvider.js';

export { CacheProvider } from './CacheProvider.js';
export { RedisCacheProvider } from './RedisCacheProvider.js';

// Export default provider
import redisCacheProvider from './RedisCacheProvider.js';
export default redisCacheProvider;
