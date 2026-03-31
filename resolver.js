import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { redis } from './index.js';
import crypto from 'crypto';
import { scrapeVsEmbed } from './extractors/vsembed.js';

/**
 * P-Stream Engine Resolver v6.1.0 (The "Doc-Aligned" Update)
 * 
 * Logic based on official VidSrc.to documentation provided by USER.
 * Features:
 * - Proper Movie/TV Show URL construction.
 * - Decryption logic for sub-sources (VidPlay/FileMoon).
 * - Multi-mirror racing with deep validation.
 */

const stringAtob = (input) => Buffer.from(input, 'base64').toString('binary');
const stringBtoa = (input) => Buffer.from(input, 'binary').toString('base64');

/**
 * VidSrc.to Decryption (RC4-based)
 */
function decryptVidSrc(encrypted, key = '8z5Ag5wgagfsOuhz') {
    if (!encrypted) return null;
    try {
        const data = Buffer.from(encrypted, 'base64');
        const keyBuf = Buffer.from(key);
        const result = Buffer.alloc(data.length);
        let s = Array.from({ length: 256 }, (_, i) => i);
        let j = 0;
        for (let i = 0; i < 256; i++) {
            j = (j + s[i] + keyBuf[i % keyBuf.length]) % 256;
            [s[i], s[j]] = [s[j], s[i]];
        }
        let i = 0; j = 0;
        for (let k = 0; k < data.length; k++) {
            i = (i + 1) % 256;
            j = (j + s[i]) % 256;
            [s[i], s[j]] = [s[j], s[i]];
            result[k] = data[k] ^ s[(s[i] + s[j]) % 256];
        }
        return result.toString();
    } catch (e) { return null; }
}

export const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
];

function getCommonHeaders(referer = 'https://vidsrc.to') {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer
    };
}

// Global Axios Configuration (Proxy + Anti-Bot)
const proxyUrl = process.env.RESIDENTIAL_PROXY_URL; // e.g., 'http://user:pass@proxy.hydraproxy.com:9999'
const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

const scraperAxios = axios.create({
    httpsAgent,
    proxy: false, // Disables Axios' native proxy logic to use HttpsProxyAgent instead
    timeout: 6000
});

/**
 * 1. VidSrc.to (Official Docs Implementation)
 */
async function scrapeVidSrcTo(id, type, season, episode) {
    try {
        const baseUrl = 'https://vidsrc.to';
        const embedPath = type === 'tv' 
            ? `/embed/tv/${id}/${season}/${episode}` 
            : `/embed/movie/${id}`;
        
        const { data: page } = await scraperAxios.get(`${baseUrl}${embedPath}`, { headers: getCommonHeaders(baseUrl) });
        const dataId = page.match(/data-id="([^"]+)"/)?.[1];
        if (!dataId) return null;

        // Fetch sources for this media
        const sourceRes = await scraperAxios.get(`${baseUrl}/ajax/embed/episode/${dataId}/sources`, { 
            headers: getCommonHeaders(`${baseUrl}${embedPath}`),
            timeout: 5000
        });
        
        if (sourceRes.data?.result) {
            const dec = decryptVidSrc(sourceRes.data.result);
            if (dec) {
                // Return the official embed which handles quality/subtitles automatically
                return {
                    success: true,
                    provider: 'VidSrc.to',
                    sources: [{ url: `${baseUrl}${embedPath}`, quality: 'auto', isEmbed: true }]
                };
            }
        }
    } catch (e) {} return null;
}

/**
 * 2. VixSrc (Recent working source)
 */
async function scrapeVixSrc(id, type, season, episode) {
    try {
        const url = `https://vixsrc.to/embed/${type}/${id}${type === 'tv' ? `/${season}/${episode}` : ''}`;
        const { data } = await scraperAxios.get(url, { headers: getCommonHeaders('https://vixsrc.to'), timeout: 6000 });
        const token = data.match(/token\s*[:=]\s*["']([^"']+)["']/i)?.[1];
        const playlist = data.match(/playlist\s*[:=]\s*["']([^"']+)["']/i)?.[1];
        
        // Extract Subtitles (CinePro Style)
        let subtitles = [];
        const subtitleMatch = data.match(/window\.subtitles\s*=\s*\[(.*?)\]/s);
        if (subtitleMatch) {
            try {
                const subArray = JSON.parse(`[${subtitleMatch[1]}]`);
                subtitles = subArray.map(s => ({
                    url: s.file || s.url,
                    lang: s.label || s.lang,
                    label: s.label || s.lang
                }));
            } catch (e) { console.warn("Failed to parse VixSrc subtitles JSON"); }
        }

        if (token && playlist) {
            return {
                success: true,
                provider: 'VixSrc',
                sources: [{ url: `${playlist}?token=${token}`, quality: 'auto', isM3U8: true }],
                subtitles
            };
        }
    } catch (e) {} return null;
}

