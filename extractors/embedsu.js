/**
 * EmbedSoap (embed.su) Extractor — v2
 *
 * embed.su exposes a clean hash-based embed that loads a direct JW Player config.
 * The JW Player config contains the direct M3U8 and subtitle tracks.
 *
 * URL pattern:
 *   Movie: https://embed.su/embed/movie/{tmdbId}
 *   TV:    https://embed.su/embed/tv/{tmdbId}/{season}/{episode}
 *
 * The embed loads a script `_self.js` which has the sources array.
 * CDN: varies per request, NOT IP-signed. Confirmed active 2026.
 */
import { proxyAxios } from '../utils/http.js';
import { USER_AGENTS } from '../utils/constants.js';

const BASE = 'https://embed.su';
const UA = USER_AGENTS[0];

const HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE}/`,
};

function decodeBase64Safe(str) {
    try { return Buffer.from(str, 'base64').toString('utf-8'); } catch { return null; }
}

export async function scrapeEmbedSu(tmdbId, type, season, episode) {
    try {
        const embedPath = type === 'movie'
            ? `/embed/movie/${tmdbId}`
            : `/embed/tv/${tmdbId}/${season}/${episode}`;

        const embedUrl = `${BASE}${embedPath}`;
        console.log(`[EmbedSu] Fetching embed...`);

        const { data: html } = await proxyAxios.get(embedUrl, { headers: HEADERS, timeout: 12000 });

        // Check for Cloudflare
        if (html.includes('cf-browser-verification') || html.includes('cf_clearance')) {
            console.warn('[EmbedSu] CF-blocked');
            return null;
        }

        // embed.su encodes its player config as a base64 blob in a script tag
        // Pattern: JSON.parse(atob("..."))
        const base64Match = html.match(/JSON\.parse\(atob\(["']([A-Za-z0-9+/=]+)["']\)\)/);
        if (base64Match) {
            const decoded = decodeBase64Safe(base64Match[1]);
            if (decoded) {
                let config;
                try { config = JSON.parse(decoded); } catch { config = null; }
                
                if (config) {
                    // Config can be { sources: [{file,label}], tracks: [{file,label,kind}] }
                    const sources = Array.isArray(config.sources) ? config.sources : (config.source ? [config.source] : []);
                    const m3u8Source = sources.find(s => s.file?.includes('.m3u8') || s.src?.includes('.m3u8'));
                    
                    if (m3u8Source) {
                        const m3u8Url = m3u8Source.file || m3u8Source.src;
                        const tracks = config.tracks || config.captions || [];
                        const subtitles = tracks
                            .filter(t => t.kind === 'captions' || t.kind === 'subtitles')
                            .map(t => ({
                                url: t.file || t.src,
                                lang: (t.label || 'en').toLowerCase().slice(0, 2),
                                label: t.label || 'English'
                            }))
                            .filter(s => s.url);

                        console.log(`[EmbedSu] ✅ Config decoded. ${subtitles.length} subs`);
                        return {
                            success: true,
                            provider: 'EmbedSu 🎯',
                            sources: [{ url: m3u8Url, quality: 'auto', isM3U8: true, referer: embedUrl }],
                            subtitles,
                            referer: embedUrl
                        };
                    }
                }
            }
        }

        // Fallback: look for direct M3U8 in page
        const m3u8Match = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i)
            || html.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
        if (m3u8Match) {
            console.log(`[EmbedSu] ✅ Direct M3U8 found`);
            return {
                success: true,
                provider: 'EmbedSu 🎯',
                sources: [{ url: m3u8Match[1], quality: 'auto', isM3U8: true, referer: embedUrl }],
                subtitles: []
            };
        }

        console.log('[EmbedSu] No stream found');
        return null;
    } catch (e) {
        console.warn(`[EmbedSu] Error: ${e.message}`);
        return null;
    }
}
