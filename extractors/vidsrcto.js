/**
 * VidSrc.to Extractor (Reinvented from Archive)
 * Based on: legacy/archive/sources/vidsrcto/
 *
 * Flow:
 *  1. Fetch embed page → extract data-id
 *  2. Call AJAX sources API → get encrypted source URLs
 *  3. RC4-decrypt each URL (key: WXrUARXb1aDLaZjI)
 *  4. Find Filemoon URL → unpack its JS → extract M3U8
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { unpack } from 'unpacker';

const DECRYPTION_KEY = 'WXrUARXb1aDLaZjI';
const vidSrcToBase = 'https://vidsrc.to';

function decodeBase64UrlSafe(str) {
    const standardized = str.replace(/_/g, '/').replace(/-/g, '+');
    return Buffer.from(standardized, 'base64');
}

function rc4Decrypt(key, data) {
    const state = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + state[i] + key.charCodeAt(i % key.length)) % 256;
        [state[i], state[j]] = [state[j], state[i]];
    }
    let i = 0, k = 0;
    let result = '';
    for (let c = 0; c < data.length; c++) {
        i = (i + 1) % 256;
        k = (k + state[i]) % 256;
        [state[i], state[k]] = [state[k], state[i]];
        result += String.fromCharCode(data[c] ^ state[(state[i] + state[k]) % 256]);
    }
    return result;
}

function decryptSourceUrl(sourceUrl) {
    try {
        const encoded = decodeBase64UrlSafe(sourceUrl);
        const decoded = rc4Decrypt(DECRYPTION_KEY, encoded);
        return decodeURIComponent(decodeURIComponent(decoded));
    } catch (e) {
        return null;
    }
}

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Referer: `${vidSrcToBase}/`
};

export async function scrapeVidSrcTo(tmdbId, type, season, episode) {
    try {
        // Step 1: Fetch embed page → get data-id
        const embedPath = type === 'movie'
            ? `/embed/movie/${tmdbId}`
            : `/embed/tv/${tmdbId}/${season}/${episode}`;

        const { data: mainPage } = await axios.get(`${vidSrcToBase}${embedPath}`, {
            headers,
            timeout: 7000
        });

        const $ = cheerio.load(mainPage);
        const dataId = $('a[data-id]').attr('data-id');
        if (!dataId) return null;

        // Step 2: Get source list
        const { data: sources } = await axios.get(
            `${vidSrcToBase}/ajax/embed/episode/${dataId}/sources`,
            { headers, timeout: 7000 }
        );
        if (sources.status !== 200 || !sources.result?.length) return null;

        // Step 3: Decrypt each source URL
        const decryptedSources = [];
        for (const source of sources.result) {
            const { data: sourceResult } = await axios.get(
                `${vidSrcToBase}/ajax/embed/source/${source.id}`,
                { headers, timeout: 5000 }
            );
            const decrypted = decryptSourceUrl(sourceResult.result?.url);
            if (decrypted) {
                decryptedSources.push({ name: source.title, url: decrypted });
            }
        }

        if (!decryptedSources.length) return null;

        // Step 4: Prefer Filemoon → Unpack JS for M3U8
        const filemoonSrc = decryptedSources.find(s => s.name === 'Filemoon' || s.url.includes('filemoon'));
        if (filemoonSrc) {
            try {
                const { data: iframeHtml } = await axios.get(filemoonSrc.url, { headers, timeout: 7000 });
                const $fm = cheerio.load(iframeHtml);
                const innerIframe = $fm('iframe').first().attr('src');

                let srcToUnpack = iframeHtml;
                if (innerIframe) {
                    const { data: innerHtml } = await axios.get(innerIframe, { headers, timeout: 7000 });
                    srcToUnpack = innerHtml;
                }

                const evalMatch = srcToUnpack.match(/eval\(function\(p,a,c,k,e,.*?\)\)/s);
                if (evalMatch) {
                    const unpacked = unpack(evalMatch[0]);
                    const fileMatch = unpacked.match(/file:"([^"]+\.m3u8[^"]*)"/i);
                    if (fileMatch) {
                        return {
                            success: true,
                            provider: 'VidSrc.to → Filemoon 🌙 (Direct)',
                            sources: [{ url: fileMatch[1], quality: 'auto', isM3U8: true }]
                        };
                    }
                }
            } catch (e) {}
        }

        // Step 5: Try Vidplay if Filemoon failed (gets subtitles too)
        const vidplaySrc = decryptedSources.find(s => s.name === 'Vidplay' || s.url.includes('vidplay'));
        if (vidplaySrc) {
            // Vidplay subtitles are in the sub.info param
            const subUrl = new URL(vidplaySrc.url).searchParams.get('sub.info');
            let subtitles = [];
            if (subUrl) {
                try {
                    const { data: subData } = await axios.get(subUrl, { timeout: 4000 });
                    if (Array.isArray(subData)) {
                        subtitles = subData.map(s => ({
                            url: s.file || s.url,
                            lang: s.label || s.language || 'Unknown',
                            label: s.label || s.language || 'Unknown'
                        }));
                    }
                } catch (e) {}
            }
            // Vidplay itself requires further extraction (Cloudflare protected),
            // but we can return the subtitle data if already found via other means.
            // For now mark as attempted.
        }

        return null;
    } catch (e) {
        return null;
    }
}
