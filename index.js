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
import { resolveStream, USER_AGENTS } from './resolver.js';
import Redis from 'ioredis';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { wrapper as axiosCookieJarWrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

dotenv.config();

const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

// Persistent cookie jar — stores Cloudflare cf_clearance and other session cookies
// per CDN domain so "Please enable cookies" challenge stops recurring
const cdnCookieJar = new CookieJar();
const cookieAwareAxios = axiosCookieJarWrapper(axios.create({
    jar: cdnCookieJar,
    withCredentials: true,
    httpsAgent: proxyAgent,
    proxy: false,
}));

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

const JWT_SECRET = process.env.JWT_SECRET || 'p-stream-secret-token-key-v1';

app.use(cors());
app.use(express.json());
app.use('/assets', express.static('assets'));

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
        <title>P-Stream Engine</title>
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
            <a href="https://pstream-frontend.pages.dev"><img src="${LOGO}" alt="P-Stream" class="logo" /></a>
            
            <h1 class="hero-text">Unlimited power, series and more</h1>
            <p class="sub-text">P-Stream Engine v5.0.0 is ready. Launch the hub to explore your collection or check system health below.</p>
            
            <div>
                <a href="https://pstream-frontend.pages.dev" class="main-btn">
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
            <title>P-Stream Diagnostics</title>
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
                <a href="/"><img src="${LOGO}" alt="P-Stream" class="logo" /></a>
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

// 1. M3U8 Manifest Rewriter (Intercepts /proxy/m3u8)
// This solves the levelLoadError by preventing HLS.js from making broken relative requests without ?url=
app.get('/proxy/m3u8', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');
    targetUrl = decodeURIComponent(targetUrl);
    
    const referer = req.query.referer || targetUrl;
    const origin = new URL(referer).origin;

    const ua = req.headers['x-user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    // Full browser fingerprint — Cloudflare WAF checks these headers
    const headers = {
        'User-Agent': ua,
        'Referer': referer,
        'Origin': origin,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
    };

    try {
        const response = await cookieAwareAxios.get(targetUrl, { 
            headers,
            responseType: 'text',
            timeout: 8000,
            maxRedirects: 5
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        
        const text = response.data;
        if (!text || typeof text !== 'string') throw new Error('Empty manifest response');
        
        const rewritten = text.split('\n').map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                // Keep tags but potentially rewrite URI="..."
                if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP')) {
                    return trimmed.replace(/URI="(.*?)"/g, (match, p1) => {
                        let absoluteUrl = p1;
                        if (!p1.startsWith('http')) {
                            try { absoluteUrl = new URL(p1, targetUrl).href; } catch (e) { return match; }
                        }
                        const reqHost = req.get('host');
                        const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol;
                        const proxyUrl = `${reqProtocol}://${reqHost}/proxy/video?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
                        return `URI="${proxyUrl}"`;
                    });
                }
                return trimmed;
            }
            
            // Standard segment/playlist URL
            let absoluteUrl = trimmed;
            if (!trimmed.startsWith('http')) {
                try { absoluteUrl = new URL(trimmed, targetUrl).href; } catch (e) { return trimmed; }
            }
            
            const isPlaylist = absoluteUrl.includes('.m3u8') || absoluteUrl.includes('m3u8');
            const proxyPath = isPlaylist ? '/proxy/m3u8' : '/proxy/video';
            const reqHost = req.get('host');
            const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol;
            
            return `${reqProtocol}://${reqHost}${proxyPath}?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
        }).join('\n');
        
        return res.send(rewritten);
    } catch (e) {
        console.error(`[M3U8 Proxy Error] ${targetUrl} | ${e.message}`);
        const status = e.response?.status || 500;
        res.status(status).send(`M3U8 Proxy Error (${status}): ${e.message}`);
    }
});

// 2. Binary Segment Proxy (Handles /proxy/video)
// Uses http-proxy-middleware for robust high-performance binary piping
const videoProxy = createProxyMiddleware({
    router: (req) => {
        try {
            const url = req.query.url;
            return url ? decodeURIComponent(url) : null;
        } catch (e) { return null; }
    },
    changeOrigin: true,
    followRedirects: true,
    pathRewrite: (path, req) => '', // We only need the target from the router
    on: {
        proxyReq: (proxyReq, req, res) => {
            const referer = req.query.referer || (req.query.url ? decodeURIComponent(req.query.url) : 'https://vidsrc.to/');
            const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            
            proxyReq.setHeader('User-Agent', ua);
            proxyReq.setHeader('Referer', referer);
            try { proxyReq.setHeader('Origin', new URL(referer).origin); } catch (_) {}
            proxyReq.setHeader('Accept', '*/*');
            proxyReq.setHeader('Sec-Fetch-Dest', 'empty');
            proxyReq.setHeader('Sec-Fetch-Mode', 'cors');
            proxyReq.setHeader('Sec-Fetch-Site', 'cross-site');
        },
        proxyRes: (proxyRes, req, res) => {
            // Ensure no caching and permissive CORS for the segment
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-cache');
        },
        error: (err, req, res) => {
            console.error('[Video Proxy Error]', req.query.url, err.message);
            res.status(502).send('Video Proxy Error: ' + err.message);
        }
    }
});

app.get('/proxy/video', videoProxy);

// --- GIGA API ENDPOINTS ---

// Progress stub — returns empty array so MovieCard doesn't flood the console with 404s
// (Full watch-progress persistence is handled client-side via localStorage)
app.get('/api/profiles/:profileId/progress/:movieId', (req, res) => {
    res.json([]);
});

app.get('/api/stream', async (req, res) => {
    const { tmdbId, type, season, episode, imdbId } = req.query;
    if (!tmdbId || !type) return res.status(400).json({ success: false, error: 'tmdbId and type are required' });
    try {
        const streamData = await resolveStream(tmdbId, type, season, episode, imdbId);
        res.json(streamData);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- AUTH SYSTEM (Challenge/Sync) ---

app.get('/api/auth/challenge', async (req, res) => {
    const { publicKey } = req.query;
    if (!publicKey) return res.status(400).json({ error: 'Public key required' });
    try {
        const challenge = await createChallenge(publicKey);
        res.json({ challenge });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
    const { publicKey, signature, challenge, displayName, isSignUp } = req.body;
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

app.listen(PORT, () => {
    console.log(`[Engine] Online on port ${PORT}`);
});
