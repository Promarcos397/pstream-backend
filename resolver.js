/**
 * P-Stream Giga Engine Resolver v16.0.0
 * "Dead Provider Purge + Lean Architecture"
 *
 * ══ LIVE-VERIFIED STATUS (2026-04-24, HF datacenter IP) ══════════════════════
 *
 * ✅ VidZee    (player.vidzee.wtf)  — 3-5 sources, AES-GCM/CBC decrypt
 *                                     noProxy=true — CDN (neonhorizonworkshops,
 *                                     wanderlynest, orchidpixelgardens) blocks
 *                                     datacenter IPs. Browser fetches directly. ~1.8s
 *
 * ✅ VidSrc.ru (vsembed.ru)        — 8 sources, cloudnestra CDN
 *                                     noProxy=true already set.               ~7.7s
 *
 * ✅ VixSrc   (vixsrc.to)          — 1 source, token-based, very fast.
 *                                     noProxy=true set in Stage 2.            ~1.2-2.6s
 *
 * ✅ VaPlayer (vaplayer.ru)        — 4 sources, multiple mirrors.             ~2.4s
 *
 * ✅ LookMovie (lookmovie2.to)     — 1 source, compressed HLS.                ~7.4s
 *
 * ══ DEAD / REMOVED (2026-04-24 confirmed) ════════════════════════════════════
 *
 * ❌ VidSrc.to  — Now just wraps vsembed.ru (= VidSrc.ru). 100% redundant.
 * ❌ VidSrc.me  — Full SPA (JS-only render), zero scrape-able data.
 * ❌ VidSrc.xyz — Consistent timeout (12-13s), never resolves.
 * ❌ VidLink    — HTTP 400 on all requests.
 * ❌ FlixHQ     — HTTP 404 on TMDB API path.
 * ❌ 2EmbedSkin — Wraps dead 2embed.cc. No stream.
 * ❌ VidBinge   — SPA (JS-only). No scrape-able API.
 * ❌ VidNest    — HTTP 403 blocking HF datacenter IPs.
 * ❌ NontonGo   — Consistent timeout / connection refused.
 * ❌ RidoMovies — Cloudflare JS challenge blocks server-side requests.
 * ❌ SuperEmbed — multiembed.mov returns 678KB SPA, no extractable stream.
 * ❌ AutoEmbed  — New Relic JS gate (requires real browser).
 * ❌ MoviesAPI  — SPA (JS-only render).
 * ❌ HollyMovieHD — HTTP 404.
 *
 * ══ ARCHITECTURE ══════════════════════════════════════════════════════════════
 *
 * Stage 1 (8s):  VidZee — fastest, most sources. Almost always wins.
 * Stage 2 (18s): VidSrc.ru + VixSrc + VaPlayer + LookMovie — parallel race.
 *                VixSrc/VaPlayer usually win in 1-2.4s.
 * Stage 3:       PrimeSrc — embed-only last resort.
 *
 * External subs: vdrk fetched in parallel, merged into winner.
 */

import { scrapeVidZee }       from './extractors/vidzee.js';
import { scrapeVidSrc as scrapeVidSrcRu } from './extractors/vidsrcru.js';
import { scrapeVixSrc }       from './extractors/vixsrc.js';
import { extractVaPlayer }    from './extractors/vaplayer.js';
import { scrapeLookMovie }    from './extractors/lookmovie.js';
import { scrapePrimeSrc }     from './extractors/primesrc.js';
import { scrapeVdrkCaptions } from './extractors/subs_vdrk.js';

/**
 * Race multiple extractor functions.
 * Returns the first that succeeds with real (non-embed) M3U8 sources.
 * All others are abandoned (not cancellable in JS).
 */
