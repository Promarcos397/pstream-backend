/**
 * P-Stream Giga Engine Resolver v8.0.0
 * "Direct Only — No Embeds"
 *
 * All sources MUST return a direct M3U8 or direct file URL.
 * No iframes. No embeds. No fallback mirrors. If we can't get
 * a direct stream, we return nothing rather than a junk embed.
 *
 * Priority order (concurrent race, M3U8 always wins):
 *  1.  VidLink          — enc-dec.app handshake → HLS + subtitles  [TMDB]
 *  2.  EE3              — Auth API → direct MP4                     [TMDB, movies only]
 *  3.  AutoEmbed        — tom.autoembed.cc API → direct HLS         [TMDB]
 *  4.  VidSrc.to        — RC4 decrypt → Filemoon unpack → M3U8      [TMDB/IMDB]
 *  5.  VidSrc.me/Pro    — XOR decode → M3U8                         [TMDB]
 *  6.  VidNest          — AES-256-GCM decrypt → HLS                 [TMDB]
 *  7.  LookMovie        — JSON API → HLS + full subtitles           [Title+Year]
 *  8.  HDRezka          — Android header bypass → MP4 + subtitles   [Title+Year]
 *  9.  ZoeChip          — HTML scrape → Filemoon → M3U8             [Title+Year]
 * 10.  RidoMovies        — cheerio scrape → HLS mirror               [Title+Year]
 * 11.  VixSrc           — token HLS                                  [TMDB]
 * 12.  Embed.su (Clean) — hash decode → M3U8 (no iframe)            [TMDB]
 * 13.  VsEmbed          — Cloudnestra manifest extract               [TMDB]
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { redis } from './index.js';

// --- Extractors ---
import { scrapeVidLink } from './extractors/vidlink.js';
import { scrapeEE3 } from './extractors/ee3.js';
import { scrapeAutoEmbed } from './extractors/autoembed.js';
import { scrapeVidSrcTo } from './extractors/vidsrcto.js';
import { scrapeVidNest } from './extractors/vidnest.js';
import { scrapeLookMovie } from './extractors/lookmovie.js';
import { scrapeHDRezka } from './extractors/hdrezka.js';
import { scrapeZoeChip } from './extractors/zoechip.js';
import { scrapeRidoMovies } from './extractors/ridomovies.js';
import { scrapeVsEmbed } from './extractors/vsembed.js';
import { scrapeVidZee } from './extractors/vidzee.js';
import { scrapeVidSrc } from './extractors/vidsrcru.js';

export const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const stringAtob = (input) => Buffer.from(input, 'base64').toString('binary');

function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
const scraperAxios = axios.create({ httpsAgent, proxy: false, timeout: 7000 });

// ─── INLINE ENGINES (TMDB-only, no title needed) ──────────────────────────────

async function scrapeVixSrc(tmdbId, type, season, episode) {
    try {
        const url = `https://vixsrc.to/embed/${type}/${tmdbId}${type === 'tv' ? `/${season}/${episode}` : ''}`;
        const { data } = await scraperAxios.get(url, {
            headers: { 'User-Agent': getRandomUA(), Referer: 'https://vixsrc.to' }
        });
        const token = data.match(/token\s*[:=]\s*["']([^"']+)["']/i)?.[1];
        const playlist = data.match(/playlist\s*[:=]\s*["']([^"']+)["']/i)?.[1];

        let subtitles = [];
        const subMatch = data.match(/window\.subtitles\s*=\s*\[(.*?)\]/s);
        if (subMatch) {
            try {
                subtitles = JSON.parse(`[${subMatch[1]}]`).map(s => ({
                    url: s.file || s.url, lang: s.label || s.lang, label: s.label || s.lang
                }));
            } catch (e) {}
        }

        if (token && playlist) {
            return {
                success: true,
                provider: 'VixSrc ⚡',
                sources: [{ url: `${playlist}?token=${token}`, quality: 'auto', isM3U8: true }],
                subtitles
            };
        }
    } catch (e) {}
    return null;
}

async function scrapeEmbedSuDirect(tmdbId, type, season, episode) {
    // embed.su returns final M3U8-resolvable hashes — no iframe presented to user
    try {
        const url = `https://embed.su/embed/${type}/${tmdbId}${type === 'tv' ? `/${season}/${episode}` : ''}`;
        const { data: page } = await scraperAxios.get(url, {
            headers: { 'User-Agent': getRandomUA(), Referer: 'https://embed.su' }
        });
        const vConfigMatch = page.match(/window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+)/i);
        if (!vConfigMatch) return null;

        const config = JSON.parse(stringAtob(vConfigMatch[1]));
        const first = stringAtob(config.hash).split('.').map(i => i.split('').reverse().join(''));
        const second = JSON.parse(stringAtob(first.join('').split('').reverse().join('')));
        if (!second?.length) return null;

        let subtitles = (config.subtitles || []).map(s => ({ url: s.file, lang: s.label, label: s.label }));

        // Resolve the actual M3U8 from the hash API directly
        const resolved = [];
        for (const s of second.slice(0, 3)) { // try first 3 only
            try {
                const { data: streamData } = await scraperAxios.get(`https://embed.su/api/e/${s.hash}`, {
                    headers: { Referer: 'https://embed.su/', 'User-Agent': getRandomUA() },
                    timeout: 5000
                });
                const m3u8 = streamData?.match?.(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/)?.[0]
                    || streamData?.stream?.[0]?.playlist
                    || streamData?.url;
                if (m3u8 && m3u8.includes('.m3u8')) {
                    resolved.push({ url: m3u8, quality: 'auto', isM3U8: true });
                    break;
                }
            } catch (e) {}
        }

        if (!resolved.length) return null;

        return { success: true, provider: 'Embed.su 🎬', sources: resolved, subtitles };
    } catch (e) {}
    return null;
}

async function scrapeVidSrcMe(tmdbId, type, season, episode) {
    try {
        const baseUrl = 'https://vidsrc.me';
        const embedPath = type === 'tv'
            ? `/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`
            : `/embed/movie?tmdb=${tmdbId}`;

        const { data: page } = await scraperAxios.get(`${baseUrl}${embedPath}`, {
            headers: { 'User-Agent': getRandomUA(), Referer: baseUrl }
        });

        const hashMatch = page.match(/data-hash="([^"]+)"/i);
        if (!hashMatch) return null;
        const hash = hashMatch[1];

        const { data: rcpPage } = await scraperAxios.get(`https://vidsrc.stream/rcp/${hash}`, {
            headers: { 'User-Agent': getRandomUA(), Referer: `${baseUrl}${embedPath}` }
        });

        const dataH = rcpPage.match(/data-h="([^"]+)"/i)?.[1];
        const dataI = rcpPage.match(/data-i="([^"]+)"/i)?.[1];
        if (!dataH || !dataI) return null;

        const buf = Buffer.from(dataH, 'hex');
        let decoded = '';
        for (let i = 0; i < buf.length; i++) {
            decoded += String.fromCharCode(buf[i] ^ dataI.charCodeAt(i % dataI.length));
        }
        const decodedUrl = decoded.startsWith('//') ? `https:${decoded}` : decoded;

        const locRes = await scraperAxios.get(decodedUrl, {
            headers: { 'User-Agent': getRandomUA(), Referer: `https://vidsrc.stream/rcp/${hash}` },
            maxRedirects: 0,
            validateStatus: s => s >= 200 && s < 400
        });

        const location = locRes.headers.location;
        if (!location) return null;

        const { data: proPage } = await scraperAxios.get(location, {
            headers: { 'User-Agent': getRandomUA(), Referer: `https://vidsrc.stream/rcp/${hash}` }
        });

        const fileMatch = proPage.match(/file\s*:\s*"([^"]+)"/i) || proPage.match(/file\s*:\s*'([^']+)'/i);
        if (!fileMatch) return null;

        let hlsUrl = fileMatch[1];
        hlsUrl = hlsUrl.replace(/\/\/\S+?=/, '');
        if (hlsUrl.length > 2) hlsUrl = hlsUrl.substring(2);
        hlsUrl = hlsUrl.replace(/\/@#@\/[^=\/]+==\//g, '');
        hlsUrl = hlsUrl.replace(/_/g, '/').replace(/-/g, '+');
        hlsUrl = Buffer.from(hlsUrl, 'base64').toString('utf-8');

        if (!hlsUrl?.includes('.m3u8')) return null;

        const passMatch = proPage.match(/var\s+pass_path\s*=\s*"([^"]+)";/i);
        if (passMatch) {
            const p = passMatch[1].startsWith('//') ? `https:${passMatch[1]}` : passMatch[1];
            await scraperAxios.get(p, { headers: { Referer: hash } }).catch(() => {});
        }

        return {
            success: true,
            provider: 'VidSrc.me 🎯',
            sources: [{ url: hlsUrl, quality: 'auto', isM3U8: true }]
        };
    } catch (e) {}
    return null;
}

// ─── SUBTITLE MERGER ──────────────────────────────────────────────────────────

function mergeSubtitles(...arrays) {
    const seen = new Set();
    const merged = [];
    for (const arr of arrays) {
        if (!arr?.length) continue;
        for (const sub of arr) {
            const key = `${(sub.lang || sub.label || '').toLowerCase()}:${sub.url}`;
            if (!seen.has(key)) { seen.add(key); merged.push(sub); }
        }
    }
    // Sort: English first, then alphabetical
    return merged.sort((a, b) => {
        const aLabel = (a.lang || a.label || '').toLowerCase();
        const bLabel = (b.lang || b.label || '').toLowerCase();
        if (aLabel.includes('english') || aLabel === 'en') return -1;
        if (bLabel.includes('english') || bLabel === 'en') return 1;
        return aLabel.localeCompare(bLabel);
    });
}

// ─── SOURCE SCORER ────────────────────────────────────────────────────────────

function scoreSource(result) {
    if (!result?.success) return -1;
    let score = 0;
    if (result.sources?.some(s => s.isM3U8)) score += 100;
    if (result.subtitles?.length > 0) score += result.subtitles.length;
    if (result.sources?.some(s => s.url?.includes('1080') || s.quality === '1080p')) score += 10;
    return score;
}

// ─── FAST RACE ALGORITHM ──────────────────────────────────────────────────────

/**
 * Races multiple scraping promises. As soon as the FIRST successful stream is found,
 * starts a short grace period (e.g. 800ms) to allow other providers to finish, 
 * so we can merge their subtitles. This avoids waiting 7s for the slowest provider.
 */
