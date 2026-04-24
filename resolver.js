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
 * Returns the first that resolves with real (non-embed) M3U8 sources.
 *
 * NOTE: We intentionally do NOT probe the URL server-side — adding a HEAD
 * request per provider would consume the race timeout budget (VidZee already
 * takes 8-12s, Stage 1 timeout is 8s). Dead-URL detection is handled client-side:
 * useHls.ts treats 404/403 as cache-bust + full backend refetch.
 */
function raceExtractors(extractors, timeoutMs) {
    return new Promise(resolve => {
        let settled = 0;
        const total = extractors.length;
        let resolved = false;

        if (total === 0) { resolve(null); return; }

        const timer = setTimeout(() => {
            if (!resolved) {
                console.warn(`[Race] ⏱ Timeout after ${timeoutMs}ms — all ${total} extractors slow/failed`);
                resolve(null);
            }
        }, timeoutMs);

        const done = (result, providerName) => {
            if (resolved) return;

            if (result?.success && result.sources?.length && !result.sources.every(s => s.isEmbed)) {
                resolved = true;
                clearTimeout(timer);
                console.log(`[Race] 🏆 Winner: ${result.provider || providerName}`);
                resolve(result);
            } else {
                console.log(`[Race] ✗ ${result?.provider || providerName || 'Unknown'} — no valid sources`);
                settled++;
                if (!resolved && settled === total) {
                    clearTimeout(timer);
                    resolve(null);
                }
            }
        };

        extractors.forEach((fn, i) => fn().then(
            result => done(result, `extractor[${i}]`),
            err => {
                console.warn(`[Race] ✗ extractor[${i}] threw: ${err?.message || err}`);
                done(null, `extractor[${i}]`);
            }
        ));
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

    // ══ Stage 1+2: Parallel race — all providers at once ═══════════════════
    // ALL providers race simultaneously. VixSrc (2-3s) and VaPlayer (2-3s)
    // typically win. VidZee (8-12s), VidSrc.ru (7-8s), LookMovie (7-8s) serve
    // as fallbacks if the fast providers fail.
    //
    // Previously staged (VidZee first, then others) — this wasted 8s waiting
    // for VidZee when VixSrc/VaPlayer could win in 2-3s.
    //
    // noProxy sources: VidSrc.ru (noProxy already in extractor), VixSrc (set below).
    // VidZee CDN (neonhorizonworkshops etc) blocks HF IPs → noProxy=true in vidzee.js.
    console.log('[Resolver] Racing all providers: VixSrc, VaPlayer, VidZee, VidSrc.ru, LookMovie...');
    const stage1Result = await raceExtractors([
        () => scrapeVixSrc(tmdbId, type, season, episode),
        () => extractVaPlayer({ tmdbId, type, season, episode }),
        () => scrapeVidZee(tmdbId, type, season, episode),
        () => scrapeVidSrcRu(tmdbId, type, season, episode),
        () => scrapeLookMovie(tmdbId, type === 'movie' ? 'movie' : 'show', season, episode, title, year),
    ], 20000);

    if (stage1Result) {
        // VixSrc token is IP-bound → mark for browser-direct fetch
        if (stage1Result.provider?.includes('VixSrc') && stage1Result.sources) {
            stage1Result.sources = stage1Result.sources.map(s => ({ ...s, noProxy: true }));
        }
        console.log(`[Resolver] ✅ Winner: ${stage1Result.provider}`);
        return mergeSubtitles(stage1Result);
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
