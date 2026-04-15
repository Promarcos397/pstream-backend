/**
 * VidLink Extractor — Hardened v2 (2026-04-15)
 *
 * VidLink uses a 2-step flow:
 *   1. GET enc-dec.app/api/enc-vidlink?id={tmdbId} → encrypted ID
 *   2. GET vidlink.pro/api/b/{type}/{encId}[/{s}/{e}] → stream JSON
 *
 * The stream JSON contains:
 *   response.data.stream.playlist  → M3U8 URL
 *   response.data.stream.captions  → subtitle array
 *
 * CDN: VidLink uses its own CDN — NOT IP-signed to the scraper IP.
 * Server-proxy works fine.
 */
import { proxyAxios } from '../utils/http.js';
import { USER_AGENTS } from '../utils/constants.js';

const API_BASE = 'https://vidlink.pro';
const ENC_API  = 'https://enc-dec.app/api/enc-vidlink';
const UA = USER_AGENTS[0];

const HEADERS = {
    'User-Agent': UA,
    'Referer': `${API_BASE}/`,
    'Origin': API_BASE,
};

export async function scrapeVidLink(tmdbId, type, season, episode) {
    try {
        // Step 1: Encrypt the TMDB ID
        console.log(`[VidLink] Encrypting ID ${tmdbId}...`);
        const encResp = await proxyAxios.get(ENC_API, {
            params: { id: String(tmdbId) },
            headers: HEADERS,
            timeout: 8000,
        });

        const encryptedId = encResp.data?.id;
        if (!encryptedId) {
            console.warn('[VidLink] Encryption API returned no ID');
            return null;
        }

        // Step 2: Fetch the stream JSON
        let apiUrl = type === 'tv'
            ? `${API_BASE}/api/b/tv/${encryptedId}/${parseInt(season) || 1}/${parseInt(episode) || 1}`
            : `${API_BASE}/api/b/movie/${encryptedId}`;

        console.log(`[VidLink] Fetching stream: ${apiUrl}`);
        const streamResp = await proxyAxios.get(apiUrl, {
            headers: HEADERS,
            timeout: 10000,
        });

        const playlist = streamResp.data?.stream?.playlist;
        if (!playlist) {
            console.warn('[VidLink] No playlist in response');
            return null;
        }

        // Map captions from VidLink format
        const subtitles = (streamResp.data?.stream?.captions || [])
            .filter(c => c?.url)
            .map(c => ({
                url: c.url,
                lang: (c.language || 'en').toLowerCase().slice(0, 2),
                label: c.language || 'English',
            }));

        console.log(`[VidLink] ✅ Resolved. ${subtitles.length} subtitle tracks`);
        return {
            success: true,
            provider: 'VidLink 🔗',
            sources: [{
                url: playlist,
                isM3U8: true,
                quality: 'Auto',
                referer: `${API_BASE}/`,
            }],
            subtitles,
        };
    } catch (e) {
        console.warn(`[VidLink] Error: ${e.message}`);
        return null;
    }
}
