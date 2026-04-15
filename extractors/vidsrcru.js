/**
 * VidSrc (vsembed.ru) Extractor — ported from CinePro
 * 3-hop HTML scraping chain → extracts multi-quality M3U8 from cloudnestra.com CDN.
 * Does NOT use IP-signed tokens.
 */
import { proxyAxios } from '../utils/http.js';

const BASE_URL = 'https://vsembed.ru';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
    Referer: BASE_URL + '/'
};

// CinePro's domain placeholder map (from vidzee player internals)
const PLAYER_DOMAINS = {
    '{v1}': 'neonhorizonworkshops.com',
    '{v2}': 'wanderlynest.com',
    '{v3}': 'orchidpixelgardens.com',
    '{v4}': 'cloudnestra.com'
};

async function fetchPage(url) {
    try {
        if (url.startsWith('//')) url = 'https:' + url;
        const { data, status } = await proxyAxios.get(url, { headers: HEADERS, timeout: 10000 });
        return status === 200 ? data : null;
    } catch {
        return null;
    }
}

function extractIframeSrc(html) {
    const match = html.match(/<iframe[^>]*\s+src=["']([^"']+)["'][^>]*>/i);
    return match ? match[1] : null;
}

function extractRelSrc(html) {
    const match = html.match(/src:\s*['"]([^'"]+)['"]/i);
    return match ? match[1] : null;
}

function extractM3u8Urls(html) {
    const match = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (!match) return [];

    const rawUrls = match[1].split(/\s+or\s+/i);
    return rawUrls.map(template => {
        let url = template;
        for (const [placeholder, domain] of Object.entries(PLAYER_DOMAINS)) {
            url = url.replaceAll(placeholder, domain);
        }
        return (url.includes('{') || url.includes('}')) ? null : url;
    }).filter(Boolean);
}

export async function scrapeVidSrc(tmdbId, type, season, episode) {
    try {
        // Step 1: load the embed page
        const pageUrl = type === 'movie'
            ? `${BASE_URL}/embed/movie?tmdb=${tmdbId}`
            : `${BASE_URL}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;

        const html1 = await fetchPage(pageUrl);
        if (!html1) return null;

        // Step 2: follow iframe src
        const iframeSrc = extractIframeSrc(html1);
        if (!iframeSrc) return null;

        const html2 = await fetchPage(iframeSrc);
        if (!html2) return null;

        // Step 3: follow relative src to final player page
        const relSrc = extractRelSrc(html2);
        if (!relSrc) return null;

        const finalUrl = new URL(relSrc, iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc).href;
        const html3 = await fetchPage(finalUrl);
        if (!html3) return null;

        // Extract M3U8 URLs
        const m3u8Urls = extractM3u8Urls(html3);
        if (m3u8Urls.length === 0) return null;

        const sources = m3u8Urls.map(url => ({
            url,
            quality: 'auto',
            isM3U8: true,
            noProxy: true,      // neonhorizonworkshops CDN blocks server IPs; browser fetch works
            referer: 'https://cloudnestra.com/'
        }));

        return {
            success: true,
            provider: 'VidSrc.ru 🌐 (Direct)',
            sources,
            subtitles: []
        };
    } catch (e) {
        return null;
    }
}
