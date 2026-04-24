import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import { createChallenge, verifyChallenge } from './utils/challenge.js';
import { getProfile, updateProfile, deleteProfile } from './utils/db.js';
import { resolveStreaming } from './resolver.js';
import { USER_AGENTS, getRandomUA } from './utils/constants.js';
import Redis from 'ioredis';
import { recordProviderError, recordProviderSuccess, getAllProviderHealth } from './services/providerHealth.js';
dotenv.config();
// BUILD: 2026-04-16T06:50Z � SuperEmbed Stage1A, proxy?gigaAxios, raceExtractors v14.1

import { gigaAxios, proxyAxios, browserHttpsAgent } from './utils/http.js';

const app = express();
const PORT = process.env.PORT || 7860;

// --- REDIS (UPSTASH) ---
let redis = null;
if (process.env.REDIS_URL) {
    try {
        redis = new Redis(process.env.REDIS_URL);
        console.log('[Engine] Syncing with Cloud Redis...');
    } catch (e) {}
}
export { redis };

if (!process.env.JWT_SECRET) { console.error('[FATAL] JWT_SECRET env var is not set.'); process.exit(1); }
const JWT_SECRET = process.env.JWT_SECRET;

// CORS — whitelist only the frontend domain
const ALLOWED_ORIGINS = [
    'https://pstream-frontend.pages.dev',
    'https://pstream.watch',
    'https://www.pstream.watch',
    'https://ibrahimar397-pstream-giga.hf.space',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173'
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, mobile apps, Hls.js segment fetches)
        if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.pages.dev')) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origin '${origin}' is not allowed`));
        }
    },
    credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use('/assets', express.static('assets'));

// Simple in-memory rate limiter for auth endpoints
const rateLimitMap = new Map();
function rateLimit(key, maxRequests = 10, windowMs = 60000) {
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count++;
    rateLimitMap.set(key, entry);
    return entry.count > maxRequests;
}

// --- ASSET RESOLVER (Local vs Remote) ---

const getAsset = (name, remote) => {
    try {
        if (fs.existsSync(`./assets/${name}`)) return `/assets/${name}`;
    } catch (e) {}
    return remote;
};

const LOGO = getAsset('pstream-logo.png', 'https://raw.githubusercontent.com/Promarcos397/pstream-frontend/main/assets/pstream-logo.png');
const BG_IMG = getAsset('landing-bg.png', 'https://raw.githubusercontent.com/Promarcos397/pstream-frontend/main/assets/landing-bg.png');

// --- CINEMATIC DESIGN SYSTEM ---

const MASTER_DESIGN = `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root { --p-red: #e50914; --p-dark: #000; --p-glass: rgba(0, 0, 0, 0.85); --p-border: rgba(255, 255, 255, 0.1); }
        * { box-sizing: border-box; }
        body { 
            background: #000; color: #fff; font-family: 'Consolas', monospace; 
            margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative; -webkit-font-smoothing: antialiased;
        }
        .bg-layer { position: absolute; inset: 0; z-index: -10; }
        .bg-img { 
            position: absolute; inset: 0; background: url('${BG_IMG}') center/cover no-repeat; 
            opacity: 0.6; transform: scale(1.05); filter: blur(2px) brightness(0.4);
        }
        .bg-gradient { 
            position: absolute; inset: 0; 
            background: linear-gradient(to bottom, 0%, rgba(0,0,0,0) 50%, 100%), 
                        radial-gradient(circle at center, transparent 0%, black 90%); 
        }
        .container { position: relative; z-index: 100; width: 100%; max-width: 550px; padding: 2rem; animation: entry 1.5s ease-out; }
        
        .logo { 
            height: clamp(24px, 5vw, 30px); margin-bottom: 3.5rem; filter: drop-shadow(0 0 10px rgba(229, 9, 20, 0.3)); 
            transition: 0.4s; cursor: pointer; display: inline-block;
        }
        .logo:hover { filter: drop-shadow(0 0 20px rgba(229, 9, 20, 0.6)); transform: scale(1.05); }

        .card {
            background: var(--p-glass); border: 1px solid var(--p-border); border-radius: 4px;
            padding: 4rem 3rem; backdrop-filter: blur(24px); box-shadow: 0 40px 100px rgba(0,0,0,1);
            position: relative; overflow: hidden;
        }
        .card::after {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
            background: linear-gradient(90deg, transparent, rgba(229, 9, 20, 0.5), transparent);
        }

        h1 { font-size: 1.8rem; font-weight: 900; margin: 0 0 0.5rem; letter-spacing: 2px; text-transform: uppercase; }
        .tagline { font-size: 0.7rem; color: rgba(255,255,255,0.35); margin-bottom: 3.5rem; text-transform: uppercase; letter-spacing: 4px; display: block; }

        .grid { display: grid; grid-template-cols: 1fr 1fr; gap: 2rem; margin-bottom: 3rem; }
        .grid-item { position: relative; padding-left: 12px; border-left: 2px solid var(--p-red); }
        .val { font-size: 1.1rem; font-weight: 900; color: #fff; display: block; }
        .lbl { font-size: 0.6rem; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; font-weight: bold; }

        .status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 6px; background: #00ff55; box-shadow: 0 0 10px #00ff55; }
        .dot-offline { background: #ff0055; box-shadow: 0 0 10px #ff0055; }

        .btn-group { display: flex; flex-direction: column; gap: 1rem; }
        .btn {
            background: var(--p-red); color: #fff; text-decoration: none; padding: 1.2rem;
            border-radius: 2px; font-weight: 900; text-transform: uppercase; font-size: 0.8rem;
            letter-spacing: 2px; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); text-align: center;
            box-shadow: 0 5px 20px rgba(229, 9, 20, 0.2);
        }
        .btn:hover { background: #ff0b17; transform: translateY(-3px); box-shadow: 0 12px 40px rgba(229, 9, 20, 0.5); }
        .btn-ghost { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); box-shadow: none; }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.4); color: #fff; background: rgba(255,255,255,0.05); }

        @keyframes entry { 
            from { opacity: 0; transform: translateY(15px) scale(0.98); } 
            to { opacity: 1; transform: translateY(0) scale(1); } 
        }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
    </style>
`;

