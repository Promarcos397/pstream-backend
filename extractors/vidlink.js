import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { USER_AGENTS } from '../utils/constants.js';

const API_BASE = 'https://enc-dec.app/api';
const VIDLINK_BASE = 'https://vidlink.pro/api/b';

const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

const UA = USER_AGENTS[0]; // Standardize on one for token consistency

const headers = {
  'User-Agent': UA,
  Connection: 'keep-alive',
  Referer: 'https://vidlink.pro/',
  Origin: 'https://vidlink.pro',
};

async function encryptTmdbId(tmdbId) {
    try {
        const { data } = await axios.get(`${API_BASE}/enc-vidlink`, {
            params: { text: tmdbId },
            timeout: 5000
        });
        return data?.result;
    } catch (e) {
        return null;
    }
}

export async function scrapeVidLink(tmdbId, type, season, episode) {
    try {
        const encryptedId = await encryptTmdbId(tmdbId.toString());
        if (!encryptedId) return null;

        const apiUrl = type === 'movie'
            ? `${VIDLINK_BASE}/movie/${encryptedId}`
            : `${VIDLINK_BASE}/tv/${encryptedId}/${season}/${episode}`;

        const { data: vidlinkData } = await axios.get(apiUrl, { headers, timeout: 5000 });
        
        if (!vidlinkData?.stream) return null;

        const { stream } = vidlinkData;
        const playlistUrl = stream.playlist;
        const streamHeaders = stream.headers || {};

        // Build fetch headers — use embedded referer/origin from VidLink stream headers
        const referer = streamHeaders.referer || 'https://videostr.net/';
        const origin = streamHeaders.origin || 'https://videostr.net';

        const fetchHeaders = {
            'User-Agent': UA,
            'Referer': referer,
            'Origin': origin,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
        };

        // Pre-fetch the M3U8 manifest NOW (same pod/IP as this scrape session)
        // This avoids IP-signed CDN token failures when the proxy/frontend fetches later
        let cachedManifest = null;
        let manifestBaseUrl = playlistUrl;
        try {
            const parsedUrl = new URL(playlistUrl);
            const hostParam = parsedUrl.searchParams.get('host');
            if (hostParam) manifestBaseUrl = hostParam;

            const manifestResp = await axios.get(playlistUrl, {
                headers: fetchHeaders,
                // REMOVE proxyAgent to align IPs (Scraper IP == Playback Proxy IP on HF)
                responseType: 'text',
                timeout: 12000,
                maxRedirects: 5,
                proxy: false
            });
            cachedManifest = manifestResp.data;
        } catch (e) {
            // If pre-fetch fails, fall back to URL-based proxying
            console.warn('[VidLink] Manifest pre-fetch failed:', e.message);
        }

        const captions = (stream.captions || []).map(c => ({
            url: c.url,
            lang: c.language || 'Unknown',
            label: c.language || 'Unknown'
        }));

        return {
            success: true,
            provider: 'VidLink 🔥 (Direct)',
            sources: [{
                url: playlistUrl,
                quality: 'auto',
                isM3U8: true,
                referer,
                headers: fetchHeaders,
                cachedManifest,       // pre-fetched manifest content
                manifestBaseUrl,      // for resolving relative segment URLs
            }],
            subtitles: captions
        };
    } catch (e) {
        return null;
    }
}
