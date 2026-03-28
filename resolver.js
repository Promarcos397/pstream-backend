import axios from 'axios';
import { redis } from './index.js';

// --- UTILS ---

const digitToLetterMap = (digit) => {
    const map = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    return map[parseInt(digit, 10)];
};

const encodeTmdbId = (tmdb, type, season, episode) => {
    let raw;
    if (type === 'tv' && season && episode) {
        raw = `${tmdb}-${season}-${episode}`;
    } else {
        raw = String(tmdb).split('').map(digitToLetterMap).join('');
    }
    const reversed = raw.split('').reverse().join('');
    return Buffer.from(Buffer.from(reversed).toString('base64')).toString('base64');
};

async function stringAtob(input) {
    return Buffer.from(input, 'base64').toString('binary');
}

// --- SCRAPERS ---

const PROXY_CONFIG = process.env.ISP_PROXY_URL ? {
    proxy: {
        host: process.env.ISP_PROXY_HOST,
        port: process.env.ISP_PROXY_PORT,
        auth: {
            username: process.env.ISP_PROXY_USERNAME,
            password: process.env.ISP_PROXY_PASSWORD
        }
    }
} : {};

const DOMAINS = {
    vidsrc: 'https://vidsrc.vip',
    vidsrc_cc: 'https://vidsrc.cc',
    embedsu: 'https://embed.su',
    autoembed: 'https://player.autoembed.cc',
    nunflix: 'https://nunflix.top', // fallback domain
    mama: 'https://mama.up.railway.app/api/showbox',
    multiembed: 'https://multiembed.mov'
};

/**
 * VidSrc.vip Scraper (Request-based)
 */
async function scrapeVidSrcVip(tmdbId, type, season, episode) {
    try {
        const baseUrl = DOMAINS.vidsrc;
        const url = type === 'tv' 
            ? `${baseUrl}/embed/tv/${tmdbId}/${season}/${episode}`
            : `${baseUrl}/embed/movie/${tmdbId}`;

        console.log(`[GigaResolver] Trying VidSrcVip: ${url}`);
        
        // Use ISP proxy for the initial page fetch to bypass Turnstile
        const { data } = await axios.get(url, {
            ...PROXY_CONFIG,
            headers: { 'Referer': 'https://google.com' },
            timeout: 5000
        });

        if (!data || !data.source1) return null;

        const sources = [];
        for (let i = 1; data[`source${i}`]; i++) {
            const s = data[`source${i}`];
            if (s?.url) {
                sources.push({
                    url: s.url,
                    quality: 'auto',
                    isM3U8: s.url.includes('.m3u8'),
                    provider: 'VidSrc.vip'
                });
            }
        }
        return sources.length > 0 ? { success: true, sources, provider: 'VidSrc.vip' } : null;
    } catch (e) {
        console.warn(`[GigaResolver] VidSrc.vip failed`);
        return null;
    }
}

/**
 * VidSrc.cc Scraper (Mirror)
 */
async function scrapeVidSrcCc(tmdbId, type, season, episode) {
    try {
        const baseUrl = DOMAINS.vidsrc_cc;
        const url = type === 'tv' 
            ? `${baseUrl}/v2/embed/tv/${tmdbId}/${season}/${episode}`
            : `${baseUrl}/v2/embed/movie/${tmdbId}`;

        console.log(`[GigaResolver] Trying VidSrcCc: ${url}`);
        
        const { data } = await axios.get(url, {
            ...PROXY_CONFIG,
            headers: { 'Referer': 'https://google.com' },
            timeout: 5000
        });

        if (!data || !data.source1) return null;

        const sources = [];
        for (let i = 1; data[`source${i}`]; i++) {
            const s = data[`source${i}`];
            if (s?.url) {
                sources.push({
                    url: s.url,
                    quality: 'auto',
                    isM3U8: s.url.includes('.m3u8'),
                    provider: 'VidSrc.cc'
                });
            }
        }
        return sources.length > 0 ? { success: true, sources, provider: 'VidSrc.cc' } : null;
    } catch (e) {
        console.warn(`[GigaResolver] VidSrc.cc failed`);
        return null;
    }
}

/**
 * Embed.su Scraper (Request-based, extracted from production)
 */
async function scrapeEmbedSu(tmdbId, type, season, episode) {
    try {
        const embedUrl = `https://embed.su/embed/${type === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`}`;
        console.log(`[GigaResolver] Trying Embed.su: ${embedUrl}`);
        
        const { data: embedPage } = await axios.get(embedUrl, {
            headers: {
                'Referer': 'https://embed.su/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            timeout: 5000
        });

        const vConfigMatch = embedPage.match(/window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+)/i);
        const encodedConfig = vConfigMatch?.[1];
        if (!encodedConfig) return null;

        const decodedConfig = JSON.parse(await stringAtob(encodedConfig));
        if (!decodedConfig?.hash) return null;

        const firstDecode = (await stringAtob(decodedConfig.hash))
            .split('.')
            .map((item) => item.split('').reverse().join(''));

        const secondDecode = JSON.parse(await stringAtob(firstDecode.join('').split('').reverse().join('')));

        if (!secondDecode?.length) return null;

        const sources = secondDecode.map((server) => ({
            url: `https://embed.su/api/e/${server.hash}`,
            quality: 'auto',
            isM3U8: true, // embed.su usually returns HLS embeds
            provider: 'Embed.su'
        }));

        return { success: true, sources, provider: 'Embed.su' };
    } catch (e) {
        console.warn(`[GigaResolver] Embed.su failed: ${e.message}`);
        return null;
    }
}

