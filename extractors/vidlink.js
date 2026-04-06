import axios from 'axios';

export async function scrapeVidLink(tmdbId, type, season, episode) {
    try {
        // --- NEW VIDLINK LOGIC (Aether/P-Stream standard) ---
        console.log(`[VidLink] 🔐 Requesting encryption for ${tmdbId}...`);
        const encResponse = await axios.get(`https://enc-dec.app/api/enc-vidlink?id=${tmdbId}`);
        if (!encResponse.data?.id) throw new Error('Encryption failed');
        
        const encryptedId = encResponse.data.id;
        let apiUrl = `https://vidlink.pro/api/b/${type}/${encryptedId}`;
        if (type === 'tv') {
            apiUrl += `/${season}/${episode}`;
        }

        console.log(`[VidLink] 🚀 Fetching stream: ${apiUrl}`);
        
        const response = await axios.get(apiUrl, {
            headers: {
                'Referer': 'https://vidlink.pro/',
                'Origin': 'https://vidlink.pro',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (response.data?.stream?.playlist) {
            return {
                success: true,
                provider: 'VidLink',
                sources: [
                    {
                        url: response.data.stream.playlist,
                        isM3U8: true,
                        quality: 'Auto',
                        referer: 'https://vidlink.pro/'
                    }
                ],
                subtitles: response.data.stream.captions?.map(c => ({
                    url: c.url,
                    lang: c.language,
                    label: c.language
                })) || []
            };
        }

        return { success: false, error: 'No stream found' };
    } catch (e) {
        console.error(`[VidLink Error] ${e.message}`);
        return { success: false, error: e.message };
    }
}
