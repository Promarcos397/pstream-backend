/**
 * P-Stream Giga Engine Resolver v13.0.0
 * "IP-Block Recovery — CDN Diversification"
 *
 * Provider Status (2026-04-15):
 * ✅ VixSrc        — /api/movie/{id} JSON → signed playlist (noProxy, browser-direct)
 * ✅ AutoEmbed     — tom.autoembed.cc clean JSON API → direct HLS (~0.5s)
 * ✅ VidZee        — AES-CBC decrypt → multi-CDN (rapidairmax, serversicuro — not IP-signed)
 * ✅ VidSrc.to     — RC4 decrypt via keyService → VidPlay M3U8
 * ✅ VidSrc.me     — hash XOR decode → vidsrc.stream
 * ✅ MoviesAPI     — ww2.moviesapi.to API → flixcdn M3U8
 * ✅ SuperEmbed    — multiembed.mov public embed → direct M3U8
 * ✅ VidSrc.ru     — vsembed.ru 3-hop → cloudnestra (noProxy)
 * ✅ VidSrc.xyz    — cloudnestra RCP iframe (noProxy)
 * ⚠️ VaPlayer      — DEMOTED: brightpathsignals/nextgenmarketinghub CDN IP-blocks HF Space
 * ⚠️ PrimeSrc     — Embed links only (last resort)
 *
 * Architecture:
 * - Stage 1A: Fastest non-IP-blocked providers (VixSrc noProxy, AutoEmbed, VidZee)
 * - Stage 1B: Auth-based scrapers (VidSrc.to RC4, VidSrc.me, VidSrc.ru, VidSrc.xyz)
 * - Stage 1C: Embed scrapers (MoviesAPI, SuperEmbed)
 * - Stage 2: VaPlayer (HF IP may be blocked on its CDN, try anyway as fallback)
 * - Stage 3: PrimeSrc embed-only last resort
 */

import { scrapeVixSrc }          from './extractors/vixsrc.js';
import { scrapeVidSrc as scrapeVidSrcRu } from './extractors/vidsrcru.js';
import { extractVaPlayer }        from './extractors/vaplayer.js';
import { scrapeVidSrcTo }         from './extractors/vidsrcto.js';
import { scrapeVidSrcMe }         from './extractors/vidsrcme.js';
import { scrapeVidZee }           from './extractors/vidzee.js';
import { scrapePrimeSrc }         from './extractors/primesrc.js';
import { scrapeVdrkCaptions }     from './extractors/subs_vdrk.js';
import { scrapeMoviesApi }        from './extractors/moviesapi.js';
import { scrapeSuperEmbed }       from './extractors/superembed.js';
import { scrapeVidSrcXyz }        from './extractors/vidsrcxyz.js';
import { scrapeAutoEmbed }        from './extractors/autoembed.js';
import { scrape2Embed }           from './extractors/twoembed.js';
import { scrapeEmbedSu }          from './extractors/embedsu.js';
import { scrapeVidLink }          from './extractors/vidlink.js';

/**
 * Race multiple extractors concurrently.
 * Returns the first successful result (non-null, has real M3U8 sources).
 * Losers are abandoned but NOT cancelled (JS Promises can't be cancelled).
 */
function raceExtractors(extractors, timeoutMs = 20000) {
    return new Promise(resolve => {
        let settled = 0;
        const total = extractors.length;
        let resolved = false;

        if (total === 0) { resolve(null); return; }

        const done = (result) => {
            if (!resolved && result?.success && result.sources?.length && !result.sources.every(s => s.isEmbed)) {
                resolved = true;
                resolve(result);
            } else {
                settled++;
                if (!resolved && settled === total) resolve(null);
            }
        };

        const timer = setTimeout(() => { if (!resolved) resolve(null); }, timeoutMs);

        extractors.forEach(fn => {
            fn().then(done).catch(() => done(null));
        });
    });
}

