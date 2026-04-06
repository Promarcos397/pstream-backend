/**
 * VidZee Extractor — ported from CinePro
 * Hits 14 servers in parallel, AES-CBC decrypts each URL, returns HLS sources.
 * CDNs used (e.g. rapidairmax.site, serversicuro.cc) are NOT IP-signed.
 */
import { proxyAxios } from '../utils/http.js';
import crypto from 'crypto';

const BASE_URL = 'https://player.vidzee.wtf';
const DECRYPT_KEY = 'YWxvb2tlcGFyYXRoZXdpdGhsYXNzaQ=='; // hardcoded app key

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: BASE_URL,
    Origin: BASE_URL
};

function decryptUrls(streamUrls) {
    const results = [];
    const rawKey = Buffer.from(DECRYPT_KEY, 'base64').toString('utf8').padEnd(32, '\0');
    const keyBytes = Buffer.from(rawKey, 'utf8');

    for (const streamUrl of streamUrls) {
        try {
            const decoded = Buffer.from(streamUrl.link, 'base64').toString('utf8');
            const [ivBase64, cipherBase64] = decoded.split(':');
            if (!ivBase64 || !cipherBase64) continue;

            const iv = Buffer.from(ivBase64, 'base64');
            const ciphertext = Buffer.from(cipherBase64, 'base64');

            const decipher = crypto.createDecipheriv('aes-256-cbc', keyBytes, iv);
            let decrypted = decipher.update(ciphertext, undefined, 'utf8');
            decrypted += decipher.final('utf8');

            const url = decrypted.trim();
            if (url && url.startsWith('http')) results.push(url);
        } catch (e) {
            // skip bad entry
        }
    }
    return results;
}

async function fetchServer(tmdbId, serverId, type, season, episode) {
    try {
        let url = `${BASE_URL}/api/server?id=${tmdbId}&sr=${serverId}`;
        if (type === 'tv' && season && episode) {
            url += `&ss=${season}&ep=${episode}`;
        }
        const { data } = await proxyAxios.get(url, { headers: HEADERS, timeout: 8000 });
        return data;
    } catch {
        return null;
    }
}

export async function scrapeVidZee(tmdbId, type, season, episode) {
    try {
        // Hit all 14 servers concurrently
        const serverPromises = Array.from({ length: 14 }, (_, i) =>
            fetchServer(tmdbId, i, type, season, episode)
        );
        const results = await Promise.allSettled(serverPromises);

        const subtitleMap = new Map();
        const allUrls = [];

        for (const result of results) {
            if (result.status !== 'fulfilled' || !result.value?.url) continue;
            const { url: streamUrls, tracks } = result.value;

            // Collect subtitles
            for (const track of (tracks || [])) {
                if (track.url && track.lang && !subtitleMap.has(track.lang)) {
                    subtitleMap.set(track.lang, { url: track.url, lang: track.lang });
                }
            }

            // Decrypt stream URLs
            const decrypted = decryptUrls(streamUrls || []);
            allUrls.push(...decrypted);
        }

        // Deduplicate
        const uniqueUrls = [...new Set(allUrls)].filter(u => u.startsWith('http'));

        if (uniqueUrls.length === 0) return null;

        // Map to source objects — use appropriate referer per CDN domain
        const sources = uniqueUrls.map(url => {
            let referer = `${BASE_URL}/`;
            if (url.includes('fast33lane')) referer = 'https://rapidairmax.site/';
            return {
                url,
                quality: 'auto',
                isM3U8: true,
                referer
            };
        });

        return {
            success: true,
            provider: 'VidZee ⚡ (Direct)',
            sources,
            subtitles: Array.from(subtitleMap.values())
        };
    } catch (e) {
        return null;
    }
}
