/**
 * HDRezka Extractor
 * Ported from legacy providers-production/src/providers/sources/hdrezka/
 * Russian-based high-quality source. Supports both movies and TV shows.
 * Returns direct MP4 links at multiple qualities + subtitles.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';

const rezkaBase = 'https://hdrezka.ag';
const baseHeaders = {
    'X-Hdrezka-Android-App': '1',
    'X-Hdrezka-Android-App-Version': '2.2.0',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'CF-IPCountry': 'RU'
};

function generateRandomFavs() {
    const randomHex = () => Math.floor(Math.random() * 16).toString(16);
    const seg = (len) => Array.from({ length: len }, randomHex).join('');
    return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`;
}

function parseVideoLinks(inputString) {
    if (!inputString) return null;
    const qualityMap = {};
    const links = inputString.split(',');
    links.forEach(link => {
        const match = link.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
        if (match && match[2] !== 'null') {
            const quality = match[1].replace(/<[^>]+>/g, '').toLowerCase().replace('p', '').trim();
            qualityMap[quality] = match[2].trim();
        }
    });
    return qualityMap;
}

function parseSubtitleLinks(inputString) {
    if (!inputString || typeof inputString === 'boolean') return [];
    const subs = [];
    const links = inputString.split(',');
    links.forEach(link => {
        const match = link.match(/\[([^\]]+)\](https?:\/\/\S+?)(?=,\[|$)/);
        if (match) {
            subs.push({ url: match[2], lang: match[1], label: match[1] });
        }
    });
    return subs;
}

export async function scrapeHDRezka(tmdbId, type, season, episode, title, year) {
    try {
        // 1. Search for media
        const { data: searchData } = await axios.get(`${rezkaBase}/engine/ajax/search.php`, {
            params: { q: title },
            headers: baseHeaders,
            timeout: 7000
        });

        const $ = cheerio.load(searchData);
        const items = $('a').map((_, el) => {
            const url = $(el).attr('href');
            const titleText = $(el).find('span.enty').text();
            const yearMatch = titleText.match(/\((\d{4})\)/) || url?.match(/-(\d{4})(?:-|\.html)/);
            const itemYear = yearMatch ? parseInt(yearMatch[1]) : null;
            const id = url?.match(/\/(\d+)-[^/]+\.html$/)?.[1];
            if (id) return { id, year: itemYear || year, url };
            return null;
        }).get().filter(Boolean);

        if (!items.length) return null;
        items.sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year));
        const result = items[0];

        // 2. Get translator ID
        const { data: pageSrc } = await axios.get(result.url, { headers: baseHeaders, timeout: 7000 });
        let translatorId = '238'; // Default: Original + subtitles
        if (!pageSrc.includes('data-translator_id="238"')) {
            const fnName = type === 'movie' ? 'initCDNMoviesEvents' : 'initCDNSeriesEvents';
            const match = pageSrc.match(new RegExp(`sof\\.tv\\.${fnName}\\(${result.id}, ([^,]+)`, 'i'));
            if (!match) return null;
            translatorId = match[1];
        }

        // 3. Get stream URL
        const params = new URLSearchParams({
            id: result.id,
            translator_id: translatorId,
            favs: generateRandomFavs(),
            action: type === 'movie' ? 'get_movie' : 'get_stream',
            t: Date.now().toString()
        });
        if (type !== 'movie') {
            params.append('season', String(season));
            params.append('episode', String(episode));
        }

        const { data: streamData } = await axios.post(
            `${rezkaBase}/ajax/get_cdn_series/`,
            params.toString(),
            {
                headers: {
                    ...baseHeaders,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    Referer: result.url
                },
                timeout: 7000
            }
        );

        const parsed = typeof streamData === 'string' ? JSON.parse(streamData) : streamData;
        if (!parsed?.url) return null;

        const qualities = parseVideoLinks(parsed.url);
        const subtitles = parseSubtitleLinks(parsed.subtitle);

        // Get best available quality URL
        const qualityPrefs = ['1080', '720', '480', '360'];
        let bestUrl = null;
        for (const q of qualityPrefs) {
            if (qualities?.[q]) { bestUrl = qualities[q]; break; }
        }
        if (!bestUrl && qualities) bestUrl = Object.values(qualities)[0];
        if (!bestUrl) return null;

        return {
            success: true,
            provider: 'HDRezka 🎬 (Direct)',
            sources: [{
                url: bestUrl,
                quality: 'auto',
                isM3U8: false, // MP4 direct link
                allQualities: qualities
            }],
            subtitles
        };
    } catch (e) {
        return null;
    }
}