// --- ROUTE: HOME ---

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Pstream Engine</title>
        ${MASTER_DESIGN}
        <style>
            .hero-text { font-size: clamp(2.5rem, 8vw, 4.5rem); font-weight: 900; line-height: 1.1; margin-bottom: 1.5rem; letter-spacing: -2px; }
            .sub-text { font-size: 1.2rem; color: #fff; margin-bottom: 3.5rem; max-width: 600px; margin-left: auto; margin-right: auto; line-height: 1.6; }
            .main-btn { 
                display: inline-flex; align-items: center; justify-content: center; gap: 10px;
                background: var(--p-red); color: #fff; text-decoration: none; padding: 1.5rem 4rem;
                font-size: 1.6rem; font-weight: 900; border-radius: 4px; transition: 0.3s;
                box-shadow: 0 10px 40px rgba(229, 9, 20, 0.4);
            }
            .main-btn:hover { background: #ff0b17; transform: scale(1.02); box-shadow: 0 15px 50px rgba(229, 9, 20, 0.6); }
            .sub-link { 
                margin-top: 2rem; color: rgba(255,255,255,0.5); text-decoration: none; 
                font-size: 0.8rem; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; 
                transition: 0.2s; display: inline-block;
            }
            .sub-link:hover { color: #fff; letter-spacing: 3px; }
        </style>
    </head>
    <body>
        <div class="bg-layer"><div class="bg-img"></div><div class="bg-gradient"></div></div>
        <div class="container" style="max-width: 900px">
            <a href="https://pstream.watch"><img src="${LOGO}" alt="Pstream" class="logo" /></a>
            
            <h1 class="hero-text">Unlimited power, series and more</h1>
            <p class="sub-text">Pstream Engine v5.0.0 is ready. Launch the hub to explore your collection or check system health below.</p>
            
            <div>
                <a href="https://pstream.watch" class="main-btn">
                    Get Started 
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </a>
            </div>

            <a href="/healthcheck" class="sub-link">System Diagnostics & Cluster Stats</a>
        </div>
    </body>
    </html>
    `);
});

// --- ROUTE: PING (keep-alive / wake-up) ---
// Ultra-lightweight. The frontend calls this on mount to wake the HF Space.
// Returns in <1ms. No DB, no providers, no heavy processing.
app.get('/api/ping', (req, res) => {
    res.json({ ok: true, t: Date.now() });
});

// --- ROUTE: PROVIDER DEBUG (test each Stage 1A provider individually) ---
app.get('/api/debug-providers', async (req, res) => {
    const { tmdbId = '637', type = 'movie', season = '1', episode = '1' } = req.query;

    // Import extractors
    const [
        { scrapeAutoEmbed },
        { scrapeVidZee },
        { scrape2Embed: scrape2EmbedFn },
        { scrapeMoviesApi },
        { scrapeVidSrcTo },
    ] = await Promise.all([
        import('./extractors/autoembed.js'),
        import('./extractors/vidzee.js'),
        import('./extractors/twoembed.js'),
        import('./extractors/moviesapi.js'),
        import('./extractors/vidsrcto.js'),
    ]);

    // Wrap each extractor to catch and expose errors (normally they silently return null)
    const test = async (name, fn) => {
        const start = Date.now();
        let lastError = null;
        // Temporarily intercept console.warn to capture error messages
        const warns = [];
        const origWarn = console.warn;
        console.warn = (...args) => { warns.push(args.join(' ')); origWarn(...args); };
        try {
            const result = await Promise.race([
                fn(),
                new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT_12s')), 12000))
            ]);
            console.warn = origWarn;
            return {
                name,
                ok: !!result?.success,
                provider: result?.provider,
                sources: result?.sources?.length || 0,
                ms: Date.now() - start,
                warns: warns.slice(-3), // last 3 warnings
            };
        } catch (e) {
            console.warn = origWarn;
            lastError = e.message;
            return { name, ok: false, error: lastError, warns: warns.slice(-3), ms: Date.now() - start };
        }
    };

    const results = await Promise.allSettled([
        test('AutoEmbed', () => scrapeAutoEmbed(tmdbId, type, season, episode)),
        test('VidZee',    () => scrapeVidZee(tmdbId, type, season, episode)),
        test('2Embed',    () => scrape2EmbedFn(tmdbId, type, season, episode)),
        test('MoviesAPI', () => scrapeMoviesApi(tmdbId, type, season, episode)),
        test('VidSrc.to', () => scrapeVidSrcTo(tmdbId, type, season, episode)),
    ]);

    res.json({ tmdbId, type, results: results.map(r => r.value || { error: r.reason?.message }) });
});

// --- ROUTE: HEALTH CHECK ---

app.get('/healthcheck', async (req, res) => {
    const mem = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
    const cpu = Math.floor(os.loadavg()[0] * 100) / 10;
    const uptime = Math.floor(process.uptime());

    const providers = [
        { name: 'VidSrc.to', url: 'https://vidsrc.to' },
        { name: 'VixSrc.to', url: 'https://vixsrc.to' },
        { name: 'Embed.su', url: 'https://embed.su' },
        { name: 'VidSrc.me', url: 'https://vidsrc.me' },
        { name: 'VidSrc.vip', url: 'https://vidsrc.vip' },
        { name: 'SuperEmbed', url: 'https://multiembed.mov' },
        { name: '2Embed', url: 'https://www.2embed.cc' }
    ];

    if (req.headers.accept?.includes('text/html')) {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Pstream Diagnostics</title>
            ${MASTER_DESIGN}
            <style>
                .grid { grid-template-cols: 1fr 1fr 1fr; margin-bottom: 2rem !important; }
                .card { padding: 3rem 2rem; max-width: 600px; }
                .provider-list { 
                    display: grid; grid-template-cols: 1fr 1fr; gap: 0.8rem; 
                    margin-top: 2rem; padding: 1.5rem; background: rgba(255,255,255,0.03); 
                    border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);
                }
                .p-link { 
                    font-size: 0.65rem; color: rgba(255,255,255,0.4); text-decoration: none; 
                    display: flex; align-items: center; transition: 0.2s;
                }
                .p-link:hover { color: var(--p-red); transform: translateX(4px); }
                .p-dot { width: 4px; height: 4px; border-radius: 50%; background: #00ff55; margin-right: 8px; box-shadow: 0 0 5px #00ff55; }
            </style>
        </head>
        <body>
            <div class="bg-layer"><div class="bg-img"></div><div class="bg-gradient"></div></div>
            <div class="container" style="max-width: 600px">
                <a href="/"><img src="${LOGO}" alt="Pstream" class="logo" /></a>
                <div class="card">
                    <h1>DIAGNOSTICS</h1>
                    <span class="tagline">Engine Performance Data</span>
                    <div class="grid">
                        <div class="grid-item">
                            <span class="val">${uptime}s</span>
                            <span class="lbl">Uptime</span>
                        </div>
                        <div class="grid-item">
                            <span class="val">${mem}MB</span>
                            <span class="lbl">Memory</span>
                        </div>
                        <div class="grid-item">
                            <span class="val">${cpu}%</span>
                            <span class="lbl">Load</span>
                        </div>
                    </div>

                    <span class="lbl" style="text-align: left; display: block; margin-left: 5px">Cluster Relays</span>
                    <div class="provider-list">
                        ${providers.map(p => `
                            <a href="${p.url}" target="_blank" class="p-link"><span class="p-dot"></span>${p.name}</a>
                        `).join('')}
                    </div>

                    <div class="btn-group" style="margin-top: 2rem">
                        <a href="/" class="btn">Return to Core</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `);
    } else {
        res.json({ status: 'live', uptime, memory: mem, load: cpu, redis: !!redis, providers });
    }
});

