/**
 * Vyla API Extractor — v2.0 (2026-05-02)
 *
 * Vyla is a public aggregator API (vyla-api.pages.dev) that scrapes
 * multiple underlying providers and returns raw stream URLs in one call.
 *
 * Endpoints:
 *   Movie: GET https://vyla-api.pages.dev/api/movie?id={tmdbId}
 *   TV:    GET https://vyla-api.pages.dev/api/tv?id={tmdbId}&season={s}&episode={e}
 *
 * Response: { success, results_found, sources: [...], subtitles: [...] }
 *
 * Source types confirmed LIVE (2026-05-02 on Inception/27205 & BB S1E1/1396):
 *   1. 02Embed  (1080p HLS via madvid3.xyz / storrrrrrm.site proxy)
 *   2. CineSu   (1080p HLS direct: cine.su/v1/stream/master/{type}/{id}...)
 *   3. VidNest  (Auto HLS via loffe414wil CDN token-signed URL)
 *   4. VidNest  (HLS via storm.vodvidl.site)
 *   5. VidNest  (MP4 direct via tripplestream.online)
 *   6. VidNest  (HLS via goodstream.cc LS-25)
 *   7. VidNest  (HLS via goodstream.cc GS-25)
 *
 * Subtitles: Bengali, English, French VTT from vdrk.site + megafiles.store
 *
 * CORS: Access-Control-Allow-Origin: * (free, no auth, no rate limit stated)
 * Speed: ~1-3s (Cloudflare Pages global edge)
 */
import { gigaAxios } from '../utils/http.js';

const BASE_URL = 'https://vyla-api.pages.dev';

// Only flag providers whose token was IP-issued to Vyla's CDN IP at resolution
// time. CineSu and VidNest don't do IP-lock on playback — they work fine through
// our HF proxy once the URL is obtained.
const NOPROXY_PROVIDERS = new Set(['vixsrc', 'vidzee', 'vidzee']);

// Normalize VidNest quality strings like "LS-25", "GS-25", "MAIN", "Auto"
// into values our quality sorter understands.
function normalizeQuality(q = '', provider = '') {
    const lower = q.toLowerCase();
    // Pass-through known values
    if (['4k','2160p','1440p','1080p','720p','480p','360p','240p','hd'].includes(lower)) return q;
    // VidNest-specific
    if (lower === 'main')  return '1080p'; // tripplestream.online "MAIN" is typically 1080p
    if (lower === 'auto')  return 'auto';
    if (lower.startsWith('ls-') || lower.startsWith('gs-')) return '720p'; // goodstream.cc segments
    // CineSu returns "1080p" already
    return q || 'auto';
}

function mapSource(src) {
    const provider    = src.provider || 'Unknown';
    const providerKey = provider.toLowerCase().replace(/\s+/g, '');
    const isHLS = src.type === 'hls';

    // Only IP-locked providers need noProxy.
    // CineSu and VidNest tokens are not IP-locked at playback time.
    const noProxy = NOPROXY_PROVIDERS.has(providerKey);

    const referer = src.headers?.Referer || src.headers?.referer || '';
    const origin  = src.headers?.Origin  || src.headers?.origin  || '';

    return {
        url:        src.url,
        quality:    normalizeQuality(src.quality, provider),
        isM3U8:     isHLS,
        isEmbed:    false,
        noProxy,
        referer,
        origin,
        provider:   `Vyla/${provider}`,
        providerId: `vyla_${providerKey}`,
        headers:    src.headers || {},
        _type:      src.type,
        _audioTracks: src.audioTracks || [],
    };
}

function mapSubtitle(sub) {
    const label = sub.label || 'Unknown';
    const lower = label.toLowerCase();
    let lang = lower.split(' ')[0].slice(0, 2);
    if (lower.startsWith('english'))  lang = 'en';
    else if (lower.startsWith('french'))   lang = 'fr';
    else if (lower.startsWith('spanish'))  lang = 'es';
    else if (lower.startsWith('german'))   lang = 'de';
    else if (lower.startsWith('arabic'))   lang = 'ar';
    else if (lower.startsWith('bengali'))  lang = 'bn';
    else if (lower.startsWith('portuguese')) lang = 'pt';
    return {
        url:    sub.url,
        label,
        lang,
        format: sub.format || 'vtt',
    };
}

function deduplicateSubtitles(subs) {
    const seen = new Set();
    return subs.filter(sub => {
        if (!sub.url) return false;
        if (seen.has(sub.url)) return false;
        seen.add(sub.url);
        return true;
    });
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

        const subtitlesDedupe = deduplicateSubtitles(subtitles);

        console.log(`[Vyla] ✅ ${sources.length} sources, ${subtitlesDedupe.length} subs`);
        sources.forEach((s, i) => console.log(`[Vyla]   [${i+1}] ${s.provider} | ${s.quality} | ${s._type} | noProxy=${s.noProxy}`));

        return {
            success:    true,
            provider:   'Vyla Aggregator',
            providerId: 'vyla',
            sources,
            subtitles: subtitlesDedupe,
        };

    } catch (e) {
        console.warn(`[Vyla] Error: ${e.response?.status || e.message}`);
        return null;
    }
}
