import { gigaAxios } from '../utils/http.js';

const streamboxBase = 'https://vidjoy.pro/embed/api/fastfetch';

export async function scrapeStreamBox(tmdbId, type, season, episode) {
  try {
    const url = type === 'movie'
      ? `${streamboxBase}/${tmdbId}?sr=0`
      : `${streamboxBase}/${tmdbId}/${season}/${episode}?sr=0`;

    const { data } = await gigaAxios.get(url, { timeout: 10000 });

    if (!data || !data.url || !Array.isArray(data.url)) {
      return null;
    }

    const streams = [];
    const captions = (data.tracks || []).map((track) => ({
      id: track.lang,
      url: track.url,
      language: track.code,
      type: 'srt',
    }));

    if (data.provider === 'MovieBox') {
      data.url.forEach((stream) => {
        streams.push({
          url: stream.link,
          quality: stream.resulation || 'auto',
          isM3U8: false, // MP4 files usually
          provider: `StreamBox (MovieBox)`,
          headers: {
            Referer: data.headers?.Referer || 'https://vidjoy.pro/',
          }
        });
      });
    } else {
        const hlsStream = data.url.find((stream) => stream.type === 'hls') || data.url[0];
        streams.push({
          url: hlsStream.link,
          quality: 'auto',
          isM3U8: true,
          provider: `StreamBox (HLS)`,
          headers: {
            Referer: data.headers?.Referer || 'https://vidjoy.pro/',
          }
        });
    }

    if (streams.length === 0) return null;

    return {
      success: true,
      provider: 'StreamBox 📦',
      sources: streams,
      subtitles: captions
    };
  } catch (e) {
    console.error('[StreamBox] Error:', e.message);
    return null;
  }
}
