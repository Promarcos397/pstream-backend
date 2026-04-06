import { proxyAxios } from '../utils/http.js';

/**
 * VixSrc Extractor (Ported from CinePro)
 * This provider extracts high-quality HLS streams directly from vixsrc.to
 */
export async function scrapeVixSrc(tmdbId, type, s, e) {
    const baseUrl = 'https://vixsrc.to';
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Referer': baseUrl,
        'Origin': baseUrl
    };

    try {
        const pageUrl = type === 'movie' 
            ? `${baseUrl}/movie/${tmdbId}`
            : `${baseUrl}/tv/${tmdbId}/${s}/${e}`;

        console.log(`[VixSrc] Fetching: ${pageUrl}`);
        const response = await proxyAxios.get(pageUrl, { headers, timeout: 8000 });
        const html = response.data;

        // Extraction logic from CinePro patterns
        const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
        const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
        const playlistUrl = html.match(/url\s*:\s*["']([^"']+)/)?.[1];

        if (!token || !expires || !playlistUrl) {
            console.log('[VixSrc] Failed to find stream tokens in HTML');
            return null;
        }

        const separator = playlistUrl.includes('?') ? '&' : '?';
        const finalUrl = `${playlistUrl}${separator}token=${token}&expires=${expires}&h=1`;

        return {
            success: true,
            provider: 'VixSrc ⚡',
            sources: [{ url: finalUrl, quality: '1080p', isM3U8: true }],
            subtitles: [] // VixSrc typically hardcodes subtitles or uses HLS sidecar
        };

    } catch (error) {
        console.error(`[VixSrc] Error: ${error.message}`);
        return null;
    }
}