function raceExtractors(extractors, timeoutMs) {
    return new Promise(resolve => {
        let settled = 0;
        const total = extractors.length;
        let resolved = false;

        if (total === 0) { resolve(null); return; }

        const timer = setTimeout(() => { if (!resolved) resolve(null); }, timeoutMs);

        const done = (result) => {
            if (!resolved && result?.success && result.sources?.length && !result.sources.every(s => s.isEmbed)) {
                resolved = true;
                clearTimeout(timer);
                resolve(result);
            } else {
                settled++;
                if (!resolved && settled === total) {
                    clearTimeout(timer);
                    resolve(null);
                }
            }
        };

        extractors.forEach(fn => fn().then(done).catch(() => done(null)));
    });
}

export async function resolveStreaming(tmdbId, type, season, episode, title, year) {
    console.log(`[Resolver v16] Resolving: ${title || tmdbId} (${type}${type === 'tv' ? ` S${season}E${episode}` : ''})`);

    // External subtitles fetched in parallel throughout — never blocks stream
    const externalSubsPromise = scrapeVdrkCaptions(tmdbId, type, season, episode).catch(() => []);

    const mergeSubtitles = async (result) => {
        if (!result) return result;
        const externalSubs = await externalSubsPromise;
        if (externalSubs?.length) {
            result.subtitles = [...(result.subtitles || []), ...externalSubs];
        }
        return result;
    };

    // ══ Stage 1: VidZee (fastest, most sources) ════════════════════════════
    // VidZee: AES-GCM key API + AES-CBC URL decryption.
    // CDN domains block HF IPs → noProxy=true (browser fetches directly).
    // 3 movie sources / 5 TV sources typical. ~1.8s resolution time.
    console.log('[Resolver] Stage 1: VidZee...');
    const stage1Result = await raceExtractors([
        () => scrapeVidZee(tmdbId, type, season, episode),
    ], 8000);

    if (stage1Result) {
        console.log(`[Resolver] ✅ Stage 1 Winner: ${stage1Result.provider}`);
        return mergeSubtitles(stage1Result);
    }

    // ══ Stage 2: Parallel race — VidSrc.ru + VixSrc + VaPlayer + LookMovie ═
    // All confirmed working from HF datacenter IPs.
    // VixSrc (1-2.6s) and VaPlayer (2.4s) are fastest so usually win.
    // VidSrc.ru (7.7s) and LookMovie (7.4s) are fallbacks.
    // noProxy already set on VidSrc.ru sources.
    // VixSrc gets noProxy=true below (token IP-bound — browser plays directly).
    // VaPlayer CDN is not IP-locked, proxy works fine.
    console.log('[Resolver] Stage 2: Racing VidSrc.ru, VixSrc, VaPlayer, LookMovie...');
    const stage2Result = await raceExtractors([
        () => scrapeVidSrcRu(tmdbId, type, season, episode),
        () => scrapeVixSrc(tmdbId, type, season, episode),
        () => extractVaPlayer({ tmdbId, type, season, episode }),
        () => scrapeLookMovie(tmdbId, type === 'movie' ? 'movie' : 'show', season, episode, title, year),
    ], 18000);

    if (stage2Result) {
        // VixSrc token is IP-bound → mark for browser-direct fetch
        if (stage2Result.provider?.includes('VixSrc') && stage2Result.sources) {
            stage2Result.sources = stage2Result.sources.map(s => ({ ...s, noProxy: true }));
        }
        console.log(`[Resolver] ✅ Stage 2 Winner: ${stage2Result.provider}`);
        return mergeSubtitles(stage2Result);
    }

    // ══ Stage 3: Embed-only fallback ═══════════════════════════════════════
    console.log('[Resolver] Stage 3: PrimeSrc embed fallback...');
    try {
        const stage3Result = await scrapePrimeSrc(tmdbId, type, season, episode);
        if (stage3Result?.success && stage3Result.sources?.length) {
            stage3Result.isEmbedFallback = true;
            console.log(`[Resolver] ⚠️ Stage 3 Embed Fallback: ${stage3Result.provider}`);
            return stage3Result;
        }
    } catch (_) {}

    console.warn(`[Resolver] ❌ All stages failed for: ${title || tmdbId}`);
    return {
        success: false,
        error: 'No stream found. All providers are currently unavailable. Please try again in a moment.',
    };
}
