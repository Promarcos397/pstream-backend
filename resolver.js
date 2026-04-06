/**
 * P-Stream Giga Engine Resolver v8.1.0
 * "Direct Only — No Embeds"
 */
import { proxyAxios, stringAtob } from './utils/http.js';
import { getRandomUA } from './utils/constants.js';

// --- Extractors ---
import { scrapeVidLink } from './extractors/vidlink.js';
import { scrapeAutoEmbed } from './extractors/autoembed.js';
import { scrapeVidSrcTo } from './extractors/vidsrcto.js';
import { scrapeVidSrcMe } from './extractors/vidsrcme.js';
import { scrapeVidSrc } from './extractors/vidsrcru.js';
import { scrapeVidNest } from './extractors/vidnest.js';
import { scrapeLookMovie } from './extractors/lookmovie.js';
import { scrapeVidZee } from './extractors/vidzee.js';
import { scrapeVixSrc } from './extractors/vixsrc.js';

async function scrapeEmbedSuDirect(tmdbId, type, season, episode) {
    try {
        const url = `https://embed.su/embed/${type}/${tmdbId}${type === 'tv' ? `/${season}/${episode}` : ''}`;
        const { data: page } = await proxyAxios.get(url, {
            headers: { 'User-Agent': getRandomUA(), Referer: 'https://embed.su' }
        });
        const vConfigMatch = page.match(/window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+)/i);
        if (!vConfigMatch) return null;

        const config = JSON.parse(stringAtob(vConfigMatch[1]));
        const first = stringAtob(config.hash).split('.').map(i => i.split('').reverse().join(''));
        const second = JSON.parse(stringAtob(first.join('').split('').reverse().join('')));
        if (!second?.length) return null;

        let subtitles = (config.subtitles || []).map(s => ({ url: s.file, lang: s.label, label: s.label }));

        const resolved = [];
        for (const s of second.slice(0, 3)) {
            try {
                const { data: streamData } = await proxyAxios.get(`https://embed.su/api/e/${s.hash}`, {
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
        return { success: true, provider: 'Embed.su ✨', sources: resolved, subtitles };
    } catch (e) {}
    return null;
}

export async function resolveStreaming(tmdbId, type, season, episode, title, year) {
    console.log(`[Resolver] Racing sources for: ${title || tmdbId} (${type})`);

    const providers = [
        () => scrapeVidLink(tmdbId, type, season, episode),
        () => scrapeVidSrcTo(tmdbId, type, season, episode),
        () => scrapeVidSrcMe(tmdbId, type, season, episode),
        () => scrapeVixSrc(tmdbId, type, season, episode),
        () => scrapeVidNest(tmdbId, type, season, episode),
        () => scrapeVidSrc(tmdbId, type, season, episode),
        () => (title && year) ? scrapeVidZee(title, year, type, season, episode) : null,
        () => scrapeEmbedSuDirect(tmdbId, type, season, episode),
        () => scrapeAutoEmbed(tmdbId, type, season, episode),
        () => (title && year) ? scrapeLookMovie(title, year, type, season, episode) : null
    ];

    const stages = [
        providers.slice(0, 7), // Re-ranked top tier (VidLink, VidSrc, etc.)
        providers.slice(7)
    ];

    for (const stage of stages) {
        const results = await Promise.all(stage.map(p => {
            const res = p();
            return res ? res.catch(() => null) : null;
        }));

        const bestResult = results.filter(r => {
            if (!r || !r.success || !r.sources?.length) return false;
            // STRICT POLICY: No embeds, no iframes, no "bs"
            if (r.sources.some(s => s.isEmbed)) return false; 
            return true;
        })
        .sort((a, b) => {
            const aM3U8 = a.sources[0]?.isM3U8;
            const bM3U8 = b.sources[0]?.isM3U8;
            if (aM3U8 && !bM3U8) return -1;
            if (!aM3U8 && bM3U8) return 1;
            return 0;
        })[0];

        if (bestResult) {
            console.log(`[Resolver] winner: ${bestResult.provider}`);
            return bestResult;
        }
    }

    console.warn(`[Resolver] All providers failed for ${title || tmdbId}`);
    return { success: false, error: 'No direct stream found' };
}
