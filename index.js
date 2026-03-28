import express from 'express';
import cors from 'cors'; // Giga v1.0.1
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

// --- GIGA PROXY (CORS & REFERER BYPASS) ---

/**
 * 1. Standard Proxy (destination style)
 * Used by: Chromecast, General scrapers
 * Route: /?destination=URL
 */
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
        // Map custom X- headers back to standard headers
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
        
        // Map Set-Cookie back to X-Set-Cookie for frontend access
        if (proxyRes.headers['set-cookie']) {
            proxyRes.headers['x-set-cookie'] = proxyRes.headers['set-cookie'];
        }

        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['x-content-type-options'];
    }
}));

/**
 * 2. M3U8 Proxy (HLS style)
 * Used by: Airplay, HLS.js
 * Route: /m3u8-proxy?url=URL&headers=JSON
 */
app.get('/m3u8-proxy', async (req, res) => {
    const { url, headers: headersJson } = req.query;
    if (!url) return res.status(400).send('URL required');

    try {
        let headers = {};
        if (headersJson) {
            headers = JSON.parse(decodeURIComponent(headersJson));
        }

        const response = await axios.get(url, {
            headers: {
                ...headers,
                'User-Agent': headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            responseType: 'text'
        });

        // Rewrite relative paths in M3U8 for better provider compatibility
        let body = response.data.split('\n').map(line => {
            if (line.trim() === '' || line.startsWith('#')) return line;
            if (line.startsWith('http')) return line;
            // Handle relative paths by converting to absolute based on the original source
            try { return new URL(line, url).href; } catch (e) { return line; }
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(body);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// --- GIGA RESOLVER (MULTI-PROVIDER) ---

app.get('/api/stream', async (req, res) => {
    const { tmdbId, type, season, episode } = req.query;
    console.log(`[GigaEngine] Stream requested: ${tmdbId} (${type}) S${season}E${episode}`);

    if (!tmdbId || !type) {
        return res.status(400).json({ success: false, error: 'tmdbId and type are required' });
    }

    try {
        const { imdbId } = req.query;
        const streamData = await resolveStream(tmdbId, type, season, episode, imdbId);
        
        // Final fallback logic was integrated inside resolveStream, 
        // if even that failed, streamData.success will be false. 
        // We always return the response now so the frontend can read the fallback result.
        res.json(streamData);
    } catch (e) {
        console.error('[GigaEngine] Resolution error:', e);
        res.status(500).json({ success: false, error: e.message || 'Internal Stream Resolution Error' });
    }
});

// Fast prediction endpoint for the frontend
app.get('/api/predict_stream', async (req, res) => {
    const { tmdbId, type, season, episode, imdbId } = req.query;
    
    if (!tmdbId || !type) {
        return res.status(400).json({ success: false, error: 'tmdbId and type are required' });
    }

    try {
        const fallbackId = imdbId && String(imdbId).trim() !== '' ? imdbId : tmdbId;
        const isImdb = String(fallbackId).startsWith('tt');
        const paramName = isImdb ? 'imdb' : 'tmdb';

        const fallbackUrl = type === 'tv'
            ? `https://vidsrc-embed.su/embed/tv?${paramName}=${fallbackId}&season=${season || 1}&episode=${episode || 1}&ds_lang=en&autoplay=1&autonext=1`
            : `https://vidsrc-embed.su/embed/movie?${paramName}=${fallbackId}&ds_lang=en&autoplay=1`;

        // Check if the URL returns a 200
        const response = await axios.head(fallbackUrl, {
            timeout: 2000, // Very fast timeout
            validateStatus: () => true // Allow any status code
        });
        
        // If it's a 200 or 302, it likely works. If it's 404, it definitively failed.
        if (response.status === 200 || response.status === 302) {
             return res.json({ available: true, url: fallbackUrl });
        } else {
             return res.json({ available: false, status: response.status });
        }
        
    } catch (error) {
         return res.json({ available: false, error: error.message });
    }
});

// --- AUTH & SYNC (Supabase) ---

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
    if (!publicKey || !signature || !challenge) return res.status(400).json({ error: 'Missing data' });

    try {
        const isValid = await verifyChallenge(publicKey, signature, challenge);
        if (isValid) {
            let profile = await getProfile(publicKey);
            if (!profile) {
                profile = await updateProfile(publicKey, { display_name: displayName || 'Guest' });
            }

            const token = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ success: true, token, profile });
        } else {
            res.status(401).json({ error: 'Invalid signature' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
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

// --- SYSTEM ---
app.get('/healthcheck', (req, res) => res.status(200).send('Giga Backend Online'));
app.get('/api/meta', (req, res) => res.json({
    engine: 'P-Stream Giga (v1.0.0)',
    hosting: 'Hugging Face Spaces',
    features: ['Multi-Provider Resolver', 'GigaProxy', 'Supabase Sync']
}));

app.listen(PORT, () => {
    console.log(`[GigaServer] P-Stream Giga Backend running on port ${PORT}`);
});
