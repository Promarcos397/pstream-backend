import { proxyAxios } from '../utils/http.js';

/**
 * VixSrc Extractor (Updated 2026-04-12)
 * 
 * The page renders a `window.masterPlaylist` object with:
 *   { params: { token, expires, asn }, url: 'https://vixsrc.to/playlist/{id}' }
 * 
 * Final URL = url + "?token=" + token + "&expires=" + expires + "&h=1"
 */
export async function scrapeVixSrc(tmdbId, type, s, e) {
    const baseUrl = 'https://vixsrc.to';
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': baseUrl,
        'Origin': baseUrl
    };

    try {
        const pageUrl = type === 'movie'
            ? `${baseUrl}/movie/${tmdbId}`
            : `${baseUrl}/tv/${tmdbId}/${s}/${e}`;

        console.log(`[VixSrc] Fetching: ${pageUrl}`);
        const { data: html } = await proxyAxios.get(pageUrl, { headers, timeout: 10000 });

        // New extraction: window.masterPlaylist object in inline <script>
        const playlistUrlMatch = html.match(/url\s*:\s*['"]([^'"]+)['"]/);
        const tokenMatch       = html.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
        const expiresMatch     = html.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/);

        if (!playlistUrlMatch || !tokenMatch || !expiresMatch) {
            console.log('[VixSrc] Could not find masterPlaylist tokens');
            return null;
        }

        const playlistUrl = playlistUrlMatch[1];
        const token       = tokenMatch[1];
        const expires     = expiresMatch[1];

        const separator = playlistUrl.includes('?') ? '&' : '?';
        const finalUrl  = `${playlistUrl}${separator}token=${token}&expires=${expires}&h=1`;

        console.log(`[VixSrc] ✅ Resolved: ${finalUrl}`);

        return {
            success: true,
            provider: 'VixSrc ⚡',
            sources: [{
                url: finalUrl,
                quality: '1080p',
                isM3U8: true,
                referer: `${baseUrl}/`
            }],
            subtitles: []
        };

    } catch (error) {
        console.error(`[VixSrc] Error: ${error.message}`);
        return null;
    }
}
