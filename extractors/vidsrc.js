import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Modern VidSrc Extractor (P-Stream / Aether Standard)
 * Targets: vidsrc.to, vidsrc.me, vidsrc.ru
 */
export async function scrapeVidSrc(tmdbId, type, season, episode) {
    try {
        console.log(`[VidSrc] 🔍 Resolving modern cluster (to/me/ru)...`);
        
        const targetHost = 'vidsrc.to';
        const embedUrl = type === 'movie' 
            ? `https://${targetHost}/embed/movie/${tmdbId}`
            : `https://${targetHost}/embed/tv/${tmdbId}/${season}/${episode}`;

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://${targetHost}/`
        };

        const mainResp = await axios.get(embedUrl, { headers });
        const $ = cheerio.load(mainResp.data);
        const dataId = $('a[data-id]').attr('data-id');
        if (!dataId) throw new Error('data-id not found');

        const ajaxUrl = `https://${targetHost}/ajax/embed/episode/${dataId}/sources?_=${Date.now()}`;
        const sourcesResp = await axios.get(ajaxUrl, { headers });
        if (!sourcesResp.data?.result?.length) throw new Error('No sources from AJAX');

        const vidplay = sourcesResp.data.result.find(s => s.title === 'Vidplay' || s.title === 'Vidstream');
        if (vidplay) {
            const sourceUrl = `https://${targetHost}/ajax/embed/source/${vidplay.id}?_=${Date.now()}`;
            const sData = await axios.get(sourceUrl, { headers });
            
            if (sData.data?.result?.url) {
                return {
                    success: true,
                    provider: 'VidSrc (Comet)',
                    sources: [
                        {
                            url: sData.data.result.url,
                            isM3U8: true,
                            quality: 'Multi',
                            isCoded: true,
                            referer: `https://${targetHost}/`
                        }
                    ]
                };
            }
        }

        return { success: false, error: 'No Vidplay source' };
    } catch (e) {
        console.error(`[VidSrc Error] ${e.message}`);
        return { success: false, error: e.message };
    }
}