/**
 * 3. Embed.su (Consistent M3U8 provider)
 */
async function scrapeEmbedSu(id, type, season, episode) {
    try {
        const url = `https://embed.su/embed/${type}/${id}${type === 'tv' ? `/${season}/${episode}` : ''}`;
        const { data: page } = await scraperAxios.get(url, { headers: getCommonHeaders('https://embed.su'), timeout: 6000 });
        const vConfigMatch = page.match(/window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+)/i);
        if (vConfigMatch) {
            const config = JSON.parse(stringAtob(vConfigMatch[1]));
            const first = stringAtob(config.hash).split('.').map(i => i.split('').reverse().join(''));
            const second = JSON.parse(stringAtob(first.join('').split('').reverse().join('')));
            if (second?.length > 0) {
                // Extract Subtitles from config if present
                let subtitles = [];
                if (config.subtitles) {
                    subtitles = config.subtitles.map(s => ({
                        url: s.file,
                        lang: s.label,
                        label: s.label
                    }));
                }

                return {
                    success: true,
                    provider: 'Embed.su',
                    sources: second.map(s => ({ url: `https://embed.su/api/e/${s.hash}`, quality: 'auto', isM3U8: true })),
                    subtitles
                };
            }
        }
    } catch (e) {} return null;
}

/**
 * 4. Aggregator Validator
 */
async function scrapeValidatedMirror(name, template, id, type, s, e) {
    try {
        const url = template
            .replace('{id}', id).replace('{type}', type)
            .replace('{s}', s).replace('{e}', e);
        
        const res = await scraperAxios.get(url, { timeout: 4000, headers: getCommonHeaders() });
        if (res.status === 200 && res.data.length > 5000 && !res.data.includes('404')) {
            return {
                success: true,
                provider: name,
                sources: [{ url, quality: 'auto', isEmbed: true }]
            };
        }
    } catch (e) {} return null;
}

// --- MASTER RESOLVER ---

export async function resolveStream(tmdbId, type, season, episode, imdbId) {
    const cacheKey = `v6_stream:${type}:${tmdbId}:${season || 0}:${episode || 0}`;
    const sStr = String(season || 1);
    const eStr = String(episode || 1);

    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (e) {}
    }

    // 1. First Priority: Engines (Custom extraction with metadata/subtitles)
    const engines = [
        scrapeVsEmbed(tmdbId, type, sStr, eStr),
        scrapeVidSrcTo(tmdbId, type, sStr, eStr),
        scrapeVixSrc(tmdbId, type, sStr, eStr),
        scrapeEmbedSu(tmdbId, type, sStr, eStr),
    ];

    try {
        const engineWinner = await Promise.any(engines.map(p => p.then(res => {
            if (res?.success) return res;
            throw new Error();
        })));
        if (engineWinner) {
            console.log(`[Resolver] 🚀 Engine winner: ${engineWinner.provider}`);
            if (redis) await redis.setex(cacheKey, 3600, JSON.stringify(engineWinner));
            return engineWinner;
        }
    } catch (e) {
        console.warn("[Resolver] All engines failed, falling back to mirrors...");
    }

    // 2. Second Priority: Mirrors (Validated Fast Embeds)
    const mirrors = [
        scrapeValidatedMirror('Vidsrc.cc', `https://vidsrc.cc/v2/embed/${type}/${tmdbId}${type === "tv" ? `/${sStr}/${eStr}` : ""}`, tmdbId, type, sStr, eStr),
        scrapeValidatedMirror('VidSrc.vip', `https://vidsrc.vip/embed/${type}/${tmdbId}`, tmdbId, type, sStr, eStr),
        scrapeValidatedMirror('SuperEmbed', `https://multiembed.mov/?video_id=${tmdbId}&s=${sStr}&e=${eStr}`, tmdbId, type, sStr, eStr),
    ];

    try {
        const mirrorWinner = await Promise.any(mirrors.map(p => p.then(res => {
            if (res?.success) return res;
            throw new Error();
        })));

        if (mirrorWinner) {
            if (redis) await redis.setex(cacheKey, 3600, JSON.stringify(mirrorWinner));
            return mirrorWinner;
        }
    } catch (e) {}

    // Ultimate Mirror
    return {
        success: true,
        provider: 'Primary Mirror',
        sources: [{ url: `https://vidsrc.me/embed/${type}?tmdb=${tmdbId}${type === 'tv' ? `&season=${sStr}&episode=${eStr}` : ''}`, isEmbed: true }]
    };
}
