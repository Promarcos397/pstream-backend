/**
 * P-Stream Giga Engine Resolver v12.0.0
 * "VaPlayer Integration — Clean API Cluster"
 *
 * Provider Status (2026-04-15):
 * ✅ VixSrc        — /api/movie/{id} JSON (/api/tv/{id}/{s}/{e}) → signed playlist URL (~0.4s)
 * ✅ VidSrc.ru     — vsembed.ru 3-hop scrape → multi-CDN M3U8 (noProxy CDN)
 * ✅ VaPlayer      — streamdata.vaplayer.ru GET API → 3-4 mirrors incl. justhd.tv (~0.5s)
 * ✅ VidSrc.xyz    — cloudnestra RCP iframe → same noProxy CDN cluster
 * ✅ VidSrc.to     — RC4 decrypt via keyService
 * ✅ VidSrc.me     — hash XOR decode → vidsrc.stream
 * ✅ MoviesAPI     — ww2.moviesapi.to API
 * ✅ SuperEmbed    — multiembed.mov public embed
 * ✅ VidZee        — AES-CBC decrypt → multi-CDN M3U8
 * ⚠️ PrimeSrc     — Embed links only (last resort)
 *
 * Architecture notes:
 * - noProxy sources go directly to browser (token/IP-locked CDNs)
 * - Stage 1A races fastest API-first providers (all return within ~1s)
 * - If ONE Stage 1A provider wins, others are cancelled by the race
 * - Stages 1B/1C only engage if ALL Stage 1A providers fail
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

    // ── Stage 1A: Fast API-first providers (clean JSON, sub-second) ─────────
    // All three use documented endpoints and return quickly.
    // VixSrc: /api/movie/{id} — token-signed playlist
    // VidSrcRu: vsembed.ru scrape — cloudnestra multi-CDN (noProxy)
    // VaPlayer: streamdata.vaplayer.ru GET — 3-4 M3U8 mirrors
    console.log('[Resolver] Stage 1A: Racing API-first providers (VixSrc, VidSrc.ru, VaPlayer)...');
    const stage1A = [
        () => scrapeVixSrc(tmdbId, type, season, episode),
        () => scrapeVidSrcRu(tmdbId, type, season, episode),
        () => extractVaPlayer({ tmdbId, type, season, episode }),
    ];
    const winner1A = await raceExtractors(stage1A, 14000);
    if (winner1A) {
        console.log(`[Resolver] ✅ Stage 1A Winner: ${winner1A.provider}`);
        return mergeSubtitles(winner1A);
    }

    // ── Stage 1B: VidSrc cluster (cloudnestra path + RC4 handshakes) ─────────
    console.log('[Resolver] Stage 1B: Racing VidSrc cluster (xyz, to, me)...');
    const stage1B = [
        () => scrapeVidSrcXyz(tmdbId, type, season, episode),
        () => scrapeVidSrcTo(tmdbId, type, season, episode),
        () => scrapeVidSrcMe(tmdbId, type, season, episode),
    ];
    const winner1B = await raceExtractors(stage1B, 25000);
    if (winner1B) {
        console.log(`[Resolver] ✅ Stage 1B Winner: ${winner1B.provider}`);
        return mergeSubtitles(winner1B);
    }

    // ── Stage 1C: Other embed scrapers ───────────────────────────────────────
    console.log('[Resolver] Stage 1C: Racing embed scrapers (MoviesAPI, SuperEmbed, VidZee)...');
    const stage1C = [
        () => scrapeMoviesApi(tmdbId, type, season, episode),
        () => scrapeSuperEmbed(tmdbId, type, season, episode),
        () => scrapeVidZee(tmdbId, type, season, episode),
    ];
    const winner1C = await raceExtractors(stage1C, 20000);
    if (winner1C) {
        console.log(`[Resolver] ✅ Stage 1C Winner: ${winner1C.provider}`);
        return mergeSubtitles(winner1C);
    }

    // ── Stage 2: Last-resort embed-only ──────────────────────────────────────
    console.log('[Resolver] Stage 2: Falling back to embed-only sources (PrimeSrc)...');
    try {
        const stage2Result = await scrapePrimeSrc(tmdbId, type, season, episode);
        if (stage2Result?.success && stage2Result.sources?.length) {
            console.log(`[Resolver] ⚠️ Stage 2 Embed Fallback: ${stage2Result.provider}`);
            stage2Result.isEmbedFallback = true;
            return stage2Result;
        }
    } catch (e) { /* ignore */ }

    console.warn(`[Resolver] ❌ All providers failed for: ${title || tmdbId}`);
    return {
        success: false,
        error: 'No stream found. All providers are currently unavailable. Please try again in a moment.'
    };
}
