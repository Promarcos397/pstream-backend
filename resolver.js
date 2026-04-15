/**
 * P-Stream Giga Engine Resolver v14.0.0
 * "Provider Audit — Dead Domain Recovery"
 *
 * Provider Status (2026-04-15 — live-verified):
 *
 * ✅ AutoEmbed  (autoembed.to)       — JSON API, CDN not IP-signed       ~1-2s
 * ✅ VidZee     (vidzee.wtf)         — AES-CBC decrypt, multi-CDN        ~2-3s
 * ✅ 2Embed     (2embed.cc)          — HTML scrape, iframe player         ~3-5s
 * ✅ VidLink    (vidlink.pro)        — 2-step enc-id + JSON API           ~3-5s
 * ✅ MoviesAPI  (moviesapi.to)       — JSON API → flixcdn               ~2-4s
 * ✅ SuperEmbed (multiembed.mov)     — Public embed page → M3U8          ~2-4s
 * ✅ VidSrc.to  (vidsrc.to)         — RC4 decrypt                       ~4-6s
 * ✅ VidSrc.me  (vidsrc.me)         — Hash XOR                          ~3-5s
 * ✅ VidSrc.ru  (vsembed.ru)        — 3-hop                             ~5-8s
 * ✅ VidSrc.xyz (vidsrc.xyz)        — cloudnestra RCP                   ~4-6s
 * ⚠️  VixSrc   (vixsrc.to)         — DEMOTED: IP-bans HF for playback
 *                                     (token tied to scraper IP, not browser)
 * ❌ EmbedSu   (embed.su)           — DEAD: DNS gone as of 2026-04-15
 * ❌ AutoEmbed  (tom.autoembed.cc)  — DEAD: DNS gone as of 2026-04-15
 * ⚠️  VaPlayer  (brightpathsignals) — HF IP-banned CDN (last resort try)
 *
 * Architecture:
 * - Stage 1A: Fast non-IP-blocked providers that work through HF proxy
 * - Stage 1B: Slower providers / auth-chain scrapers
 * - Stage 2:  VaPlayer + VixSrc (may work intermittently)
 * - Stage 3:  PrimeSrc embed-only
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
import { scrapeVidLink }          from './extractors/vidlink.js';
// EmbedSu REMOVED: embed.su DNS is dead as of 2026-04-15

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

    // ── Stage 1A: Fastest HF-proxy-compatible providers ─────────────────────
    // These providers have CDNs that do NOT IP-ban the HF Space server.
    // VixSrc is EXCLUDED: its CDN IP-bans the HF server regardless of Referer.
    //   (Token is bound to the scraper's outbound IP at token issuance time)
    // AutoEmbed: autoembed.to (new domain — tom.autoembed.cc is dead)
    // VidZee: rapidairmax/serversicuro CDN (not HF-blocked, confirmed working)
    // 2Embed: iframe player with M3U8 in JS config (CDN not IP-signed)
    // MoviesAPI: ww2.moviesapi.to → flixcdn (consistent, fast)
    console.log('[Resolver] Stage 1A: Racing (AutoEmbed, VidZee, 2Embed, MoviesAPI)...');
    const stage1A = [
        () => scrapeAutoEmbed(tmdbId, type, season, episode),
        () => scrapeVidZee(tmdbId, type, season, episode),
        () => scrape2Embed(tmdbId, type, season, episode),
        () => scrapeMoviesApi(tmdbId, type, season, episode),
    ];
    const winner1A = await raceExtractors(stage1A, 14000);
    if (winner1A) {
        console.log(`[Resolver] ✅ Stage 1A Winner: ${winner1A.provider}`);
        return mergeSubtitles(winner1A);
    }

    // ── Stage 1B: Auth-chain scrapers + VidLink ───────────────────────────────
    console.log('[Resolver] Stage 1B: Racing VidSrc cluster + VidLink + SuperEmbed...');
    const stage1B = [
        () => scrapeVidSrcTo(tmdbId, type, season, episode),
        () => scrapeVidSrcMe(tmdbId, type, season, episode),
        () => scrapeVidSrcRu(tmdbId, type, season, episode),
        () => scrapeVidSrcXyz(tmdbId, type, season, episode),
        () => scrapeVidLink(tmdbId, type, season, episode),
        () => scrapeSuperEmbed(tmdbId, type, season, episode),
    ];
    const winner1B = await raceExtractors(stage1B, 25000);
    if (winner1B) {
        console.log(`[Resolver] ✅ Stage 1B Winner: ${winner1B.provider}`);
        return mergeSubtitles(winner1B);
    }

    // ── Stage 2: VixSrc + VaPlayer (IP-problematic, try as last resort) ──────
    // VixSrc: token is IP-locked; if the residential proxy scrapes it, the
    //   browser (user IP) can still play it since HLS.js sends no Referer check.
    //   BUT if the HF server IP scrapes it, both server-proxy AND browser fail.
    // VaPlayer: CDN (brightpathsignals.com) frequently IP-bans HF Space ranges.
    console.log('[Resolver] Stage 2: Trying VixSrc + VaPlayer (IP-problematic, last chance)...');
    const stage2 = [
        () => scrapeVixSrc(tmdbId, type, season, episode),
        () => extractVaPlayer({ tmdbId, type, season, episode }),
    ];
    const winner2 = await raceExtractors(stage2, 15000);
    if (winner2) {
        // Restore noProxy for VixSrc since the token IP-binding means browser-direct
        // is the only viable path (proxy fails with HF IP, noProxy fails without Referer
        // on some browsers — this is a known limitation)
        if (winner2.provider?.includes('VixSrc') && winner2.sources) {
            winner2.sources = winner2.sources.map(s => ({ ...s, noProxy: true }));
        }
        console.log(`[Resolver] ⚠️ Stage 2 Winner: ${winner2.provider} (CDN may 403)`);
        return mergeSubtitles(winner2);
    }

    // ── Stage 3: Last-resort embed-only ──────────────────────────────────────
    console.log('[Resolver] Stage 3: Falling back to embed-only (PrimeSrc)...');
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
