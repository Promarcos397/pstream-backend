/**
 * VidSrc.xyz Extractor (2026 Rewrite)
 * 
 * vidsrc.xyz now directly embeds a cloudnestra.com /rcp/ URL as the iframe src.
 * This is the SAME cloudnestra CDN used by vsembed.ru / vidsrc.ru.
 * The RCP page resolves to the same multi-mirror M3U8 CDN (neonhorizonworkshops, etc.).
 * 
 * Since it uses the same cloudnestra CDN (noProxy), the browser fetches work.
 * This gives us a second, independent path into the same CDN cluster.
 */
import { proxyAxios } from '../utils/http.js';
import { USER_AGENTS } from '../utils/constants.js';

const BASE = 'https://vidsrc.xyz';
const UA = USER_AGENTS[0];

// Shared cloudnestra player domains (same as vidsrcru)
const PLAYER_DOMAINS = {
    '{v1}': 'neonhorizonworkshops.com',
    '{v2}': 'wanderlynest.com',
    '{v3}': 'orchidpixelgardens.com',
    '{v4}': 'cloudnestra.com'
};

function expandDomains(template) {
    let url = template;
    for (const [k, v] of Object.entries(PLAYER_DOMAINS)) url = url.replaceAll(k, v);
    return url.includes('{') ? null : url;
}

async function fetchPage(url, referer = BASE + '/') {
    if (url.startsWith('//')) url = 'https:' + url;
    const { data } = await proxyAxios.get(url, {
        headers: { 'User-Agent': UA, 'Referer': referer, 'Accept': 'text/html' },
        timeout: 12000
    });
    return data;
}

export async function scrapeVidSrcXyz(tmdbId, type, season, episode) {
    try {
        // Step 1: Get the embed page — cloudnestra /rcp/ URL is embedded directly
        const path = type === 'movie'
            ? `/embed/movie/${tmdbId}`
            : `/embed/tv/${tmdbId}/${parseInt(season) || 1}/${parseInt(episode) || 1}`;

        console.log(`[VidSrcXyz] Fetching embed...`);
        const html = await fetchPage(`${BASE}${path}`);

        // The RCP URL is in the main iframe src
        const rcpMatch = html.match(/src=["']((?:https?:)?\/\/cloudnestra\.com\/rcp\/[A-Za-z0-9+/=_-]+)["']/i);
        if (!rcpMatch) {
            console.log('[VidSrcXyz] No cloudnestra RCP URL found in embed page');
            return null;
        }

        const rcpUrl = rcpMatch[1].startsWith('//') ? `https:${rcpMatch[1]}` : rcpMatch[1];
        console.log(`[VidSrcXyz] RCP URL found: ${rcpUrl.substring(0, 70)}...`);

        // Step 2: Load the RCP page — it renders a server-picker UI and loads sbx.js
        const rcpHtml = await fetchPage(rcpUrl, `${BASE}/`);

        // Step 3: The RCP page loads /sbx.js which calls /sbox/id and returns the player URL
        // But the actual stream resolution happens via the server list. 
        // Look for any URLs that lead to the player (cloudnestra /e/ paths)
        const playerMatch = rcpHtml.match(/(?:src|href|action)=["']((?:https?:)?\/\/cloudnestra\.com\/e\/[^"']+)["']/i)
            || rcpHtml.match(/(?:src|href)=["']((?:https?:)?\/\/[^"']+\/e\/[^"']+)["']/i);

        if (playerMatch) {
            const playerUrl = playerMatch[1].startsWith('//') ? `https:${playerMatch[1]}` : playerMatch[1];
            console.log(`[VidSrcXyz] Player URL: ${playerUrl.substring(0, 80)}`);

            const playerHtml = await fetchPage(playerUrl, rcpUrl);
            
            // Extract M3U8 with domain placeholders
            const fileMatch = playerHtml.match(/file\s*:\s*["']([^"']+)["']/i);
            if (fileMatch) {
                const rawUrls = fileMatch[1].split(/\s+or\s+/i);
                const m3u8Urls = rawUrls.map(expandDomains).filter(Boolean);
                
                if (m3u8Urls.length > 0) {
                    console.log(`[VidSrcXyz] ✅ ${m3u8Urls.length} mirrors via player`);
                    return {
                        success: true,
                        provider: 'VidSrc.xyz 🔥',
                        sources: m3u8Urls.map(url => ({
                            url, quality: 'auto', isM3U8: true,
                            noProxy: true,
                            referer: 'https://cloudnestra.com/'
                        })),
                        subtitles: []
                    };
                }
            }
        }

        // Fallback: Get server list from the RCP's /sbx endpoint
        const tokenMatch = rcpUrl.match(/\/rcp\/([A-Za-z0-9+/=_-]+)/);
        if (!tokenMatch) return null;

        const rcpToken = tokenMatch[1];
        console.log(`[VidSrcXyz] Trying /sbx.js handshake...`);

        // Get the session box (list of available servers)
        const sboxRes = await proxyAxios.get(`https://cloudnestra.com/sbox/${rcpToken}`, {
            headers: { 'User-Agent': UA, 'Referer': rcpUrl, 'X-Requested-With': 'XMLHttpRequest' },
            timeout: 10000
        });

        const sbox = sboxRes.data;
        console.log(`[VidSrcXyz] sbox response:`, JSON.stringify(sbox).substring(0, 200));

        // sbox typically returns { result: [ { id, title, url } ] }
        const servers = sbox?.result || sbox?.sources || [];
        if (!servers.length) {
            console.log('[VidSrcXyz] No servers in sbox');
            return null;
        }

        // Pick the first server and get its player
        const firstServer = servers[0];
        const serverUrl = firstServer.url || firstServer.src;
        if (!serverUrl) return null;

        const serverHtml = await fetchPage(
            serverUrl.startsWith('//') ? `https:${serverUrl}` : serverUrl,
            rcpUrl
        );
        const fMatch = serverHtml.match(/file\s*:\s*["']([^"']+)["']/i);
        if (!fMatch) return null;

        const rawUrls = fMatch[1].split(/\s+or\s+/i);
        const m3u8Urls = rawUrls.map(expandDomains).filter(Boolean);
        if (!m3u8Urls.length) return null;

        console.log(`[VidSrcXyz] ✅ ${m3u8Urls.length} mirrors via sbox`);
        return {
            success: true,
            provider: 'VidSrc.xyz 🔥',
            sources: m3u8Urls.map(url => ({
                url, quality: 'auto', isM3U8: true,
                noProxy: true,
                referer: 'https://cloudnestra.com/'
            })),
            subtitles: []
        };

    } catch (e) {
        console.warn(`[VidSrcXyz] Error: ${e.message}`);
        return null;
    }
}
