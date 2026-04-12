import axios from 'axios';

// Primary: Ciarands GitHub (flat JSON array of RC4 key strings)
const KEY_HUB_URL = 'https://raw.githubusercontent.com/Ciarands/vidsrc-keys/main/keys.json';
// Fallback: (Previously vidsrc.icu/api/keys — now 404)

let cachedKeys = null;
let lastFetch = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export async function getLatestKeys() {
    const now = Date.now();
    if (cachedKeys && (now - lastFetch < CACHE_TTL)) {
        return cachedKeys;
    }

    try {
        // Use vanilla axios (no proxy) for simple GitHub raw fetch
        const { data } = await axios.get(KEY_HUB_URL, { timeout: 10000 });
        if (Array.isArray(data) && data.length > 0) {
            // Ciarands format: flat array of key strings
            // vidsrc.to uses keys[0] (RC4 key for VidPlay streams)
            cachedKeys = Array.isArray(data) ? { vidsrc_to: data[0], all: data } : data;
            lastFetch = now;
            console.log(`[KeyService] ✅ Fetched ${Array.isArray(data) ? data.length : 1} key(s)`);
            return cachedKeys;
        }
    } catch (e) {
        console.warn('[KeyService] Failed to fetch dynamic keys:', e.message);
    }

    return cachedKeys; // Fallback to stale if fetch fails
}

export function rc4Decrypt(key, data) {
    const state = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + state[i] + key.charCodeAt(i % key.length)) % 256;
        [state[i], state[j]] = [state[j], state[i]];
    }
    let i = 0, k = 0;
    let result = '';
    for (let c = 0; c < data.length; c++) {
        i = (i + 1) % 256;
        k = (k + state[i]) % 256;
        [state[i], state[k]] = [state[k], state[i]];
        result += String.fromCharCode(data[c] ^ state[(state[i] + state[k]) % 256]);
    }
    return result;
}
