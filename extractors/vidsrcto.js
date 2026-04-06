/**
 * VidSrc.to Extractor (Modern 2026 Edition)
 * "Direct Only — No Embeds"
 *
 * This version supports dynamic key fetching (RC4) for VidPlay 
 * and direct M3U8 extraction.
 */
import { proxyAxios } from '../utils/http.js';
import * as cheerio from 'cheerio';
import { getLatestKeys, rc4Decrypt } from '../utils/keyService.js';
import { USER_AGENTS } from '../utils/constants.js';

const vidSrcToBase = 'https://vidsrc.to';
const UA = USER_AGENTS[0];

function decodeBase64UrlSafe(str) {
    const standardized = str.replace(/_/g, '/').replace(/-/g, '+');
    return Buffer.from(standardized, 'base64');
}

export async function scrapeVidSrcTo(tmdbId, type, season, episode) {
    try {
        const keys = await getLatestKeys();
        if (!keys) return null;

        const embedPath = type === 'movie'
            ? `/embed/movie/${tmdbId}`
            : `/embed/tv/${tmdbId}/${season}/${episode}`;

        const headers = { 'User-Agent': UA, Referer: `${vidSrcToBase}/` };

        // Step 1: Get data-id from main page
        const { data: mainPage } = await proxyAxios.get(`${vidSrcToBase}${embedPath}`, { headers, timeout: 8000 });
        const $ = cheerio.load(mainPage);
        const dataId = $('a[data-id]').attr('data-id');
        if (!dataId) return null;

        // Step 2: Get and Decrypt sources
        const { data: sourcesResp } = await proxyAxios.get(`${vidSrcToBase}/ajax/embed/episode/${dataId}/sources`, { headers });
        if (sourcesResp.status !== 200 || !sourcesResp.result?.length) return null;

        let selectedSource = null;
        for (const source of sourcesResp.result) {
            // Prioritize VidPlay/Vidstream (best direct streams)
            if (source.title === 'Vidplay' || source.title === 'Vidstream') {
                const { data: sData } = await proxyAxios.get(`${vidSrcToBase}/ajax/embed/source/${source.id}`, { headers });
                const encoded = decodeBase64UrlSafe(sData.result?.url);
                const decrypted = rc4Decrypt(keys.vidsrc_to || 'WXrUARXb1aDLaZjI', encoded);
                selectedSource = { name: source.title, url: decodeURIComponent(decodeURIComponent(decrypted)) };
                break;
            }
        }

        if (!selectedSource) return null;

        // Step 3: Resolve VidPlay into M3U8 (Handshake)
        const vidplayUrl = selectedSource.url.startsWith('//') ? `https:${selectedSource.url}` : selectedSource.url;
        const playerHost = new URL(vidplayUrl).origin;
        const playerHeaders = { 'User-Agent': UA, Referer: vidSrcToBase };

        // Fetch futoken for handshake (simulating browser-side token generation)
        const { data: futokenScript } = await proxyAxios.get(`${playerHost}/futoken`, { headers: playerHeaders });
        const futokenBase = futokenScript.match(/var\s+futoken\s*=\s*'([^']+)'/)?.[1];
        if (!futokenBase) return null;

        // Medainfo request
        const vidId = vidplayUrl.split('/').pop().split('?')[0];
        const mediaUrl = `${playerHost}/mediainfo/${vidId}${new URL(vidplayUrl).search}&futoken=${futokenBase}`;
        
        const { data: mediaInfo } = await proxyAxios.get(mediaUrl, { 
            headers: { ...playerHeaders, Referer: vidplayUrl },
            timeout: 8000
        });

        if (!mediaInfo?.result?.sources) return null;

        const m3u8 = mediaInfo.result.sources.find(s => s.file.includes('.m3u8'))?.file;
        const subtitles = (mediaInfo.result.tracks || [])
            .filter(t => t.kind === 'captions')
            .map(t => ({ url: t.file, lang: t.label, label: t.label }));

        if (m3u8) {
            return {
                success: true,
                provider: `VidSrc.to → ${selectedSource.name} 🔥`,
                sources: [{ url: m3u8, quality: 'auto', isM3U8: true, referer: playerHost }],
                subtitles
            };
        }

        return null;
    } catch (e) {
        return null;
    }
}
