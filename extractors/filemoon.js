import axios from 'axios';
import * as cheerio from 'cheerio';
import { unpack } from 'unpacker';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function scrapeFilemoon(embedUrl) {
    try {
        const headers = {
            'User-Agent': userAgent,
            'Referer': new URL(embedUrl).origin + '/'
        };

        const { data: html } = await axios.get(embedUrl, { headers });
        const $ = cheerio.load(html);
        
        const iframeSrc = $('iframe').first().attr('src');
        if (!iframeSrc) return null;

        const { data: iframeHtml } = await axios.get(iframeSrc, { headers });
        const $iframe = cheerio.load(iframeHtml);

        const packedJs = $iframe('script').filter((_, el) => {
            return $iframe(el).html()?.includes('eval(function(p,a,c,k,e,d)');
        }).first().html();

        if (!packedJs) return null;

        const unpacked = unpack(packedJs);
        const videoMatch = unpacked.match(/file:"([^"]+)"/);
        
        if (videoMatch) {
            return {
                url: videoMatch[1],
                quality: 'auto',
                isM3U8: true,
                headers: {
                    'Referer': new URL(embedUrl).origin + '/',
                    'User-Agent': userAgent
                }
            };
        }
    } catch (e) {
        return null;
    }
    return null;
}
