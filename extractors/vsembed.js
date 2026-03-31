import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Global Proxy Config if available from environment
const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://vsembed.ru/'
};

const axiosInstance = axios.create({
    httpsAgent,
    proxy: false,
    timeout: 7000
});

export async function scrapeVsEmbed(id, type, season, episode) {
    try {
        // 1. Build initial URL
        const pageUrl = type === 'movie' 
            ? `https://vsembed.ru/embed/movie?tmdb=${id}`
            : `https://vsembed.ru/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`;

        // 2. Fetch primary page
        const { data: html } = await axiosInstance.get(pageUrl, { headers: HEADERS });

        // 3. Extract player iframe
        let secondUrl = html.match(/<iframe[^>]*\s+src=["']([^"']+)["'][^>]*>/i)?.[1];
        if (!secondUrl) return null;
        if (secondUrl.startsWith('//')) secondUrl = 'https:' + secondUrl;

        // 4. Fetch the iframe source
        const { data: secondHtml } = await axiosInstance.get(secondUrl, { headers: { ...HEADERS, Referer: pageUrl } });

        // 5. Extract internal loader source (relSrc)
        const relSrc = secondHtml.match(/src:\s*['"]([^'"]+)['"]/i)?.[1];
        if (!relSrc) return null;
        
        let thirdUrl;
        try {
            thirdUrl = new URL(relSrc, secondUrl).href;
        } catch { return null; }

        // 6. Fetch final loader which contains the 'file' array
        const { data: thirdHtml } = await axiosInstance.get(thirdUrl, { headers: { ...HEADERS, Referer: secondUrl } });

        // 7. Extract the encoded m3u8 array mapped with {v} keys
        const fileField = thirdHtml.match(/file\s*:\s*["']([^"']+)["']/i)?.[1];
        if (!fileField) return null;

        // 8. Replace placeholders with known Cloudnestra architecture domains
        const playerDomains = {
            '{v1}': 'neonhorizonworkshops.com',
            '{v2}': 'wanderlynest.com',
            '{v3}': 'orchidpixelgardens.com',
            '{v4}': 'cloudnestra.com'
        };

        const rawUrls = fileField.split(/\s+or\s+/i);
        const validSources = [];

        for (let template of rawUrls) {
            let url = template;
            for (const [placeholder, domain] of Object.entries(playerDomains)) {
                url = url.replace(placeholder, domain);
            }
            // If completely mapped without remaining {v} wrappers
            if (!url.includes('{') && !url.includes('}')) {
                validSources.push({
                    url: url,
                    quality: 'auto',
                    isM3U8: true,
                    referer: 'https://cloudnestra.com/',
                    // Pass specific headers to the frontend player component for playback
                    headers: {
                        referer: 'https://cloudnestra.com/',
                        origin: 'https://cloudnestra.com'
                    }
                });
            }
        }

        if (validSources.length > 0) {
            return {
                success: true,
                provider: 'VsEmbed (Mirror)',
                referer: 'https://cloudnestra.com/',
                sources: validSources
            };
        }

    } catch (e) {
        // Silent catch for racing
    }
    return null;
}
