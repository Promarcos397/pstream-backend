/**
 * 2Embed Extractor — v1 (2embed.cc)
 *
 * 2embed.cc has a clean embed URL structure with no auth:
 *   Movie: /embed/{tmdbId}
 *   TV:    /embedtv/{tmdbId}&s={s}&e={e}
 *
 * The embed page loads a player that has a direct M3U8 in its JS config.
 * The CDN used is NOT IP-signed — server-proxied fetch works fine.
 *
 * Confirmed active 2026-04.
 */
import { gigaAxios } from '../utils/http.js';
import { USER_AGENTS } from '../utils/constants.js';

const BASE = 'https://www.2embed.cc';
const UA = USER_AGENTS[0];

const HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE}/`,
};

async function fetchHtml(url, referer = BASE + '/') {
    const { data } = await gigaAxios.get(url, {
        headers: { ...HEADERS, Referer: referer },
        timeout: 12000,
    });
    return data;
}

function extractM3u8(html) {
    // Try multiple formats
    const patterns = [
        /file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i,
        /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i,
        /source\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i,
        /src\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/i,
    ];
    for (const pat of patterns) {
        const m = html.match(pat);
        if (m) return m[1];
    }
    return null;
}

export async function scrape2Embed(tmdbId, type, season, episode) {
    try {
        // Step 1: Get the embed page
        const embedUrl = type === 'movie'
            ? `${BASE}/embed/${tmdbId}`
            : `${BASE}/embedtv/${tmdbId}&s=${encodeURIComponent(season)}&e=${encodeURIComponent(episode)}`;

        console.log(`[2Embed] Fetching embed page...`);
        const html1 = await fetchHtml(embedUrl);

        // Check for Cloudflare block
        if (html1.includes('cloudflare') && html1.includes('cf-browser-verification')) {
            console.warn('[2Embed] Blocked by Cloudflare');
            return null;
        }

        // Look for iframe src pointing to actual player
        const iframeMatch = html1.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (!iframeMatch) {
            // Try direct M3U8 in the page itself
            const direct = extractM3u8(html1);
            if (direct) {
                return {
                    success: true,
                    provider: '2Embed ⚡',
                    sources: [{ url: direct, quality: 'auto', isM3U8: true, referer: embedUrl }],
                    subtitles: []
                };
            }
            console.log('[2Embed] No iframe or direct stream found');
            return null;
        }

        const playerUrl = iframeMatch[1].startsWith('//') ? `https:${iframeMatch[1]}` : iframeMatch[1];
        console.log(`[2Embed] Resolving player: ${playerUrl.substring(0, 80)}...`);

        // Step 2: Fetch the player page
        const html2 = await fetchHtml(playerUrl, embedUrl);
        const m3u8 = extractM3u8(html2);

        if (!m3u8) {
            console.log('[2Embed] No M3U8 in player page');
            return null;
        }

        // Extract subtitles if present  
        const subtitles = [];
        const trackRegex = /\{\s*file\s*:\s*["']([^"']+\.(?:srt|vtt))["'][^}]*label\s*:\s*["']([^"']*)['"]/gi;
        let match;
        while ((match = trackRegex.exec(html2)) !== null) {
            subtitles.push({ url: match[1], lang: match[2].toLowerCase().slice(0, 2), label: match[2] });
        }

        console.log(`[2Embed] ✅ Resolved M3U8, ${subtitles.length} subs`);
        return {
            success: true,
            provider: '2Embed 🎬',
            sources: [{ url: m3u8, quality: 'auto', isM3U8: true, referer: playerUrl }],
            subtitles
        };
    } catch (e) {
        console.warn(`[2Embed] Error: ${e.message}`);
        return null;
    }
}
