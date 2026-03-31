/**
 * AutoEmbed Extractor
 * Ported from legacy providers-production/src/providers/sources/autoembed.ts
 * Calls tom.autoembed.cc API which returns a direct HLS playlist URL.
 */
import axios from 'axios';

const apiUrl = 'https://tom.autoembed.cc';

export async function scrapeAutoEmbed(tmdbId, type, season, episode) {
    try {
        let id = tmdbId;
        const mediaType = type === 'tv' ? 'tv' : 'movie';

        if (type === 'tv') {
            id = `${tmdbId}/${season}/${episode}`;
        }

        const { data } = await axios.get(`${apiUrl}/api/getVideoSource`, {
            params: { type: mediaType, id },
            headers: {
                Referer: apiUrl,
                Origin: apiUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 6000
        });

        if (!data?.videoSource) return null;

        return {
            success: true,
            provider: 'AutoEmbed ⚡ (Direct)',
            sources: [{
                url: data.videoSource,
                quality: 'auto',
                isM3U8: true
            }]
        };
    } catch (e) {
        return null;
    }
}
