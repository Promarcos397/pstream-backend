/**
 * P-Stream Giga Engine Resolver v14.2.0
 * "Bare-IP Hardening + Bandwidth Optimization"
 *
 * Provider Status (2026-04-17 — live-verified from HF datacenter IP):
 *
 * ✅ VidZee     (player.vidzee.wtf)  — AES-GCM key fetch + AES-CBC decrypt
 *                                      CDN (cdn.1shows.app) NOT IP-signed
 *                                      → segments stream DIRECT to browser  ~1.8s
 * ⚠️  SuperEmbed (multiembed.mov)    — intermittent, worth trying           ~2-4s
 * ✅ VidSrc.to  (vidsrc.to)         — RC4 decrypt (needs proxy)            ~4-6s
 * ✅ VidSrc.me  (vidsrc.me)         — Hash XOR (needs proxy)               ~3-5s
 * ✅ VidSrc.ru  (vsembed.ru)        — 3-hop (needs proxy)                  ~5-8s
 * ✅ VidSrc.xyz (vidsrc.xyz)        — cloudnestra RCP (needs proxy)        ~4-6s
 * ⚠️  VidLink   (vidlink.pro)        — 2-step enc-id, token IP-bound        ~3-5s
 * ⚠️  VixSrc    (vixsrc.to)         — token valid but CDN blocks HF IP range
 * ⚠️  VaPlayer  (brightpathsignals) — CDN IP-bans HF (last resort)
 *
 * REMOVED (permanently dead or unfixable):
 * ❌ AutoEmbed (autoembed.to)     — New Relic JS execution gate (unfixable without headless browser)
 * ❌ MoviesAPI (ww2.moviesapi.to) — Domain timed out, all mirrors dead
 * ❌ 2Embed    (2embed.cc)        — Hard 403 from all datacenter IPs, all mirrors dead
 * ❌ EmbedSu   (embed.su)         — DNS dead
 *
 * Bandwidth note:
 * VidZee sources are marked noProxy=true — .ts segments go CDN→browser directly.
 * Only use /proxy/stream for IP-locked providers (VixSrc, VidLink) where
 * the token must match the fetching IP.
 *
 * Architecture:
 * - Stage 1A: Direct gigaAxios providers (bare HF IP ok, CDN not IP-locked)
 * - Stage 1B: VidSrc cluster (needs proxy — uses 3-tier proxyAxios fallback)
 * - Stage 2:  VixSrc + VaPlayer (IP-problematic, last resort)
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
import { scrapeSuperEmbed }       from './extractors/superembed.js';
import { scrapeVidSrcXyz }        from './extractors/vidsrcxyz.js';
import { scrapeVidLink }          from './extractors/vidlink.js';
// Removed: AutoEmbed (New Relic JS gate), MoviesAPI (domain dead), 2Embed (all mirrors 403), EmbedSu (DNS dead)

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

    // ═══ Stage 1A: Direct providers (bare HF datacenter IP, CDN not IP-locked) ══════════════
    // All providers here must satisfy:
    //   1. API accessible from AWS/GCP/HF datacenter IPs (no Cloudflare IUAM, no New Relic)
    //   2. CDN tokens NOT IP-bound (backend proxy can fetch without getting 403)
    //
    // VidZee: ✅ Confirmed working — 6 sources, CDN is NOT IP-locked (no token in URL)
    //   ⚠️ CDN has NO CORS headers (zebi.xalaflix.design, i-arch-400.kessy412lad.com)
    //   MUST go through /proxy/stream — backend adds Access-Control-Allow-Origin:*
    //   noProxy:true was tried and reverted — browser CORS policy blocks direct fetch
    // SuperEmbed: ⚠️ intermittent — worth trying as fast parallel bet
    console.log('[Resolver] Stage 1A: Racing (VidZee, SuperEmbed)...');
    const stage1A = [
        () => scrapeVidZee(tmdbId, type, season, episode),
        () => scrapeSuperEmbed(tmdbId, type, season, episode),
    ];
    const winner1A = await raceExtractors(stage1A, 12000);
    if (winner1A) {
        console.log(`[Resolver] ✅ Stage 1A Winner: ${winner1A.provider}`);
        return mergeSubtitles(winner1A);
    }


    // ── Stage 1B: Auth-chain scrapers (need proxy — may 407 if proxy expired) ─────────────
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
