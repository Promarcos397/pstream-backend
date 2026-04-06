import { proxyAxios } from '../utils/http.js';
import * as cheerio from 'cheerio';

const ridoMoviesBase = `https://ridomovies.tv`;
const ridoMoviesApiBase = `${ridoMoviesBase}/core/api`;

const normalizeTitle = (title) => {
    return title.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
};

async function decodeCloseload(url, referer) {
    // This is a simplified version of the closeload decoding
    // In a real scenario, we'd need the full unpacker/ROT13 logic
    // For now, we return the iframe URL so the frontend can handle it if needed
    return url;
}

export async function scrapeRidoMovies(id, type, season, episode, title, year) {
    try {
        const { data: searchResult } = await proxyAxios.get(`${ridoMoviesApiBase}/search`, {
            params: { q: title },
            timeout: 5000
        });

        if (!searchResult.data?.items?.length) return null;

        const normalizedSearchTitle = normalizeTitle(title);
        const searchYear = year ? year.toString() : null;

        const targetMedia = searchResult.data.items.find(m => {
            const normalizedName = normalizeTitle(m.title);
            const mYear = m.contentable?.releaseYear?.toString();
            return normalizedName === normalizedSearchTitle && (!searchYear || mYear === searchYear);
        });

        if (!targetMedia?.fullSlug) return null;

        let iframeSourceUrl = `/${targetMedia.fullSlug}/videos`;

        if (type === 'show') {
            const { data: showPage } = await proxyAxios.get(`${ridoMoviesBase}/${targetMedia.fullSlug}`);
            const fullEpisodeSlug = `season-${season}/episode-${episode}`;
            
            // Extract episode ID using the regex from legacy code
            const regexPattern = new RegExp(
                `\\\\"id\\\\":\\\\"(\\d+)\\\\"(?=.*?\\\\"fullSlug\\\\":\\\\"[^"]*${fullEpisodeSlug}[^"]*\\\\")`,
                'g'
            );
            const matches = [...showPage.matchAll(regexPattern)];
            if (!matches.length) return null;

            const episodeId = matches[matches.length - 1][1];
            iframeSourceUrl = `/episodes/${episodeId}/videos`;
        }

        const { data: iframeSourceData } = await proxyAxios.get(`${ridoMoviesApiBase}${iframeSourceUrl}`);
        if (!iframeSourceData.data?.length) return null;

        const $ = cheerio.load(iframeSourceData.data[0].url);
        const iframeUrl = $('iframe').attr('data-src');

        if (!iframeUrl) return null;

        // If it's a direct stream link (rare for Rido but possible)
        if (iframeUrl.includes('.m3u8')) {
            return {
                success: true,
                provider: 'RidoMovies 🎥 (Direct)',
                sources: [{ url: iframeUrl, quality: 'auto', isM3U8: true }]
            };
        }

        // Return as an embed that the player can sandbox
        return {
            success: true,
            provider: 'RidoMovies 🎥 (Mirror)',
            sources: [{ url: iframeUrl, isEmbed: true }]
        };

    } catch (e) {
        return null;
    }
}
