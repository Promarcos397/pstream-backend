/**
 * NontonGo / NHL Extractor (nontongo.win)
 * Hits public API → JSON response with M3U8 URLs directly.
 * No Cloudflare, no token, no IP-lock.
 * Confirmed active 2025-2026.
 */
import { gigaAxios } from '../utils/http.js';

const API_BASE = 'https://www.nontongo.win';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Referer': `${API_BASE}/`,
    'Origin': API_BASE,
};

export async function scrapeNontonGo(tmdbId, type, season, episode) {
    try {
        const apiUrl = type === 'movie'
            ? `${API_BASE}/api/v1/content?id=${tmdbId}&type=movie`
            : `${API_BASE}/api/v1/content?id=${tmdbId}&type=series&season=${season}&episode=${episode}`;

        console.log(`[NontonGo] Fetching: ${apiUrl}`);
        const { data } = await gigaAxios.get(apiUrl, { headers: HEADERS, timeout: 10000 });

        if (!data?.url) {
            console.log('[NontonGo] No URL in response');
            return null;
        }

        const m3u8Url = data.url;
        const subtitles = (data.subtitles || []).map(s => ({
            url: s.url,
            lang: (s.lang || s.language || 'en').toLowerCase().slice(0, 2),
            label: s.label || s.language || 'English'
        }));

        console.log('[NontonGo] ✅ Resolved M3U8');
        return {
            success: true,
            provider: 'NontonGo 🌏',
            sources: [{ url: m3u8Url, quality: 'auto', isM3U8: true, referer: `${API_BASE}/` }],
            subtitles
        };
    } catch (e) {
        console.warn(`[NontonGo] Error: ${e.message}`);
        return null;
    }
}
