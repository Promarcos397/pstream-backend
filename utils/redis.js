/**
 * Redis client singleton.
 * Exported so services (providerHealth, etc.) can share a single connection.
 * Falls back gracefully when REDIS_URL is not set (local dev without Redis).
 */

import Redis from 'ioredis';

// No-op fallback when Redis is unavailable — same API, always resolves
const noopClient = {
    get: async () => null,
    set: async () => null,
    setex: async () => null,
    lpush: async () => null,
    ltrim: async () => null,
    expire: async () => null,
    del: async () => null,
    incr: async () => 0,
    keys: async () => [],
};

function createRedisClient() {
    if (!process.env.REDIS_URL) return noopClient;
    try {
        const client = new Redis(process.env.REDIS_URL, {
            lazyConnect: false,
            maxRetriesPerRequest: 2,
            enableOfflineQueue: false,
            connectTimeout: 5000,
        });
        client.on('error', (e) => {
            if (!client._lastErrCode || client._lastErrCode !== e.code) {
                console.error('[Redis] Connection error:', e.code || e.message);
                client._lastErrCode = e.code;
            }
        });
        return client;
    } catch (e) {
        console.warn('[Redis] Init failed:', e.message);
        return noopClient;
    }
}

export const redisClient = createRedisClient();