// --- GIGA PROXY ---

// 1. Full Proxy Manifest Rewriter (Intercepts /proxy/stream)
// Proxies BOTH .m3u8 and .ts segments to solve CORS and mask the browser.
// Uses identical IP as the scraper (native HF) to satisfy VidLink IP-Locking.
function rewriteFullProxyManifest(text, baseUrl, reqProtocol, reqHost, activeReferer) {
    const lines = text.split(/\r?\n/);
    const origin = (() => { try { return new URL(activeReferer).origin; } catch(_) { return ''; } })();
    const headers = JSON.stringify({ referer: activeReferer, origin });
    const headersParam = `&headers=${encodeURIComponent(headers)}`;

    return lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        
        if (trimmed.startsWith('#')) {
            // Target sub-playlists in URI= tags
            if (/URI=/i.test(trimmed)) {
                return trimmed.replace(/URI=(['"]?)(.*?)\1/i, (match, quote, p2) => {
                    let absoluteUrl = p2;
                    try { absoluteUrl = new URL(p2, baseUrl).href; } catch (e) { return match; }
                    
                    const isSubManifest = /[.\/]m3u8/i.test(absoluteUrl) || /manifest/i.test(absoluteUrl) || /m3u/i.test(absoluteUrl);
                    const proxyPath = isSubManifest ? '/proxy/stream' : '/proxy/stream'; // Unify
                    return `URI=${quote}${reqProtocol}://${reqHost}${proxyPath}?url=${encodeURIComponent(absoluteUrl)}${headersParam}${quote}`;
                });
            }
            return trimmed;
        }
        
        let absoluteUrl = trimmed;
        try { absoluteUrl = new URL(trimmed, baseUrl).href; } catch (e) { return trimmed; }
        
        // Wrap EVERYTHING in our proxy back-channel to avoid CORS and hide the browser Origin
        return `${reqProtocol}://${reqHost}/proxy/stream?url=${encodeURIComponent(absoluteUrl)}${headersParam}`;
    }).join('\n');
}


