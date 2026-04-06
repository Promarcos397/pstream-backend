import axios from 'axios';
import https from 'https';
import { wrapper as axiosCookieJarWrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getRandomUA } from './constants.js';

// Browser-like TLS Agent (To bypass Cloudflare Bot Fight Mode)
// Matches modern Chrome 120+ cipher ordering and extensions
const chromeCiphers = 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';

export const browserHttpsAgent = new https.Agent({ 
    ciphers: chromeCiphers, 
    minVersion: 'TLSv1.2', 
    honorCipherOrder: true 
});

const globalCookieJar = new CookieJar();
const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

// THE GIGA AGENT: Used by all scrapers and the playback proxy
// This ensures IP alignment (Hugging Face IP) across the entire session
export const gigaAxios = axiosCookieJarWrapper(axios.create({
    jar: globalCookieJar,
    withCredentials: true,
    proxy: false, // We handle proxy manually via httpsAgent if needed
    httpsAgent: browserHttpsAgent,
    timeout: 10000,
    headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
    }
}));

// Agent with residential proxy fallback (for extractors that are IP-banned on HF)
export const proxyAxios = axiosCookieJarWrapper(axios.create({
    jar: globalCookieJar,
    withCredentials: true,
    httpsAgent: proxyAgent || browserHttpsAgent,
    timeout: 15000
}));

export const stringAtob = (input) => Buffer.from(input, 'base64').toString('binary');
export const stringBtoa = (input) => Buffer.from(input, 'binary').toString('base64');
