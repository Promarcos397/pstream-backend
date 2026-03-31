import axios from 'axios';
import crypto from 'crypto';

const baseUrl = 'https://second.vidnest.fun';
const PASSPHRASE = 'A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6pOKFaE3vTnPZsRuYdVmLq2';

async function decryptVidnestData(encryptedBase64) {
    try {
        const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
        const iv = encryptedBuffer.subarray(0, 12);
        const ciphertext = encryptedBuffer.subarray(12, encryptedBuffer.length - 16);
        const authTag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
        const key = Buffer.from(PASSPHRASE, 'base64').subarray(0, 32);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

export async function scrapeVidNest(tmdbId, type, season, episode) {
    try {
        // HollyMovieHD server
        const endpoint = type === 'movie' 
            ? `${baseUrl}/hollymoviehd/movie/${tmdbId}` 
            : `${baseUrl}/hollymoviehd/tv/${tmdbId}/${season}/${episode}`;

        const { data: res } = await axios.get(endpoint, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
        });

        if (!res?.data) return null;

        const decrypted = await decryptVidnestData(res.data);
        const sources = decrypted.sources || decrypted.streams || [];
        if (!sources.length) return null;

        const url = sources[0].file || sources[0].url;
        
        return {
            success: true,
            provider: 'VidNest 🦅 (Direct)',
            sources: [{
                url: url,
                quality: 'auto',
                isM3U8: true,
                headers: {
                    'Origin': 'https://flashstream.cc',
                    'Referer': 'https://flashstream.cc/'
                }
            }]
        };
    } catch (e) {
        return null;
    }
}
