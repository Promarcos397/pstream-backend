import axios from 'axios';

/**
 * Uembed Extractor (Aggregator Logic from CinePro)
 * This combines multiple high-speed direct APIs:
 *  - Uembed (uembed.xyz)
 *  - VXR (madplay.site)
 *  - Holly (madplay.site)
 *  - Rogflix (madplay.site)
 */

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://madplay.site/',
    'Origin': 'https://madplay.site'
};

async function fetchSources(url) {
    try {
        const { data } = await axios.get(url, { headers: HEADERS, timeout: 8000 });
        if (Array.isArray(data)) return data;
        return null;
    } catch {
        return null;
    }
}

export async function scrapeUembed(tmdbId, type, s, e) {
    const apis = [];
    
    // 1. Base Uembed API
    apis.push({ url: `https://uembed.xyz/api/video/tmdb?id=${tmdbId}`, name: 'Uembed' });

    // 2. VXR (Movies Only)
    if (type === 'movie') {
        apis.push({ url: `https://cdn.madplay.site/vxr?id=${tmdbId}&type=movie`, name: 'VXR' });
    }

    // 3. Holly & Rogflix (Token protected but hardcoded in CinePro)
    const hollyParams = new URLSearchParams({ id: tmdbId.toString(), token: 'thestupidthings' });
    const rogParams = new URLSearchParams({ id: tmdbId.toString(), token: 'thestupidthings' });

    if (type === 'movie') {
        hollyParams.append('type', 'movie');
        rogParams.append('type', 'movie');
    } else {
        hollyParams.append('type', 'series');
        hollyParams.append('season', s.toString());
        hollyParams.append('episode', e.toString());
        
        rogParams.append('type', 'series');
        rogParams.append('season', s.toString());
        rogParams.append('episode', e.toString());
    }

    apis.push({ url: `https://api.madplay.site/api/movies/holly?${hollyParams.toString()}`, name: 'Holly' });
    apis.push({ url: `https://api.madplay.site/api/rogflix?${rogParams.toString()}`, name: 'Rogflix' });

    try {
        const results = await Promise.all(apis.map(api => fetchSources(api.url)));
        const allSources = [];

        results.forEach((res, index) => {
            if (!res) return;
            const providerName = apis[index].name;

            res.forEach(stream => {
                if (stream.file && stream.file.includes('.m3u8')) {
                    allSources.push({
                        url: stream.file,
                        quality: stream.label || 'auto',
                        isM3U8: true,
                        server: providerName
                    });
                }
            });
        });

        if (allSources.length === 0) return null;

        return {
            success: true,
            provider: 'Uembed 🚀',
            sources: allSources,
            subtitles: []
        };

    } catch (error) {
        return null;
    }
}