// --- GIGA PROXY ---

// Safely parse headers for spoofing
function extractSpoofedHeaders(req, targetUrl, defaultReferer) {
    const rawReqUrl = req.originalUrl || req.url;
    const mainSearchParams = new URL(rawReqUrl, `http://${req.get('host')}`).searchParams;
    let customHeaders = {};

    const headersParam = mainSearchParams.get('headers') || req.query.headers;
    if (headersParam) {
        try { customHeaders = JSON.parse(headersParam); } catch (e) {}
    }

    try {
        const nested = new URL(targetUrl).searchParams.get('headers');
        if (nested) {
            const parsed = JSON.parse(nested);
            customHeaders = { ...customHeaders, ...parsed };
        }
    } catch (e) {}

    const referer = customHeaders.referer || mainSearchParams.get('referer') || defaultReferer;
    const origin = customHeaders.origin || (referer ? new URL(referer).origin : '');

    return {
        "User-Agent": getRandomUA(),
        "Referer": referer,
        "Origin": origin,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "Connection": "keep-alive"
    };
}



// 1. Unified Full Proxy Route (Proxies EVERYTHING natively with matched IPs)
app.get('/proxy/stream', async (req, res) => {
    try {
        const urlStr = req.query.url;
        if (!urlStr) return res.status(400).send('No URL provided');

        // Safe bounded URL decode (max 5 iterations, no infinite loop)
        let targetUrl = String(urlStr);
        for (let i = 0; i < 5; i++) {
            try {
                const decoded = decodeURIComponent(targetUrl);
                if (decoded === targetUrl) break;
                targetUrl = decoded;
            } catch(e) { break; }
        }
        // Patch persistent NGINX double-encoding traps
        targetUrl = targetUrl.replace(/%252F/g, '/').replace(/%2F/gi, '/').replace(/%253D/g, '=').replace(/%3D/gi, '=');


        // Fast-fail: CDN domains that block HF datacenter IPs — frontier must use noProxy
        const CDN_BLOCKLIST = ['neonhorizonworkshops.com','wanderlynest.com','orchidpixelgardens.com','zebi.xalaflix.design'];
        try {
            const targetHost = new URL(targetUrl).hostname;
            if (CDN_BLOCKLIST.some(blocked => targetHost.endsWith(blocked))) {
                console.warn([Proxy] Fast-fail: CDN block on +targetHost);
                return res.status(403).json({ error: 'CDN_BLOCK', message: CDN blocks datacenter IPs - use noProxy=true });
            }
        } catch (_) {}
        // Detect M3U8 by URL pattern — includes /playlist/ (VixSrc), .m3u8, /manifest, etc.
        const isM3U8 = /\.m3u8/i.test(targetUrl)
            || /\/manifest/i.test(targetUrl)
            || /\/playlist\//i.test(targetUrl)   // VixSrc: /playlist/{id}?token=...
            || /\/master\b/i.test(targetUrl)      // /master.m3u8 variants
            || /m3u/i.test(targetUrl);
        const fetchHeaders = extractSpoofedHeaders(req, targetUrl, targetUrl);

        let finalFetchUrl = '';
        let edgeBasePath = '';

        // --- SNIPER: ZERO-PROXY EDGE BYPASS (Improved Selective Parsing) ---
        const hostParam = targetUrl.match(/[?&]host=([^&]+)/);
        if (hostParam && targetUrl.includes('storm.vodvidl.site')) {
            const edgeHost = decodeURIComponent(hostParam[1]);
            
            // Capture full path including query params (important for IP-signed tokens!)
            // We only want to strip our own helper params (host and headers)
            let rawPath = targetUrl.split('?')[0].replace(/.*\/proxy\//, '/'); 
            let queryParams = targetUrl.split('?')[1] || '';
            
            // Clean out the 'host=' and 'headers=' from the query string
            queryParams = queryParams.split('&')
                .filter(p => !p.startsWith('host=') && !p.startsWith('headers='))
                .join('&');
            
            finalFetchUrl = `${edgeHost}${rawPath}${queryParams ? `?${queryParams}` : ''}`;
            
            // Create the base path for relative fragments
            const pathParts = rawPath.split('/');
            pathParts.pop(); 
            edgeBasePath = `${edgeHost}${pathParts.join('/')}/`;
            
            console.log(`[Sniper] Targeting Media Edge Directly: ${edgeHost}`);
        } else {
            // Standard fetch safely encoded
            try {
                finalFetchUrl = new URL(targetUrl).href;
            } catch(e) {
                finalFetchUrl = encodeURI(targetUrl);
            }
        }

        // Manifests → text (so URLs inside can be rewritten).
        // ALL other requests (video/audio segments, even extensionless CDN URLs) → stream.
        // IMPORTANT: Never fetch binary segments as 'text' — it corrupts binary data.
        // The isM3U8 regex already covers /playlist/ (VixSrc) and all known manifest shapes.
        const activeAxios = isM3U8 ? proxyAxios : gigaAxios;
        const responseType = isM3U8 ? 'text' : 'stream';

        const activeAxiosOptions = {
            headers: fetchHeaders,
            responseType,
            timeout: isM3U8 ? 20000 : 45000,
        };

        let response;
        try {
            response = await activeAxios.get(finalFetchUrl, activeAxiosOptions);
        } catch (proxyErr) {
            // Failover: 407 (Auth), 403 (Forbidden/Blocked), ECONNREFUSED (Dead Proxy), or 503 (Overloaded)
            const status = proxyErr.response?.status;
            if (status === 407 || status === 403 || status === 429 || status === 503 || proxyErr.code === 'ECONNREFUSED' || (proxyErr.message || '').includes('407')) {
                console.warn(`[Proxy Failover] Proxy rejected/failed (${status || proxyErr.code}). Retrying direct...`);
                try {
                    response = await gigaAxios.get(finalFetchUrl, { ...activeAxiosOptions, httpsAgent: undefined });
                } catch (directErr) {
                    throw directErr;
                }
            } else {
                throw proxyErr;
            }
        }

        // Handle 4xx from upstream (not from proxy — proxy errors would throw above)
        if (response.status >= 400) {
            let upstreamHost = 'unknown';
            try { upstreamHost = new URL(finalFetchUrl).hostname; } catch(e) {}
            console.error(`[Upstream Rejected] ${response.status} from ${upstreamHost}`);
            return res.status(response.status).json({ 
                error: `Upstream Rejected`, 
                status: response.status, 
                target: finalFetchUrl.substring(0, 80) 
            });
        }

        const hostMatch = targetUrl.match(/[?&]host=([^&]+)/);
        return handleResponse(response, targetUrl, isM3U8, (hostMatch ? decodeURIComponent(hostMatch[1]) : null), fetchHeaders, res, edgeBasePath, req);

    } catch (e) {
        const status = e.response?.status || 500;
        const msg = e.response?.data?.message || e.message;
        console.error(`[Sniper Fatal] ${status} - ${msg}`);
        res.status(status).json({
            success: false,
            error: msg,
            stack: e.stack,
            message: "Sniper reported an upstream failure. This provider might be temporarily blocked or down."
        });
    }
});

// Helper to handle the manifest/segment response logic
function handleResponse(response, targetUrl, isM3U8, edgeHost, fetchHeaders, res, edgeBasePath = '', req = null) {
    // Secondary M3U8 detection via Content-Type.
    // This only activates when isM3U8=true (response.data is text).
    // When isM3U8=false, response.data is a binary stream — don't inspect it.
    const contentType = response.headers?.['content-type'] || '';
    const isActuallyM3U8 = isM3U8
        || (typeof response.data === 'string' && (
            /mpegurl/i.test(contentType)
            || /m3u8/i.test(contentType)
            || response.data.trimStart().startsWith('#EXTM3U')
        ));

    if (isActuallyM3U8) {
        let manifestContent = response.data;
        const currentUrl = new URL(targetUrl);
        const baseUrl = currentUrl.origin + currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1);

        // --- NEW: ROBUST MANIFEST REWRITER ---
        const reqProto = (req?.headers?.['x-forwarded-proto']) || 'https';
        const reqHost = req?.get?.('host') || 'ibrahimar397-pstream-giga.hf.space';
        const rewritten = manifestContent.replace(/^(?!#)(\S+)/gm, (match) => {
            let absoluteUrl;
            try {
                if (match.startsWith('http')) {
                    absoluteUrl = match;
                } else if (match.startsWith('/')) {
                    absoluteUrl = currentUrl.origin + match;
                } else {
                    absoluteUrl = baseUrl + match;
                }

                // Rewrite to correct /proxy/stream?url=... route
                const headersParam = encodeURIComponent(JSON.stringify(fetchHeaders));
                return `${reqProto}://${reqHost}/proxy/stream?url=${encodeURIComponent(absoluteUrl)}&headers=${headersParam}`;
            } catch (e) {
                return match;
            }
        });

        // Also handle #EXT-X-KEY (encryption keys) which are often missed by simple line replacement
        const finalRewritten = rewritten.replace(/URI="(?!data:)([^"]+)"/g, (match, uri) => {
            try {
                let absoluteUri;
                if (uri.startsWith('http')) {
                    absoluteUri = uri;
                } else if (uri.startsWith('/')) {
                    absoluteUri = currentUrl.origin + uri;
                } else {
                    absoluteUri = baseUrl + uri;
                }
                const headersParam = encodeURIComponent(JSON.stringify(fetchHeaders));
                return `URI="/proxy/stream?url=${encodeURIComponent(absoluteUri)}&headers=${headersParam}"`;
            } catch (e) {
                return match;
            }
        });

        // ── ENGLISH AUDIO FILTER ──────────────────────────────────────────────
        // For master manifests (contain EXT-X-STREAM-INF), strip non-English
        // EXT-X-MEDIA audio entries so HLS.js only sees the English track.
        // This stops VixSrc (and similar providers) from defaulting to Italian/Spanish.
        const isMasterManifest = finalRewritten.includes('#EXT-X-STREAM-INF');
        let filteredManifest = finalRewritten;

        if (isMasterManifest) {
            const lines = finalRewritten.split('\n');
            const outputLines = [];

            // Collect all audio language codes that exist
            const audioLangCodes = [];
            for (const line of lines) {
                if (line.startsWith('#EXT-X-MEDIA') && line.includes('TYPE=AUDIO')) {
                    const langMatch = line.match(/LANGUAGE="([^"]+)"/i);
                    if (langMatch) audioLangCodes.push(langMatch[1].toLowerCase());
                }
            }

            // Determine which languages to keep — prefer English, fall back to all
            const hasEnglish = audioLangCodes.some(l => l.startsWith('en'));
            const allowedLangs = hasEnglish
                ? audioLangCodes.filter(l => l.startsWith('en'))
                : audioLangCodes; // no English found → keep all

            let skipNextUri = false;
            for (const line of lines) {
                const trimmed = line.trim();

                // EXT-X-MEDIA audio line — check LANGUAGE attribute
                if (trimmed.startsWith('#EXT-X-MEDIA') && trimmed.includes('TYPE=AUDIO')) {
                    const langMatch = trimmed.match(/LANGUAGE="([^"]+)"/i);
                    const lang = langMatch ? langMatch[1].toLowerCase() : 'en';
                    if (!allowedLangs.some(al => lang.startsWith(al))) {
                        // Drop non-English audio group — also need to fix AUDIO= refs in EXT-X-STREAM-INF
                        continue;
                    }
                }

                outputLines.push(line);
            }

            filteredManifest = outputLines.join('\n');

            if (hasEnglish) {
                console.log(`[Manifest] Filtered audio tracks to English only. Dropped: ${audioLangCodes.filter(l => !l.startsWith('en')).join(', ')}`);
            }
        }

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(filteredManifest);
    } else {
        // Binary segment stream (responseType was 'stream') or fallback text
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        // response.data is a stream when responseType='stream', a string/buffer otherwise
        if (response.data && typeof response.data.pipe === 'function') {
            return response.data.pipe(res);
        } else {
            return res.send(response.data);
        }
    }
}


