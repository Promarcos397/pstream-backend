/**
 * AutoEmbed Extractor — v3 (2026-04-15)
 *
 * Domain update: tom.autoembed.cc is dead → autoembed.to
 *
 * autoembed.to exposes a clean JSON API (same shape as old domain):
 *   GET /api/getVideoSource?type=movie&id={tmdbId}
 *   GET /api/getVideoSource?type=tv&id={tmdbId}/{season}/{episode}
 *
 * Returns: { videoSource: "https://...m3u8", subtitles: [...] }
 *
 * CDN: Not IP-signed. Server-proxied fetch works fine.
 */
import { proxyAxios } from '../utils/http.js';

const BASE = 'https://autoembed.to';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${BASE}/`,
    'Origin': BASE,
    'Accept': 'application/json, text/plain, */*',
};

export async function scrapeAutoEmbed(tmdbId, type, season, episode) {
    try {
        const idParam = type === 'tv'
            ? `${tmdbId}/${parseInt(season) || 1}/${parseInt(episode) || 1}`
            : String(tmdbId);

        const apiUrl = `${BASE}/api/getVideoSource?type=${type === 'tv' ? 'tv' : 'movie'}&id=${idParam}`;
        console.log(`[AutoEmbed] Fetching: ${apiUrl}`);

        const { data } = await proxyAxios.get(apiUrl, {
            headers: HEADERS,
            timeout: 8000,
        });

        if (!data?.videoSource) {
            console.warn('[AutoEmbed] No videoSource in response');
            return null;
        }

        const subtitles = (data.subtitles || [])
            .filter(s => s?.file)
            .map(s => ({
                url: s.file,
                lang: (s.label || 'en').toLowerCase().slice(0, 2),
                label: s.label || 'English',
            }));

        console.log(`[AutoEmbed] ✅ Resolved. ${subtitles.length} subtitle tracks`);
        return {
            success: true,
            provider: 'AutoEmbed ⚡',
            sources: [{
                url: data.videoSource,
                quality: 'Auto',
                isM3U8: true,
                referer: `${BASE}/`,
            }],
            subtitles,
        };
    } catch (e) {
        console.warn(`[AutoEmbed] Error: ${e.message}`);
        return null;
    }
}
