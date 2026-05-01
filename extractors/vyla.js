/**
 * Vyla API Extractor — v1.0 (2026-05-01)
 *
 * Vyla is a public aggregator API (vyla-api.pages.dev) that scrapes
 * 8+ underlying providers and returns raw stream URLs in one call.
 *
 * Endpoints:
 *   Movie: GET https://vyla-api.pages.dev/api/movie?id={tmdbId}
 *   TV:    GET https://vyla-api.pages.dev/api/tv?id={tmdbId}&season={s}&episode={e}
 *
 * Response: { success, results_found, sources: [...], subtitles: [...] }
 *
 * Source types returned (observed live 2026-05-01 on Inception/27205):
 *   - 02MovieDownloader: direct MKV on Wasabi/S3 CDN (no IP lock)
 *   - VixSrc:           HLS playlist (IP-locked to resolver → noProxy=true)
 *   - VidRock:          HLS on Bunny CDN (works direct)
 *   - 02Embed:          HLS via madvid3.xyz proxy
 *   - VidZee:           Multiple HLS streams (CDN blocks HF → noProxy=true)
 *
 * CORS: Access-Control-Allow-Origin: * (free, no auth, no rate limit stated)
 * Speed: ~1-3s (Cloudflare Pages global edge)
 */
import { gigaAxios } from '../utils/http.js';

const BASE_URL = 'https://vyla-api.pages.dev';

// Providers whose CDN URLs are IP-locked to the resolver — must go noProxy
// so the browser fetches them directly (they're locked to Vyla's CF IP, not HF's).
const NOPROXY_PROVIDERS = new Set(['vixsrc', 'vidzee', 'vidZee']);

// Providers with direct CDN links that don't need proxying
const DIRECT_CDN_PROVIDERS = new Set(['02moviedownloader', 'vidrock', 'bunny']);

function mapSource(src) {
    const provider = src.provider || 'Unknown';
    const providerKey = provider.toLowerCase().replace(/\s+/g, '');
    const isHLS = src.type === 'hls';
    const isMP4 = src.type === 'mp4';
    const isMKV = src.type === 'mkv';

    // IP-locked providers: token was issued to Vyla's resolver IP.
    // Must bypass proxy so browser fetches directly (browser IP will mismatch anyway
    // but many of these don't do strict IP enforcement at play time, only at resolution).
    // VidZee: CDN actively blocks HF datacenter — noProxy required.
    const noProxy = NOPROXY_PROVIDERS.has(providerKey) || DIRECT_CDN_PROVIDERS.has(providerKey);

    const referer = src.headers?.Referer || src.headers?.referer || '';
    const origin  = src.headers?.Origin  || src.headers?.origin  || '';

    return {
        url:        src.url,
        quality:    src.quality  || 'auto',
        isM3U8:     isHLS,
        isEmbed:    false,
        noProxy,
        referer,
        origin,
        provider:   `Vyla/${provider}`,
        providerId: `vyla_${providerKey}`,
        // Preserve the original headers blob for the proxy to forward
        headers:    src.headers  || {},
        // Useful metadata
        _type:      src.type,
        _audioTracks: src.audioTracks || [],
    };
}

function mapSubtitle(sub) {
    return {
        url:    sub.url,
        label:  sub.label || 'Unknown',
        lang:   (sub.label || 'en').toLowerCase().startsWith('english') ? 'en'
              : (sub.label || 'en').toLowerCase().startsWith('french')  ? 'fr'
              : (sub.label || 'en').toLowerCase().split(' ')[0].slice(0, 2),
        format: sub.format || 'vtt',
    };
}

export async function scrapeVyla(tmdbId, type, season, episode) {
    try {
        let url;
        if (type === 'movie' || type === 'film') {
            url = `${BASE_URL}/api/movie?id=${tmdbId}`;
        } else {
            const s = parseInt(season) || 1;
            const e = parseInt(episode) || 1;
            url = `${BASE_URL}/api/tv?id=${tmdbId}&season=${s}&episode=${e}`;
        }

        console.log(`[Vyla] Fetching: ${url}`);

        const resp = await gigaAxios.get(url, {
            timeout: 15000,
            headers: {
                'Accept':          'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        const data = resp.data;

        if (!data?.success || !Array.isArray(data.sources) || data.sources.length === 0) {
            console.warn(`[Vyla] No sources returned (success=${data?.success}, found=${data?.results_found})`);
            return null;
        }

        // Filter out embed/proxy-wrapped sources that don't give us a clean CDN URL.
        // Keep: hls, mp4, mkv. Reject anything flagged as embed.
        const rawSources = data.sources.filter(s => s.url && !s.isEmbed);

        if (!rawSources.length) {
            console.warn('[Vyla] All sources were embeds — skipping');
            return null;
        }

        const sources   = rawSources.map(mapSource);
        const subtitles = (data.subtitles || []).map(mapSubtitle);

        // Prefer 1080p HLS, then 1080p MP4, then lower quality, etc.
        sources.sort((a, b) => {
            const qualityOrder = { '4k': 0, '2160p': 0, '1440p': 1, '1080p': 2, '720p': 3, '480p': 4, '360p': 5, 'hd': 6, 'auto': 7, 'unknown': 8 };
            const qa = qualityOrder[a.quality?.toLowerCase()] ?? 9;
            const qb = qualityOrder[b.quality?.toLowerCase()] ?? 9;
            if (qa !== qb) return qa - qb;
            // Among same quality, prefer HLS over direct file
            if (a.isM3U8 !== b.isM3U8) return a.isM3U8 ? -1 : 1;
            return 0;
        });

        console.log(`[Vyla] ✅ ${sources.length} sources, ${subtitles.length} subs — top: ${sources[0]?.provider} (${sources[0]?.quality})`);

        return {
            success:    true,
            provider:   'Vyla Aggregator',
            providerId: 'vyla',
            sources,
            subtitles,
        };

    } catch (e) {
        console.warn(`[Vyla] Error: ${e.response?.status || e.message}`);
        return null;
    }
}
