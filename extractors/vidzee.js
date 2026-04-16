/**
 * VidZee Extractor — v2.1 (2026-04-16)
 * Hits 14 servers in parallel, 2-layer AES decryption:
 *   Layer 1: fetch encrypted key from core.vidzee.wtf/api-key → AES-GCM decrypt with hardcoded secret
 *   Layer 2: use derived key to AES-256-CBC decrypt each stream URL
 *
 * CDN (i-cdn-*.kessy412lad.com) is NOT IP-signed — plays from any IP.
 * Works from bare HF IP without proxy.
 */
import { gigaAxios } from '../utils/http.js';
import crypto from 'crypto';

const BASE_URL = 'https://player.vidzee.wtf';
const KEY_API  = 'https://core.vidzee.wtf/api-key';

// AES-GCM secret to decrypt the rotating key from /api-key endpoint.
// Algorithm (from vidzee source, confirmed via browser DevTools):
//   key = SHA-256( UTF8(secret_string) )   ← NOT raw hex bytes, SHA-256 hash of the string
//   buffer layout: IV[0:12] | authTag[12:28] | ciphertext[28:]
//   Node.js: decipher.setAuthTag(authTag), then update(ciphertext)
const GCM_SECRET = '4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: BASE_URL + '/',
    Origin: BASE_URL,
};

// Cache the derived key for the session (rotates daily at most)
let _cachedDecryptKey = null;
let _cacheExpiry = 0;

async function getDerivedKey() {
    const now = Date.now();
    if (_cachedDecryptKey && now < _cacheExpiry) return _cachedDecryptKey;

    try {
        const { data: encKeyB64 } = await gigaAxios.get(KEY_API, { headers: HEADERS, timeout: 6000 });
        const buf = Buffer.from(encKeyB64.trim(), 'base64');

        // Buffer layout: IV (12) | authTag (16) | ciphertext (rest)
        const iv         = buf.slice(0, 12);
        const authTag    = buf.slice(12, 28);   // 16 bytes
        const ciphertext = buf.slice(28);

        // Key = SHA-256 of the secret string (matches WebCrypto subtle.digest("SHA-256", encode(em)))
        const gcmKey = crypto.createHash('sha256').update(Buffer.from(GCM_SECRET, 'utf8')).digest();

        const decipher = crypto.createDecipheriv('aes-256-gcm', gcmKey, iv);
        decipher.setAuthTag(authTag);
        let dec = decipher.update(ciphertext, undefined, 'utf8');
        dec += decipher.final('utf8');

        _cachedDecryptKey = dec.trim();
        _cacheExpiry = now + 60 * 60 * 1000; // cache 1 hour
        console.log(`[VidZee] ✅ Dynamic key fetched (${_cachedDecryptKey.length} chars)`);
        return _cachedDecryptKey;
    } catch (e) {
        console.warn(`[VidZee] Key fetch failed (${e.message}) — using hardcoded fallback`);
        return 'pleasedontscrapemesaywallahi'; // last known good key
    }
}

function decryptUrl(link, decryptKey) {
    try {
        const rawKey = decryptKey.padEnd(32, '\0').slice(0, 32);
        const keyBytes = Buffer.from(rawKey, 'utf8');
        const decoded = Buffer.from(link, 'base64').toString('utf8');
        const [ivBase64, cipherBase64] = decoded.split(':');
        if (!ivBase64 || !cipherBase64) return null;

        const iv = Buffer.from(ivBase64, 'base64');
        const ciphertext = Buffer.from(cipherBase64, 'base64');

        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBytes, iv);
        let decrypted = decipher.update(ciphertext, undefined, 'utf8');
        decrypted += decipher.final('utf8');

        // Strip any PKCS7 padding bytes that leak into utf8 output
        const url = decrypted.replace(/[\x00-\x08\x0b-\x1f]/g, '').trim();
        return url.startsWith('http') ? url : null;
    } catch {
        return null;
    }
}

async function fetchServer(tmdbId, serverId, type, season, episode) {
    try {
        let url = `${BASE_URL}/api/server?id=${tmdbId}&sr=${serverId}`;
        if (type === 'tv' && season && episode) {
            url += `&ss=${season}&ep=${episode}`;
        }
        const { data } = await gigaAxios.get(url, { headers: HEADERS, timeout: 8000 });
        return data;
    } catch {
        return null;
    }
}

export async function scrapeVidZee(tmdbId, type, season, episode) {
    try {
        // Get the current decryption key (cached or freshly fetched)
        const decryptKey = await getDerivedKey();

        // Hit servers 0-9 concurrently (empirically 0,2,3,4 work — more = better coverage)
        const serverPromises = Array.from({ length: 10 }, (_, i) =>
            fetchServer(tmdbId, i, type, season, episode)
        );
        const results = await Promise.allSettled(serverPromises);

        const subtitleMap = new Map();
        const allUrls = [];

        for (const result of results) {
            if (result.status !== 'fulfilled' || !result.value?.url) continue;
            const { url: streamUrls, tracks } = result.value;

            for (const track of (tracks || [])) {
                if (track.url && track.lang && !subtitleMap.has(track.lang)) {
                    subtitleMap.set(track.lang, { url: track.url, lang: track.lang, label: track.label || track.lang });
                }
            }

            for (const su of (streamUrls || [])) {
                if (!su.link) continue;
                const decrypted = decryptUrl(su.link, decryptKey);
                if (decrypted) allUrls.push(decrypted);
            }
        }

        const uniqueUrls = [...new Set(allUrls)];
        console.log(`[VidZee] Decrypted ${uniqueUrls.length} unique stream URLs`);

        if (uniqueUrls.length === 0) {
            console.warn('[VidZee] No streams decrypted — key may have rotated');
            return null;
        }

        const sources = uniqueUrls.map(url => ({
            url,
            quality: 'auto',
            isM3U8: true,
            referer: BASE_URL + '/',
        }));

        return {
            success: true,
            provider: 'VidZee ⚡',
            sources,
            subtitles: Array.from(subtitleMap.values()),
        };
    } catch (e) {
        console.warn(`[VidZee] Error: ${e.message}`);
        return null;
    }
}