// Legacy routes for temporary backward compatibility
app.get('/proxy/m3u8', (req, res) => res.redirect(301, `/proxy/stream?${new URL(req.url, 'http://x').search}`));
app.get('/proxy/video', (req, res) => res.redirect(301, `/proxy/stream?${new URL(req.url, 'http://x').search}`));
app.get('/proxy/subtitles/opensubtitles', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'No URL provided' });
    try {
        const response = await gigaAxios.get(url, {
            headers: {
                'X-User-Agent': req.headers['x-user-agent'] || 'VLSub 0.10.2',
                'User-Agent': getRandomUA(),
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        res.json(response.data);
    } catch (e) {
        console.warn(`[OpenSubtitles Proxy] ${e.response?.status || e.message}`);
        res.json([]); // Return empty array so frontend doesn't break
    }
});

// --- INTRO & SUBTITLE PROXIES ---
// IntroDB 403 fix: the public API now requires an Origin header to match their CORS policy.
// We forward as if coming from the browser.
app.get('/api/introdb/media', async (req, res) => {
    const { tmdb_id, season, episode } = req.query;
    try {
        const url = `https://api.theintrodb.org/v2/media?tmdb_id=${tmdb_id}${season ? `&season=${season}` : ''}${episode ? `&episode=${episode}` : ''}`;
        const response = await gigaAxios.get(url, {
            headers: {
                'Origin': 'https://pstream.watch',
                'Referer': 'https://pstream.watch/',
                'Accept': 'application/json'
            },
            timeout: 8000
        });
        res.json(response.data);
    } catch (e) {
        console.warn(`[IntroDB Media] ${e.response?.status || e.message} - returning empty`);
        res.json({ segments: [] }); // Return empty instead of 500 so frontend doesn't crash
    }
});

app.get('/api/introdb/subtitles', async (req, res) => {
    const { tmdb_id, type, season, episode } = req.query;
    try {
        const url = `https://api.theintrodb.org/api/subtitles?tmdb_id=${tmdb_id}&type=${type}${season ? `&season=${season}` : ''}${episode ? `&episode=${episode}` : ''}`;
        const response = await gigaAxios.get(url, {
            headers: {
                'Origin': 'https://pstream.watch',
                'Referer': 'https://pstream.watch/',
                'Accept': 'application/json'
            },
            timeout: 8000
        });
        res.json(response.data);
    } catch (e) {
        console.warn(`[IntroDB Subtitles] ${e.response?.status || e.message} - returning empty`);
        res.json({ subtitles: [] }); // Return empty instead of 500
    }
});

// --- GIGA API ENDPOINTS ---

// Progress stub — returns empty array so MovieCard doesn't flood the console with 404s
// (Full watch-progress persistence is handled client-side via localStorage)
app.get('/api/profiles/:profileId/progress/:movieId', (req, res) => {
    res.json([]);
});

app.get('/api/stream', async (req, res) => {
    const { tmdbId, type, season, episode, imdbId, title, year } = req.query;
    if (!tmdbId || !type) return res.status(400).json({ success: false, error: 'tmdbId and type are required' });
    try {
        const streamData = await resolveStreaming(tmdbId, type, season, episode, title, year);

        // If a source has a pre-fetched manifest (VidLink IP-signed token fix),
        // rewrite its relative/absolute segment URLs to go through our proxy,
        // then embed result as directManifest so the frontend can Blob URL it
        if (streamData?.sources) {
            const reqProto = req.headers['x-forwarded-proto'] || 'https';
            const baseProxyUrl = `${reqProto}://${req.get('host')}`;

            streamData.sources = streamData.sources.map(source => {
                if (!source.cachedManifest) return source;

                const baseUrl = source.manifestBaseUrl || source.url;
                const referer = source.referer || '';

                const rewritten = rewriteFullProxyManifest(source.cachedManifest, baseUrl, reqProto, req.get('host'), referer);

                return { ...source, directManifest: rewritten, cachedManifest: undefined };
            });
        }

        res.json(streamData);
    } catch (e) {
        console.error(`[API Stream Error] ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- AUTH SYSTEM (Challenge/Sync) ---

app.get('/api/auth/challenge', async (req, res) => {
    const { publicKey } = req.query;
    if (!publicKey) return res.status(400).json({ error: 'Public key required' });
    // Rate limit: 10 challenges per minute per IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    if (rateLimit(`challenge:${ip}`, 10, 60000)) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
    try {
        const challenge = await createChallenge(publicKey);
        res.json({ challenge });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
    const { publicKey, signature, challenge, displayName, isSignUp } = req.body;
    // Rate limit: 5 verify attempts per minute per IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    if (rateLimit(`verify:${ip}`, 5, 60000)) {
        return res.status(429).json({ error: 'Too many verification attempts. Please wait a minute.' });
    }
    try {
        const isValid = await verifyChallenge(publicKey, signature, challenge);
        if (isValid) {
            let profile = await getProfile(publicKey);
            if (!profile) {
                if (isSignUp) {
                    // New account: create the profile row with their chosen display_name
                    profile = await updateProfile(publicKey, { display_name: displayName || 'Guest' });
                } else {
                    return res.status(404).json({ error: 'Account not found. Please create an account or check your recovery phrase.' });
                }
            } else if (isSignUp && displayName) {
                // Returning to a pre-existing account via signup flow — still update the name
                profile = await updateProfile(publicKey, { display_name: displayName });
            }
            const token = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ success: true, token, profile });
        } else {
            res.status(401).json({ error: 'Signature verification failed' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.get('/api/sync', authenticateToken, async (req, res) => {
    try { res.json(await getProfile(req.user.publicKey)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync', authenticateToken, async (req, res) => {
    try { 
        res.json({ success: true, profile: await updateProfile(req.user.publicKey, req.body.updates) }); 
    } catch (e) { 
        console.error('[Sync] Error:', e.message);
        res.status(500).json({ error: `Sync failed: ${e.message}` }); 
    }
});

app.delete('/api/sync', authenticateToken, async (req, res) => {
    try { await deleteProfile(req.user.publicKey); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── Provider Health Reporting (self-healing error loop) ───────────────────────
// Frontend calls this when HLS.js fires a fatal error on a stream
app.post('/api/stream/report-error', async (req, res) => {
    try {
        const { provider, tmdbId, type, error, errorCode } = req.body;
        if (!provider) return res.status(400).json({ error: 'Missing provider' });
        await recordProviderError(provider, { tmdbId, type, error, errorCode });
        console.log(`[HealthReport] Error reported for ${provider}: ${error || errorCode}`);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false }); // Non-critical, always return 200-ish
    }
});

// Frontend calls this when a stream plays successfully (positive signal)
app.post('/api/stream/report-success', async (req, res) => {
    try {
        const { provider } = req.body;
        if (provider) await recordProviderSuccess(provider);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

// Admin: view all provider health scores
app.get('/api/providers/health', async (req, res) => {
    try {
        const health = await getAllProviderHealth();
        res.json({ success: true, providers: health, ts: Date.now() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`[Engine] Online on port ${PORT}`);
});
