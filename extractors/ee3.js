/**
 * EE3 Extractor
 * Ported from legacy providers-production/src/providers/sources/ee3/
 * Auth-based direct MP4 source. Movies only.
 */
import axios from 'axios';

const apiBaseUrl = 'https://borg.rips.cc';
const username = '_ps_';
const password = 'defonotscraping';

export async function scrapeEE3(tmdbId, type) {
    // EE3 only supports movies
    if (type !== 'movie') return null;

    try {
        // Step 1: Authenticate
        const authRes = await axios.post(
            `${apiBaseUrl}/api/collections/users/auth-with-password?expand=lists_liked`,
            { identity: username, password },
            {
                headers: {
                    Origin: 'https://ee3.me',
                    'Content-Type': 'application/json'
                },
                timeout: 6000
            }
        );

        const token = authRes.data?.token;
        if (!token) return null;

        // Step 2: Find movie by TMDB ID
        const movieRes = await axios.get(
            `${apiBaseUrl}/api/collections/movies/records?page=1&perPage=48&filter=tmdb_data.id%20~%20${tmdbId}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Origin: 'https://ee3.me'
                },
                timeout: 6000
            }
        );

        const items = movieRes.data?.items;
        if (!items?.length || !items[0].video) return null;

        const videoId = items[0].video;

        // Step 3: Get the video key
        const keyRes = await axios.get(
            `${apiBaseUrl}/video/${videoId}/key`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Origin: 'https://ee3.me'
                },
                timeout: 6000
            }
        );

        const key = keyRes.data?.key;
        if (!key) return null;

        const videoUrl = `${apiBaseUrl}/video/${videoId}?k=${key}`;

        return {
            success: true,
            provider: 'EE3 🎬 (Direct)',
            sources: [{
                url: videoUrl,
                quality: 'auto',
                isM3U8: false, // MP4 direct
                headers: { Origin: 'https://ee3.me' }
            }]
        };
    } catch (e) {
        return null;
    }
}
