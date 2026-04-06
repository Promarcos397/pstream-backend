import axios from 'axios';
import https from 'https';
import { HttpsCookieAgent, createCookieAgent } from 'http-cookie-agent/http';
import { CookieJar } from 'tough-cookie';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getRandomUA } from './constants.js';

// Browser-like TLS Agent (To bypass Cloudflare Bot Fight Mode)
const chromeCiphers = 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';

const globalCookieJar = new CookieJar();
const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;

// Combine HttpsProxyAgent and HttpsCookieAgent
const ProxyCookieAgent = proxyUrl ? createCookieAgent(HttpsProxyAgent) : null;
let proxyAgent;

if (proxyUrl) {
    try {
        const pUrl = new URL(proxyUrl);
        const proxyOptions = {
            cookies: { jar: globalCookieJar },
            ciphers: chromeCiphers,
            minVersion: 'TLSv1.2',
            honorCipherOrder: true
        };
        
        // If the URL has a username/password, pass them explicitly to the agent
        if (pUrl.username && pUrl.password) {
            proxyOptions.auth = `${decodeURIComponent(pUrl.username)}:${decodeURIComponent(pUrl.password)}`;
        }
        
        proxyAgent = new ProxyCookieAgent(proxyUrl, proxyOptions);
    } catch (e) {
        console.error('[HTTP] Failed to parse RESIDENTIAL_PROXY_URL:', e.message);
    }
}

export const browserHttpsAgent = new HttpsCookieAgent({ 
    cookies: { jar: globalCookieJar },
    ciphers: chromeCiphers, 
    minVersion: 'TLSv1.2', 
    honorCipherOrder: true 
});

// THE GIGA AGENT: Used by all scrapers and the playback proxy
export const gigaAxios = axios.create({
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
});

// Agent with residential proxy fallback (for extractors that are IP-banned on HF)
export const proxyAxios = axios.create({
    withCredentials: true,
    httpsAgent: proxyAgent || browserHttpsAgent,
    timeout: 15000
});

export const stringAtob = (input) => Buffer.from(input, 'base64').toString('binary');
export const stringBtoa = (input) => Buffer.from(input, 'binary').toString('base64');