export async function resolveStreaming(tmdbId, type, season, episode, title, year) {
    console.log(`[Resolver] Racing live cluster for: ${title || tmdbId} (${type})`);

    // Always fetch external subtitles in parallel — never blocks stream resolution
    const externalSubsPromise = scrapeVdrkCaptions(tmdbId, type, season, episode).catch(() => []);

    const mergeSubtitles = async (result) => {
        if (result) {
            const externalSubtitles = await externalSubsPromise;
            if (externalSubtitles?.length > 0) {
                result.subtitles = [...(result.subtitles || []), ...externalSubtitles];
            }
        }
        return result;
    };

    // ── Stage 1A: Fast, non-IP-blocked providers ────────────────────────────────
    // VixSrc:    noProxy (browser-direct) — HF IP irrelevant for playback
    // AutoEmbed: clean JSON API, no CDN IP-signing
    // VidZee:    AES-CBC decrypt, rapidairmax/serversicuro CDN (not HF-blocked)
    // 2Embed:    public embed, non-IP-signed CDN
    // EmbedSu:   base64 JW Player config, non-IP-signed CDN
    // NOTE: VaPlayer EXCLUDED — its CDN (nextgenmarketinghub.site /
    //       brightpathsignals.com) routinely IP-blocks Hugging Face Space IPs.
    console.log('[Resolver] Stage 1A: Racing (VixSrc, AutoEmbed, VidZee, 2Embed, EmbedSu)...');
    const stage1A = [
        () => scrapeVixSrc(tmdbId, type, season, episode),
        () => scrapeAutoEmbed(tmdbId, type, season, episode),
        () => scrapeVidZee(tmdbId, type, season, episode),
        () => scrape2Embed(tmdbId, type, season, episode),
        () => scrapeEmbedSu(tmdbId, type, season, episode),
    ];
    const winner1A = await raceExtractors(stage1A, 14000);
    if (winner1A) {
        console.log(`[Resolver] ✅ Stage 1A Winner: ${winner1A.provider}`);
        return mergeSubtitles(winner1A);
    }

    // ── Stage 1B: Auth-based scrapers (different CDN paths) ─────────────────
    console.log('[Resolver] Stage 1B: Racing VidSrc cluster + VidLink...');
    const stage1B = [
        () => scrapeVidSrcTo(tmdbId, type, season, episode),
        () => scrapeVidSrcMe(tmdbId, type, season, episode),
        () => scrapeVidSrcRu(tmdbId, type, season, episode),
        () => scrapeVidSrcXyz(tmdbId, type, season, episode),
        () => scrapeVidLink(tmdbId, type, season, episode),
    ];
    const winner1B = await raceExtractors(stage1B, 25000);
    if (winner1B) {
        console.log(`[Resolver] ✅ Stage 1B Winner: ${winner1B.provider}`);
        return mergeSubtitles(winner1B);
    }

    // ── Stage 1C: Embed scrapers ──────────────────────────────────────────────
    console.log('[Resolver] Stage 1C: Racing embed scrapers (MoviesAPI, SuperEmbed)...');
    const stage1C = [
        () => scrapeMoviesApi(tmdbId, type, season, episode),
        () => scrapeSuperEmbed(tmdbId, type, season, episode),
    ];
    const winner1C = await raceExtractors(stage1C, 20000);
    if (winner1C) {
        console.log(`[Resolver] ✅ Stage 1C Winner: ${winner1C.provider}`);
        return mergeSubtitles(winner1C);
    }

    // ── Stage 2: VaPlayer (HF IP may be blocked on CDN, try anyway) ──────────
    // Its brightpathsignals.com CDN frequently bans HF Space IPs, but
    // occasionally rotates and unblocks. Worth trying as a last real source.
    console.log('[Resolver] Stage 2: Trying VaPlayer (CDN may be HF-blocked)...');
    try {
        const vaResult = await extractVaPlayer({ tmdbId, type, season, episode });
        if (vaResult?.success && vaResult.sources?.length) {
            console.log(`[Resolver] ⚠️ Stage 2 VaPlayer (CDN may fail in browser): ${vaResult.provider}`);
            return mergeSubtitles(vaResult);
        }
    } catch (e) { /* ignore */ }

    // ── Stage 3: Last-resort embed-only ──────────────────────────────────────
    console.log('[Resolver] Stage 3: Falling back to embed-only sources (PrimeSrc)...');
    try {
        const stage3Result = await scrapePrimeSrc(tmdbId, type, season, episode);
        if (stage3Result?.success && stage3Result.sources?.length) {
            console.log(`[Resolver] ⚠️ Stage 3 Embed Fallback: ${stage3Result.provider}`);
            stage3Result.isEmbedFallback = true;
            return stage3Result;
        }
    } catch (e) { /* ignore */ }

    console.warn(`[Resolver] ❌ All providers failed for: ${title || tmdbId}`);
    return {
        success: false,
        error: 'No stream found. All providers are currently unavailable. Please try again in a moment.'
    };
}
