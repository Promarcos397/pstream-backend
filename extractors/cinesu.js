/**
 * CineSu Direct Extractor — v1.0 (2026-05-02)
 *
 * CineSu (cine.su) serves raw HLS master playlists directly at a clean,
 * predictable URL pattern. No scraping needed — just TMDB ID + type.
 *
 * This was discovered via Vyla's API response (Vyla already scrapes CineSu
 * internally and returns the URL with correct headers). We hit it directly
 * to get a fast, independent source not dependent on Vyla being up.
 *
 * Endpoints:
 *   Movie: GET https://cine.su/v1/stream/master/movie/{tmdbId}.m3u8
 *   TV:    GET https://cine.su/v1/stream/master/tv/{tmdbId}/{season}/{episode}.m3u8
 *
 * Required headers:
 *   User-Agent: Chrome/134
 *   Referer: https://cine.su/en/watch
 *   Origin:  https://cine.su
 *
 * Quality: 1080p HLS (adaptive bitrate, English audio confirmed)
 * Speed:   ~1-2s (CDN-hosted)
 * CORS:    Sends correct headers when Referer/Origin match
 */

import { gigaAxios } from '../utils/http.js';

const BASE     = 'https://cine.su';
const STREAM   = `${BASE}/v1/stream/master`;

const HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6884.98 Safari/537.36',
    'Accept':          'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         `${BASE}/en/watch`,
    'Origin':          BASE,
};

export async function scrapeCineSu(tmdbId, type, season, episode) {
    try {
        let streamUrl;
        if (type === 'movie' || type === 'film') {
            streamUrl = `${STREAM}/movie/${tmdbId}.m3u8`;
        } else {
            const s = parseInt(season)  || 1;
            const e = parseInt(episode) || 1;
            streamUrl = `${STREAM}/tv/${tmdbId}/${s}/${e}.m3u8`;
        }

        console.log(`[CineSu] Probing: ${streamUrl}`);

        // HEAD request first — if the M3U8 exists, we get a 200 quickly without
        // downloading the full playlist. If not available, we skip early.
        const probe = await gigaAxios.head(streamUrl, {
            timeout: 8000,
            headers: HEADERS,
            validateStatus: s => s < 500,
        });

        if (probe.status !== 200) {
            console.warn(`[CineSu] Probe failed: HTTP ${probe.status}`);
            return null;
        }

        console.log(`[CineSu] ✅ Live @ HTTP ${probe.status}`);

        return {
            success:    true,
            provider:   'CineSu',
            providerId: 'cinesu',
            sources: [
                {
                    url:        streamUrl,
                    quality:    '1080p',
                    isM3U8:     true,
                    isEmbed:    false,
                    noProxy:    false,
                    provider:   'CineSu',
                    providerId: 'cinesu',
                    referer:    HEADERS['Referer'],
                    origin:     HEADERS['Origin'],
                    headers:    HEADERS,
                    _type:      'hls',
                }
            ],
            subtitles: [],
        };

    } catch (e) {
        console.warn(`[CineSu] Error: ${e.response?.status || e.message}`);
        return null;
    }
}
