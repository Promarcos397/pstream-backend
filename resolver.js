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
 * Probe a source URL to verify it's actually live before declaring it a winner.
 * Providers often return success=true with an M3U8 URL that 403s or 404s on the CDN.
 * A HEAD request (or GET with tiny range) quickly catches this.
 *
 * noProxy=true sources are served directly to the browser, so we can't probe them from
 * the server without hitting the same IP-lock. Skip those — the browser will discover
 * failure via HLS.js and trigger the retry path.
 *
 * Returns true if the URL looks live, false if definitively dead.
 */
async function probeSource(result) {
    // Skip probe for noProxy sources (browser plays them directly — server can't reach CDN)
    const firstSource = result.sources?.[0];
    if (!firstSource || firstSource.noProxy) return true;

    const url = firstSource.url;
    if (!url || !url.startsWith('http')) return true;

    try {
        const { gigaAxios } = await import('./utils/http.js');
        const referer = firstSource.referer || new URL(url).origin + '/';

        const probeRes = await gigaAxios.head(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Referer: referer,
                Origin: new URL(url).origin,
            },
            timeout: 5000,
            validateStatus: () => true,   // don't throw on 4xx — just read status
        });

        const status = probeRes.status;
        if (status === 403 || status === 404 || status === 410) {
            console.warn(`[Probe] ❌ Dead URL (${status}): ${url.substring(0, 80)}`);
            return false;
        }
        console.log(`[Probe] ✅ Live (${status}): ${url.substring(0, 80)}`);
        return true;
    } catch (e) {
        // Network errors from probe are non-fatal — assume live (browser will discover otherwise)
        console.warn(`[Probe] ⚠️ Probe failed (${e.message}) — assuming live`);
        return true;
    }
}

/**
 * Race multiple extractor functions.
 * Returns the first that resolves with real (non-embed) M3U8 sources
 * AND passes a lightweight CDN probe test.
 */
function raceExtractors(extractors, timeoutMs) {
    return new Promise(resolve => {
        let settled = 0;
        const total = extractors.length;
        let resolved = false;

        if (total === 0) { resolve(null); return; }

        const timer = setTimeout(() => {
            if (!resolved) {
                console.warn(`[Race] ⏱ Timeout after ${timeoutMs}ms — all ${total} extractors exhausted or slow`);
                resolve(null);
            }
        }, timeoutMs);

        const done = async (result, providerName) => {
            if (resolved) return; // already won — don't race further

            if (result?.success && result.sources?.length && !result.sources.every(s => s.isEmbed)) {
                // Probe the URL before declaring winner
                const live = await probeSource(result);
                if (live && !resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    console.log(`[Race] 🏆 Winner: ${result.provider || providerName}`);
                    resolve(result);
                    return;
                }
                if (!live) {
                    console.warn(`[Race] 💀 ${result.provider || providerName} — URL dead, continuing...`);
                }
            } else {
                console.log(`[Race] ✗ ${providerName || 'Unknown'} — no valid sources`);
            }

            settled++;
            if (!resolved && settled === total) {
                clearTimeout(timer);
                resolve(null);
            }
        };

        extractors.forEach((fn, i) => fn().then(
            result => done(result, `extractor[${i}]`),
            err => {
                console.warn(`[Race] ✗ extractor[${i}] threw: ${err.message}`);
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
