/**
 * ZoeChip Extractor
 * Ported from legacy providers-production/src/providers/sources/zoechip.ts
 * Scrapes zoechip.org HTML pages, extracts Filemoon embed, unpacks JS to get M3U8.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { unpack } from 'unpacker';

const zoeBase = 'https://zoechip.org';

function createSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

const headers = {
    Referer: zoeBase,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

export async function scrapeZoeChip(tmdbId, type, season, episode, title, year) {
    try {
        // 1. Build URL
        let pageUrl;
        if (type === 'movie') {
            const slug = createSlug(title);
            pageUrl = `${zoeBase}/film/${slug}-${year}`;
        } else {
            const slug = createSlug(title);
            pageUrl = `${zoeBase}/episode/${slug}-season-${season}-episode-${episode}`;
        }

        // 2. Get page and extract movie ID
        const { data: html } = await axios.get(pageUrl, { headers, timeout: 7000 });
        const $ = cheerio.load(html);
        const movieId = $('div#show_player_ajax').attr('movie-id')
            || $('[data-movie-id]').attr('data-movie-id')
            || $('[movie-id]').attr('movie-id');

        if (!movieId) return null;

        // 3. AJAX request for server list
        const params = new URLSearchParams({ action: 'lazy_player', movieID: movieId });
        const { data: ajaxHtml } = await axios.post(
            `${zoeBase}/wp-admin/admin-ajax.php`,
            params.toString(),
            {
                headers: {
                    ...headers,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    Referer: pageUrl
                },
                timeout: 7000
            }
        );

        const $ajax = cheerio.load(ajaxHtml);
        const filemoonUrl = $ajax('ul.nav a:contains(Filemoon)').attr('data-server');
        if (!filemoonUrl) return null;

        // 4. Follow Filemoon redirect
        const { request: redirectReq, data: redirectHtml } = await axios.get(filemoonUrl, { headers, timeout: 7000, maxRedirects: 5 });
        const finalUrl = redirectReq?.res?.responseUrl || filemoonUrl;
        const $redirect = cheerio.load(redirectHtml);
        const iframeUrl = $redirect('iframe').attr('src');
        if (!iframeUrl) return null;

        // 5. Get iframe content and unpack JS
        const { data: iframeHtml } = await axios.get(iframeUrl, { headers, timeout: 7000 });
        const evalMatch = iframeHtml.match(/eval\(function\(p,a,c,k,e,.*?\)\)/s);
        if (!evalMatch) return null;

        const unpacked = unpack(evalMatch[0]);
        const fileMatch = unpacked.match(/file\s*:\s*"([^"]+)"/i);
        if (!fileMatch) return null;

        return {
            success: true,
            provider: 'ZoeChip 🎭 (Direct)',
            sources: [{
                url: fileMatch[1],
                quality: 'auto',
                isM3U8: true
            }]
        };
    } catch (e) {
        return null;
    }
}
