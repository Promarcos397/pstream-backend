/**
 * P-Stream Giga Engine Resolver v10.0.0
 * "The Resurrection — Live Providers Only"
 *
 * Provider Status (2026-04-12):
 * ✅ VixSrc       — vixsrc.to, has window.masterPlaylist token in HTML
 * ✅ VidSrc.ru    — vsembed.ru 3-hop scrape → cloudnestra.com HLS
 * ✅ VidSrc.to    — RC4 decrypt via keyService → VidPlay/Vidstream M3U8
 * ✅ VidSrc.me    — hash XOR decode → vidsrc.stream handshake
 * ⚠️ PrimeSrc    — Embed links only (Streamtape/Voe/Dood) — last resort
 *
 * Dead providers removed:
 * ❌ StreamBox    — vidjoy.pro stuck behind CF bot challenge
 * ❌ VidLink      — enc-dec.app returns 400 for plain TMDB id
 * ❌ Embed.su     — domain dead (DNS NXDOMAIN)
 * ❌ VidZee       — /api/server returns 404
 * ❌ AutoEmbed    — tom.autoembed.cc dead (DNS NXDOMAIN)
 */

import { scrapeVixSrc } from './extractors/vixsrc.js';
import { scrapeVidSrc as scrapeVidSrcRu } from './extractors/vidsrcru.js';
import { scrapeVidSrcTo } from './extractors/vidsrcto.js';
import { scrapeVidSrcMe } from './extractors/vidsrcme.js';
import { scrapePrimeSrc } from './extractors/primesrc.js';
import { scrapeVdrkCaptions } from './subs_vdrk.js';

export async function resolveStreaming(tmdbId, type, season, episode, title, year) {
    console.log(`[Resolver] Racing live cluster for: ${title || tmdbId} (${type})`);

    // Stage 1 — Direct M3U8 scrapers (fast, all confirmed live)
    const stage1 = [
        () => scrapeVixSrc(tmdbId, type, season, episode),         // #1: vixsrc.to token-signed HLS
        () => scrapeVidSrcRu(tmdbId, type, season, episode),       // #2: vsembed.ru → cloudnestra HLS
        () => scrapeVidSrcTo(tmdbId, type, season, episode),       // #3: vidsrc.to RC4 → VidPlay M3U8
        () => scrapeVidSrcMe(tmdbId, type, season, episode),       // #4: vidsrc.me XOR handshake M3U8
    ];

    // Stage 2 — Last resort: embed links only (PrimeSrc: Streamtape/Voe/Dood/Filelions)
    const stage2 = [
        () => scrapePrimeSrc(tmdbId, type, season, episode),
    ];

    // Stage 1: race all 4 parallel stream extractors + 1 external subtitle extractor
    console.log('[Resolver] Stage 1: Racing VixSrc + VidSrcRU + VidSrcTo + VidSrcMe...');
    
    // Concurrently fetch streams and external subtitles (like VDRK)
    const [stage1Results, externalSubtitles] = await Promise.all([
        Promise.all(stage1.map(p => p().catch(() => null))),
        scrapeVdrkCaptions(tmdbId, type, season, episode).catch(() => [])
    ]);

    const stage1Winner = stage1Results.find(r =>
        r?.success && r.sources?.length && !r.sources.some(s => s.isEmbed)
    );

    if (stage1Winner) {
        // Merge the external subtitles flawlessly with any returned by the provider
        if (externalSubtitles && externalSubtitles.length > 0) {
            stage1Winner.subtitles = [...(stage1Winner.subtitles || []), ...externalSubtitles];
        }
        
        console.log(`[Resolver] ✅ Stage 1 Winner: ${stage1Winner.provider} (External Subs: ${externalSubtitles.length})`);
        return stage1Winner;
    }

    console.warn('[Resolver] Stage 1 all failed — falling back to Stage 2 (embed links)');

    // Stage 2: PrimeSrc embed fallback — allow embed sources as last resort
    const stage2Results = await Promise.all(
        stage2.map(p => p().catch(() => null))
    );

    const stage2Winner = stage2Results.find(r => r?.success && r.sources?.length);

    if (stage2Winner) {
        // Strip the isEmbed flag so the resolver passes it through,
        // but mark it clearly so the frontend can show an iframe player
        console.log(`[Resolver] ⚠️ Stage 2 Embed Fallback: ${stage2Winner.provider}`);
        stage2Winner.isEmbedFallback = true;
        return stage2Winner;
    }

    console.warn(`[Resolver] ❌ All providers failed for: ${title || tmdbId}`);
    return { success: false, error: 'No stream found. All providers currently unavailable.' };
}
