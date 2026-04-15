import { proxyAxios, gigaAxios } from '../utils/http.js';

/**
 * VixSrc Extractor — Hardened v3 (2026-04-15)
 * 
 * VixSrc exposes a clean JSON API:
 *   GET /api/movie/{tmdbId}  → { src: "/embed/{id}?token=...&expires=..." }
 *   GET /api/tv/{tmdbId}     → { src: "/embed/{id}?token=...&expires=..." }
 * 
 * The embed page is an iframe served from vixcloud.co which contains the M3U8.
 * The /playlist/{id}?token=...&expires=... is the signed M3U8 playlist.
 */
const BASE = 'https://vixsrc.to';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': `${BASE}/`,
    'Origin': BASE,
};

export async function scrapeVixSrc(tmdbId, type, s, e) {
    try {
        // Step 1: Get the signed embed src via JSON API
        const apiPath = type === 'movie'
            ? `/api/movie/${tmdbId}`
            : `/api/tv/${tmdbId}/${s}/${e}`;

        console.log(`[VixSrc] Fetching API: ${BASE}${apiPath}`);
        const { data: apiData } = await proxyAxios.get(`${BASE}${apiPath}`, { headers: HEADERS, timeout: 10000 });

        if (!apiData?.src) {
            console.log('[VixSrc] No src in API response');
            return null;
        }

        // apiData.src is like "/embed/231752?token=...&expires=..."
        const embedSrc = apiData.src.startsWith('http') ? apiData.src : `${BASE}${apiData.src}`;
        const embedUrl = new URL(embedSrc);

        // Extract token and expires from embed URL
        const token = embedUrl.searchParams.get('token');
        const expires = embedUrl.searchParams.get('expires');
        const videoId = embedUrl.pathname.split('/').pop();

        if (!token || !expires || !videoId) {
            console.log('[VixSrc] Missing token/expires/videoId from embed src');
            return null;
        }

        // Step 2: Build the signed playlist URL directly
        // VixSrc playlists are at: {BASE}/playlist/{videoId}?token={token}&expires={expires}&h=1
        const playlistUrl = `${BASE}/playlist/${videoId}?token=${token}&expires=${expires}&h=1`;

        console.log(`[VixSrc] ✅ Resolved: ${playlistUrl.substring(0, 80)}...`);
        return {
            success: true,
            provider: 'VixSrc ⚡',
            sources: [{
                url: playlistUrl,
                quality: '1080p',
                isM3U8: true,
                // noProxy removed: VixSrc CDN 403s browser XHRs because hls.js strips the Referer
                // cross-origin. Route through /proxy/stream which sets Referer: https://vixsrc.to/
                referer: `${BASE}/`
            }],
            subtitles: []
        };

    } catch (error) {
        console.warn(`[VixSrc] Error: ${error.message}`);
        return null;
    }
}
