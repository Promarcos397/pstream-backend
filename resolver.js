/**
 * P-Stream Giga Engine Resolver v9.0.0
 * "The Aether Overhaul — Peak Performance"
 */
import { proxyAxios, stringAtob } from './utils/http.js';
import { getRandomUA } from './utils/constants.js';

// --- Extractors (Aether/P-Stream Family) ---
import { scrapeStreamBox } from './extractors/streambox.js';
import { scrapeVidLink } from './extractors/vidlink.js';
import { scrapeVidSrc } from './extractors/vidsrc.js';
import { scrapePrimeSrc } from './extractors/primesrc.js';
import { scrapeVidZee } from './extractors/vidzee.js';

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
        return { success: true, provider: 'Embed.su (Refined)', sources: resolved, subtitles };
    } catch (e) {}
    return null;
}

export async function resolveStreaming(tmdbId, type, season, episode, title, year) {
    console.log(`[Resolver] Racing Aether-Cluster sources for: ${title || tmdbId} (${type})`);

    // Priority Order mirroring Aether.mom and P-Stream resurrection
    const providers = [
        () => scrapeStreamBox(tmdbId, type, season, episode), // Priority #1: VidJoy fast-fetch
        () => scrapeVidLink(tmdbId, type, season, episode),   // Priority #2: VidLink Encrypted API
        () => scrapeVidSrc(tmdbId, type, season, episode),    // Priority #3: VidSrc.to/me/ru Cluster
        () => scrapePrimeSrc(tmdbId, type, season, episode),  // Priority #4: Aggregator Fallback
        () => scrapeEmbedSuDirect(tmdbId, type, season, episode),
        () => (title && year) ? scrapeVidZee(title, year, type, season, episode) : null
    ];

    // Racing strategy (2 concurrent batches)
    const stages = [
        providers.slice(0, 4), // High priority fast sources
        providers.slice(4)     // Slower fallbacks
    ];

    for (const stage of stages) {
        const results = await Promise.all(stage.map(p => {
            const res = p();
            return res ? res.catch(() => null) : null;
        }));

        const bestResult = results.filter(r => {
            if (!r || !r.success || !r.sources?.length) return false;
            // No junk embeds
            if (r.sources.some(s => s.isEmbed)) return false; 
            return true;
        })
        .sort((a, b) => {
            // M3U8 (Adaptive) is better than direct MP4 for our rewriter
            const aM3U8 = a.sources[0]?.isM3U8;
            const bM3U8 = b.sources[0]?.isM3U8;
            if (aM3U8 && !bM3U8) return -1;
            if (!aM3U8 && bM3U8) return 1;
            return 0;
        })[0];

        if (bestResult) {
            console.log(`[Resolver] Aether-Cluster Winner: ${bestResult.provider}`);
            return bestResult;
        }
    }

    console.warn(`[Resolver] All cluster providers failed for ${title || tmdbId}`);
    return { success: false, error: 'No direct stream found in family cluster.' };
}