/**
 * Autoembed Scraper (Request-based)
 */
async function scrapeAutoembed(tmdbId, type, season, episode) {
    try {
        const apiUrl = 'https://tom.autoembed.cc';
        const mediaType = type === 'tv' ? 'tv' : 'movie';
        const id = type === 'tv' ? `${tmdbId}/${season}/${episode}` : tmdbId;

        console.log(`[GigaResolver] Trying Autoembed: ${apiUrl}/api/getVideoSource?type=${mediaType}&id=${id}`);
        const { data } = await axios.get(`${apiUrl}/api/getVideoSource`, {
            params: { type: mediaType, id },
            headers: { 'Referer': apiUrl, 'Origin': apiUrl },
            timeout: 5000
        });

        if (!data || !data.videoSource) return null;

        return {
            success: true,
            sources: [{
                url: data.videoSource,
                quality: 'auto',
                isM3U8: data.videoSource.includes('.m3u8'),
                provider: 'Autoembed'
            }],
            provider: 'Autoembed'
        };
    } catch (e) {
        console.warn(`[GigaResolver] Autoembed failed: ${e.message}`);
        return null;
    }
}

/**
 * Nunflix Scraper (High Quality API)
 */
async function scrapeNunflix(tmdbId, type, season, episode) {
    try {
        const url = type === 'tv'
            ? `${DOMAINS.mama}/tv/${tmdbId}?season=${season}&episode=${episode}`
            : `${DOMAINS.mama}/movie/${tmdbId}`;

        console.log(`[GigaResolver] Trying Nunflix: ${url}`);
        const { data } = await axios.get(url, { timeout: 8000 });

        if (!data || !data.success || !data.streams) return null;

        const streamItems = Array.isArray(data.streams) ? data.streams : [data.streams];
        const bestItem = streamItems[0];
        const playerStream = bestItem.player_streams?.[0];

        if (!playerStream) return null;

        return {
            provider: 'Nunflix',
            sources: [{
                url: playerStream.file,
                isM3U8: playerStream.file.includes('.m3u8'),
                quality: playerStream.quality || bestItem.quality
            }],
            subtitles: []
        };
    } catch (e) {
        return null;
    }
}

// --- MASTER RESOLVER ---

export async function resolveStream(tmdbId, type, season, episode, imdbId) {
    const cacheKey = `stream:${type}:${tmdbId}:${season || 0}:${episode || 0}`;

    // 1. Check Redis Cache (The "Sprint" - 5ms)
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                console.log(`[GigaResolver] Redis HIT: ${cacheKey}`);
                return JSON.parse(cached);
            }
        } catch (e) {
            console.error('[GigaResolver] Redis error:', e.message);
        }
    }

    // Combine any available IDs (TMDB or IMDB)
    const targetIds = [tmdbId, imdbId].filter(id => id && String(id).trim().length > 0);

    // 2. Race fast request-based scrapers across ALL IDs (Dual-Wielding)
    const fastScrapers = [];

    for (const id of targetIds) {
        fastScrapers.push(
            scrapeVidSrcVip(id, type, season, episode),
            scrapeVidSrcCc(id, type, season, episode),
            scrapeEmbedSu(id, type, season, episode),
            scrapeAutoembed(id, type, season, episode),
            scrapeNunflix(id, type, season, episode)
        );
    }

    try {
        // Promise.any waits for the first SUCCESSFUL result
        const winner = await Promise.any(fastScrapers.map(p => p.then(res => {
            if (res && res.success) return res;
            throw new Error('Failed');
        })));
        
        if (winner) {
            console.log(`[GigaResolver] Winner found: ${winner.provider}`);
            
            // Store in Redis (TTL: 45 minutes)
            if (redis) {
                await redis.setex(cacheKey, 2700, JSON.stringify(winner));
                console.log(`[GigaResolver] Redis STORED: ${cacheKey}`);
            }
            
            return winner;
        }
    } catch (e) {
        // All fast scrapers failed across all IDs
    }

    console.log('[GigaResolver] All primary sources failed. Falling back to Embedded Player.');
    
    const fallbackId = imdbId && String(imdbId).trim() !== '' ? imdbId : tmdbId;
    if (!fallbackId) return { success: false, error: 'No valid ID provided for fallback' };

    const isImdb = String(fallbackId).startsWith('tt');
    const paramName = isImdb ? 'imdb' : 'tmdb';

    const fallbackUrl = type === 'tv'
        ? `https://vidsrc-embed.su/embed/tv?${paramName}=${fallbackId}&season=${season}&episode=${episode}&ds_lang=en&autoplay=1&autonext=1`
        : `https://vidsrc-embed.su/embed/movie?${paramName}=${fallbackId}&ds_lang=en&autoplay=1`;

    const embedResult = {
        success: true,
        provider: 'VidSrcEmbed.su',
        sources: [{
            url: fallbackUrl,
            quality: 'auto',
            isM3U8: false,
            isEmbed: true
        }],
        subtitles: []
    };

    if (redis) {
        await redis.setex(cacheKey, 600, JSON.stringify(embedResult));
    }

    return embedResult;
}
