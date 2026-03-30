import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createChallenge, verifyChallenge } from './utils/challenge.js';
import { getProfile, updateProfile, deleteProfile } from './utils/db.js';
import { resolveStream } from './resolver.js';
import Redis from 'ioredis';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7860;

// --- REDIS (UPSTASH) ---
let redis = null;
if (process.env.REDIS_URL) {
    try {
        redis = new Redis(process.env.REDIS_URL);
        console.log('[GigaBackend] Redis connected (Upstash)');
    } catch (e) {
        console.error('[GigaBackend] Redis connection failed:', e.message);
    }
}
export { redis };

const JWT_SECRET = process.env.JWT_SECRET || 'p-stream-secret-change-me';

app.use(cors());
app.use(express.json());

// --- GIGA HOME PAGE (Visual Identity) ---

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>P-Stream Giga Engine</title>
        <style>
            body { 
                background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%); 
                color: #fff; font-family: 'Inter', system-ui, -apple-system, sans-serif; 
                display: flex; flex-direction: column; align-items: center; justify-content: center; 
                height: 100vh; margin: 0; text-align: center; overflow: hidden;
            }
            .container { animation: fadeIn 1.2s ease-out; }
            h1 { font-size: 3rem; margin-bottom: 0.5rem; background: linear-gradient(to right, #E50914, #ff5f6d); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            p { font-size: 1.2rem; color: #aaa; margin-bottom: 2rem; }
            .badge { background: rgba(229, 9, 20, 0.2); border: 1px solid #E50914; color: #E50914; padding: 0.4rem 1rem; border-radius: 50px; font-size: 0.9rem; font-weight: bold; }
            .stats { margin-top: 3rem; display: flex; gap: 2rem; }
            .stat-item { background: rgba(255, 255, 255, 0.05); padding: 1.5rem; border-radius: 12px; min-width: 150px; border: 1px solid rgba(255, 255, 255, 0.1); }
            .stat-value { font-size: 1.5rem; font-weight: bold; display: block; }
            .stat-label { color: #666; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="container">
            <span class="badge">ENGINE ONLINE</span>
            <h1>P-STREAM GIGA</h1>
            <p>High-performance movie streaming & meta-engine.</p>
            <div class="stats">
                <div class="stat-item">
                    <span class="stat-value">v2.5.0</span>
                    <span class="stat-label">Version</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${redis ? '✓ UP' : '× DOWN'}</span>
                    <span class="stat-label">Redis Cache</span>
                </div>
                <div class="stat-item">
                    <a href="/healthcheck" style="text-decoration: none; color: inherit;">
                        <span class="stat-value">✓ LIVE</span>
                        <span class="stat-label">Check Status</span>
                    </a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
});

// --- GIGA PROXY (CORS & REFERER BYPASS) ---

app.use('/proxy', createProxyMiddleware({
    router: (req) => {
        const url = req.query.destination || req.query.url;
        if (!url) return null;
        try { return new URL(url).origin; } catch (e) { return null; }
    },
    pathRewrite: (path, req) => {
        const urlStr = req.query.destination || req.query.url;
        if (!urlStr) return path;
        const url = new URL(urlStr);
        return url.pathname + url.search;
    },
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
        const targetUrl = req.query.destination || req.query.url;
        if (!targetUrl) return;
        const referer = req.headers['x-referer'] || req.query.referer || targetUrl;
        const cookie = req.headers['x-cookie'] || req.query.cookie;
        const userAgent = req.headers['x-user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

        proxyReq.setHeader('User-Agent', userAgent);
        proxyReq.setHeader('Referer', referer);
        proxyReq.setHeader('Origin', new URL(referer).origin);
        if (cookie) proxyReq.setHeader('Cookie', cookie);
    },
    onProxyRes: (proxyRes) => {
        proxyRes.headers['access-control-allow-origin'] = '*';
        proxyRes.headers['access-control-allow-methods'] = 'GET, OPTIONS, POST';
        proxyRes.headers['access-control-allow-headers'] = '*';
        if (proxyRes.headers['set-cookie']) proxyRes.headers['x-set-cookie'] = proxyRes.headers['set-cookie'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['x-content-type-options'];
    }
}));

// --- GIGA API ENDPOINTS ---

app.get('/api/stream', async (req, res) => {
    const { tmdbId, type, season, episode, imdbId } = req.query;
    if (!tmdbId || !type) return res.status(400).json({ success: false, error: 'tmdbId and type are required' });

    try {
        const streamData = await resolveStream(tmdbId, type, season, episode, imdbId);
        res.json(streamData);
    } catch (e) {
        console.error('[GigaEngine] Stream Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- AUTH SYSTEM ---

app.get('/api/auth/challenge', async (req, res) => {
    const { publicKey } = req.query;
    if (!publicKey) return res.status(400).json({ error: 'Public key required' });
    try {
        const challenge = await createChallenge(publicKey);
        res.json({ challenge });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/verify', async (req, res) => {
    const { publicKey, signature, challenge, displayName } = req.body;
    if (!publicKey || !signature || !challenge) return res.status(400).json({ error: 'Missing handshake data' });

    try {
        const isValid = await verifyChallenge(publicKey, signature, challenge);
        if (isValid) {
            let profile = await getProfile(publicKey);
            if (!profile) profile = await updateProfile(publicKey, { display_name: displayName || 'Guest' });

            const token = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ success: true, token, profile });
        }
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
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
    try {
        const profile = await getProfile(req.user.publicKey);
        res.json(profile);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/sync', authenticateToken, async (req, res) => {
    try {
        const profile = await updateProfile(req.user.publicKey, req.body.updates);
        res.json({ success: true, profile });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sync', authenticateToken, async (req, res) => {
    try {
        await deleteProfile(req.user.publicKey);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- SYSTEM ---
app.get('/healthcheck', (req, res) => {
    res.status(200).json({
        status: 'online',
        redis: !!redis,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.listen(PORT, () => {
    console.log(`[GigaServer] P-Stream Giga Backend running on port ${PORT}`);
});
