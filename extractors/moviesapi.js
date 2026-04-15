/**
 * MoviesAPI Extractor — v2 (ww2.moviesapi.to)
 * 
 * The real API is at: ww2.moviesapi.to/api/movie/{tmdb_id}
 * Returns JSON with video_url (a flixcdn.cyou shortlink) and subtitle info.
 * 
 * flixcdn.cyou/#hash format: we need to follow the redirect or decode it.
 * Fallback: try vidsrc.xyz embed which moviesapi uses internally.
 */
import { gigaAxios, proxyAxios } from '../utils/http.js';

const API_BASE = 'https://ww2.moviesapi.to';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, */*',
    'Referer': `${API_BASE}/`,
    'Origin': API_BASE,
};

// Follow a video_url from moviesapi to get the actual stream
async function resolveVideoUrl(videoUrl) {
    try {
        // flixcdn.cyou/#hash — fetch the page and look for the actual stream
        if (videoUrl.includes('flixcdn') || videoUrl.includes('#')) {
            const cleanUrl = videoUrl.split('#')[0] + (videoUrl.includes('#') ? '#' + videoUrl.split('#')[1] : '');
            const { data: html } = await proxyAxios.get(cleanUrl, {
                headers: { ...HEADERS, Accept: 'text/html' },
                timeout: 8000
            });

            // Look for HLS source in the player HTML
            const m3u8Match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)
                || html.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/i);
            if (m3u8Match) return m3u8Match[1];
        }
    } catch (e) {
        // ignore
    }
    return null;
}

export async function scrapeMoviesApi(tmdbId, type, season, episode) {
    try {
        const apiUrl = type === 'movie'
            ? `${API_BASE}/api/movie/${tmdbId}`
            : `${API_BASE}/api/tv/${tmdbId}?season=${season}&episode=${episode}`;

        console.log(`[MoviesAPI] Fetching JSON API: ${apiUrl}`);
        const { data } = await gigaAxios.get(apiUrl, { headers: HEADERS, timeout: 12000 });

        if (!data?.video_url) {
            console.log('[MoviesAPI] No video_url in API response');
            return null;
        }

        // Parse subtitles from the URL query params (they're URL-encoded JSON)
        let subtitles = [];
        try {
            const url = new URL(data.video_url);
            const subsParam = url.searchParams.get('subs');
            if (subsParam) {
                const subsData = JSON.parse(decodeURIComponent(subsParam));
                subtitles = subsData.map((s) => ({
                    url: s.url,
                    lang: (s.language || 'en').slice(0, 2).toLowerCase(),
                    label: s.label || 'English'
                }));
            }
        } catch (e) { /* ignore */ }

        // Try to resolve the actual M3U8 URL
        const m3u8Url = await resolveVideoUrl(data.video_url);

        if (!m3u8Url) {
            // Can't resolve to direct M3U8, return the video_url as potential embed
            console.log('[MoviesAPI] Could not resolve to direct M3U8 — video_url:', data.video_url.substring(0, 80));
            return null;
        }

        console.log(`[MoviesAPI] ✅ Resolved M3U8. Subtitles: ${subtitles.length}`);
        return {
            success: true,
            provider: 'MoviesAPI 🎬',
            sources: [{ url: m3u8Url, quality: 'auto', isM3U8: true, referer: `${API_BASE}/` }],
            subtitles
        };
    } catch (e) {
        console.warn(`[MoviesAPI] Error: ${e.message}`);
        return null;
    }
}