function fastRace(promises, gracePeriodMs = 800, absoluteTimeoutMs = 7000) {
    return new Promise((resolve) => {
        let firstWinnerTime = null;
        let resolvedCount = 0;
        let winners = [];
        
        const absoluteTimer = setTimeout(() => finish(), absoluteTimeoutMs);
        let graceTimer = null;

        const finish = () => {
            clearTimeout(absoluteTimer);
            if (graceTimer) clearTimeout(graceTimer);
            resolve(winners);
        };

        promises.forEach(p => {
            Promise.resolve(p).then(result => {
                resolvedCount++;
                if (result && result.success && result.sources?.some(s => s.isM3U8 || (!s.isEmbed && s.url))) {
                    winners.push(result);
                    if (!firstWinnerTime) {
                        firstWinnerTime = Date.now();
                        // First valid stream found! Start the grace timer.
                        graceTimer = setTimeout(() => finish(), gracePeriodMs);
                    }
                }
                if (resolvedCount === promises.length) finish();
            }).catch(() => {
                resolvedCount++;
                if (resolvedCount === promises.length) finish();
            });
        });
    });
}

// ─── MASTER RESOLVER ─────────────────────────────────────────────────────────

export async function resolveStream(tmdbId, type, season, episode, imdbId, title, year) {
    const cacheKey = `v8_stream:${type}:${tmdbId}:${season || 0}:${episode || 0}`;
    const sStr = String(season || 1);
    const eStr = String(episode || 1);

    if (redis) {
        try {
            // REDIS CACHE DISABLED: 
            // We cannot reliably cache stream M3U8 URLs because many top-tier 
            // providers (e.g. VidLink, AutoEmbed) use IP-bound, time-sensitive tokens
            // in their generated M3U8 links. Serving a 30-minute old link to a new user
            // guarantees a 403 Forbidden crash. With `fastRace` responding in <800ms, 
            // real-time resolution is better anyway.
            
            // const cached = await redis.get(cacheKey);
            // if (cached) {
            //     console.log(`[Resolver] ⚡ Cache hit: ${cacheKey}`);
            //     return JSON.parse(cached);
            // }
        } catch (e) {}
    }

    console.log(`[Resolver] 🚀 Racing ${type} ${tmdbId} "${title}" (${year}) S${sStr}E${eStr}`);

    // All engines run concurrently — pure direct M3U8/file sources only
    const enginePromises = [
        // Top tier — no IP-signed tokens, run first
        scrapeVidZee(tmdbId, type, sStr, eStr),
        scrapeVidSrc(tmdbId, type, sStr, eStr),
        // VidLink — fast but uses IP-signed CDN tokens (fetch mitigated server-side)
        scrapeVidLink(tmdbId, type, sStr, eStr),
        scrapeEE3(tmdbId, type),
        scrapeAutoEmbed(tmdbId, type, sStr, eStr),
        scrapeVidSrcTo(tmdbId, type, sStr, eStr),
        scrapeVidSrcMe(tmdbId, type, sStr, eStr),
        scrapeVidNest(tmdbId, type, sStr, eStr),
        scrapeLookMovie(tmdbId, type, sStr, eStr, title, year),
        scrapeHDRezka(tmdbId, type, sStr, eStr, title, year),
        scrapeZoeChip(tmdbId, type, sStr, eStr, title, year),
        scrapeRidoMovies(tmdbId, type, sStr, eStr, title, year),
        scrapeVixSrc(tmdbId, type, sStr, eStr),
        scrapeEmbedSuDirect(tmdbId, type, sStr, eStr),
        scrapeVsEmbed(tmdbId, type, sStr, eStr),
    ];

    // Use fastRace instead of Promise.allSettled so we don't wait for slow engines
    const rawWinners = await fastRace(enginePromises, 800, 7000);

    const winners = rawWinners
        .sort((a, b) => scoreSource(b) - scoreSource(a));

    if (winners.length === 0) {
        console.log(`[Resolver] ❌ All ${enginePromises.length} engines failed for "${title}"`);
        return { success: false, error: 'No direct stream found' };
    }

    const winner = winners[0];

    // Merge ALL subtitles from every successful provider into the winner
    const allSubtitles = winners.flatMap(w => w.subtitles || []);
    winner.subtitles = mergeSubtitles(...winners.map(w => w.subtitles));
    winner.alternativeSources = winners.slice(1).flatMap(w => w.sources || []);

    console.log(
        `[Resolver] 🏆 Winner: ${winner.provider} | ` +
        `${winner.sources.length} source(s) | ` +
        `${winner.subtitles?.length || 0} subtitle(s) | ` +
        `${winner.alternativeSources?.length || 0} alternatives`
    );

    // if (redis) {
    //     try {
    //         await redis.setex(cacheKey, 3600, JSON.stringify(winner));
    //     } catch (e) {}
    // }

    return winner;
}
