/**
 * SuperEmbed / Multiembed Extractor (multiembed.mov)
 * Hits public embed API, extracts direct M3U8.
 * Does NOT require auth or keys. No IP-locking on CDN.
 * Confirmed active 2025-2026.
 */
import { gigaAxios } from '../utils/http.js';

const BASE_URL = 'https://multiembed.mov';
const PLAYER_API = 'https://multiembed.mov/directstream.php';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${BASE_URL}/`,
};

export async function scrapeSuperEmbed(tmdbId, type, season, episode) {
    try {
        // Build the embed URL
        const params = type === 'movie'
            ? `video_id=${tmdbId}&tmdb=1`
            : `video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;

        const embedUrl = `${BASE_URL}/?${params}`;
        console.log(`[SuperEmbed] Fetching embed page...`);

        const { data: html } = await gigaAxios.get(embedUrl, { headers: HEADERS, timeout: 12000 });

        // Extract iframe or direct player URL
        const iframeMatch = html.match(/src=["']([^"']*(?:streamtape|dood|vidhide|streamwish|filemoon|filelion)[^"']*)["']/i)
            || html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);

        if (!iframeMatch) {
            // Try the directstream API
            const directUrl = `${PLAYER_API}?${params}`;
            const { data: directHtml } = await gigaAxios.get(directUrl, { headers: HEADERS, timeout: 10000 });
            
            const m3u8Match = directHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
            if (m3u8Match) {
                return {
                    success: true,
                    provider: 'SuperEmbed ⚡',
                    sources: [{ url: m3u8Match[1], quality: 'auto', isM3U8: true, referer: `${BASE_URL}/` }],
                    subtitles: []
                };
            }
            console.log('[SuperEmbed] No direct stream found');
            return null;
        }

        const playerUrl = iframeMatch[1].startsWith('//') ? `https:${iframeMatch[1]}` : iframeMatch[1];
        console.log(`[SuperEmbed] Resolving player: ${playerUrl.substring(0, 60)}...`);

        // Fetch the player page
        const { data: playerHtml } = await gigaAxios.get(playerUrl, { 
            headers: { ...HEADERS, Referer: embedUrl },
            timeout: 10000 
        });

        // Extract M3U8 URL from player
        const m3u8Match = playerHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)
            || playerHtml.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i);

        if (!m3u8Match) {
            console.log('[SuperEmbed] No M3U8 found in player page');
            return null;
        }

        // Extract subtitles if present
        const subtitles = [];
        const trackMatches = playerHtml.matchAll(/\{\s*file\s*:\s*["']([^"']+\.(?:srt|vtt))["'][^}]*label\s*:\s*["']([^"']*)["'][^}]*\}/gi);
        for (const match of trackMatches) {
            subtitles.push({ url: match[1], lang: match[2].toLowerCase().slice(0, 2), label: match[2] });
        }

        console.log(`[SuperEmbed] ✅ Resolved M3U8`);
        return {
            success: true,
            provider: 'SuperEmbed 🌐',
            sources: [{ url: m3u8Match[1], quality: 'auto', isM3U8: true, referer: playerUrl }],
            subtitles
        };
    } catch (e) {
        console.warn(`[SuperEmbed] Error: ${e.message}`);
        return null;
    }
}
