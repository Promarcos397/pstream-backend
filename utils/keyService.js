import axios from 'axios';

const KEY_HUB_URL = 'https://vidsrc.icu/api/keys'; 
// Alternative: https://keys.fsh.sh/keys (Currently Dead)

let cachedKeys = null;
let lastFetch = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export async function getLatestKeys() {
    const now = Date.now();
    if (cachedKeys && (now - lastFetch < CACHE_TTL)) {
        return cachedKeys;
    }

    try {
        const { data } = await axios.get(KEY_HUB_URL, { timeout: 5000 });
        if (data) {
            cachedKeys = data;
            lastFetch = now;
            return data;
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
