/**
 * VidSrc.me Extractor — v1.0 (2026-04-29)
 *
 * VidSrc.me has migrated to .ru/.su domains. The official tracker at
 * vidsrc.domains lists these as LIVE:
 *   vidsrcme.ru / vidsrcme.su / vidsrc-me.ru / vidsrc-me.su
 *
 * Embed format (same as original vidsrc.me):
 *   Movie:  https://vidsrcme.ru/embed/movie?tmdb={id}
 *   TV:     https://vidsrcme.ru/embed/tv?tmdb={id}&s={season}&e={episode}
 *
 * Strategy: we wrap the embed URL in the frontend's embed player fallback.
 * Since we can't scrape raw M3U8 without a JS engine (full SPA), we provide
 * the iframe embed URL for the client to handle, flagged as isEmbed=true.
 *
 * NOTE: This extractor only fires when all M3U8 providers have failed.
 * It acts as a UI-level embed fallback, not a streaming source.
 */
import { gigaAxios } from '../utils/http.js';

const DOMAINS = [
    'https://vidsrcme.ru',
    'https://vidsrcme.su',
    'https://vidsrc-embed.ru',
];

async function pickLiveDomain() {
    for (const domain of DOMAINS) {
        try {
            const resp = await gigaAxios.head(domain, {
                timeout: 5000,
                validateStatus: () => true,
                maxRedirects: 2,
            });
            if (resp.status >= 200 && resp.status < 500) {
                return domain;
            }
        } catch (_) {
            // Try next
        }
    }
    return DOMAINS[0]; // Best-effort fallback
}

export async function scrapeVidSrcMe(tmdbId, type, season, episode) {
    try {
        const base = await pickLiveDomain();

        let embedUrl;
        if (type === 'movie') {
            embedUrl = `${base}/embed/movie?tmdb=${tmdbId}`;
        } else {
            const s = parseInt(season) || 1;
            const e = parseInt(episode) || 1;
            embedUrl = `${base}/embed/tv?tmdb=${tmdbId}&s=${s}&e=${e}`;
        }

        console.log(`[VidSrcMe] Embed URL: ${embedUrl}`);

        // Quick reachability probe so we don't return a dead embed
        const probe = await gigaAxios.head(embedUrl, {
            timeout: 8000,
            validateStatus: () => true,
            maxRedirects: 2,
        });

        if (probe.status >= 500) {
            console.warn(`[VidSrcMe] Probe returned ${probe.status} — skipping`);
            return null;
        }

        return {
            success: true,
            provider: 'VidSrc.me 🌐 (Embed)',
            providerId: 'vidsrcme',
            sources: [{
                url: embedUrl,
                quality: 'auto',
                isEmbed: true,
                isM3U8: false,
                provider: 'VidSrc.me 🌐 (Embed)',
                providerId: 'vidsrcme',
            }],
            subtitles: [],
        };
    } catch (e) {
        console.warn(`[VidSrcMe] Error: ${e.message}`);
        return null;
    }
}
