import { gigaAxios } from '../utils/http.js';

const baseApiUrl = 'https://primesrc.me/api/v1/';

export async function scrapePrimeSrc(tmdbId, type, season, episode) {
  try {
    let url;
    if (type === 'movie') {
      url = `${baseApiUrl}s?tmdb=${tmdbId}&type=movie`;
    } else {
      url = `${baseApiUrl}s?tmdb=${tmdbId}&season=${season}&episode=${episode}&type=tv`;
    }

    const { data } = await gigaAxios.get(url, { timeout: 10000 });

    if (!data.servers || !Array.isArray(data.servers)) {
      return null;
    }

    const nameToEmbedId = {
      Filelions: 'filelions',
      Dood: 'dood',
      Streamwish: 'streamwish',
      Filemoon: 'filemoon',
    };

    const results = [];
    for (const server of data.servers) {
      if (!server.name || !server.key) continue;

      try {
        const { data: linkJson } = await gigaAxios.get(`${baseApiUrl}l?key=${server.key}`, { timeout: 5000 });
        if (linkJson.link) {
          results.push({
            url: linkJson.link,
            provider: `PrimeSrc (${server.name})`,
            quality: 'auto',
            isEmbed: true
          });
        }
      } catch (e) {
        continue;
      }
    }

    if (results.length === 0) return null;

    return {
      success: true,
      provider: 'PrimeSrc 🔥',
      sources: results
    };
  } catch (e) {
    console.error('[PrimeSrc] Error:', e.message);
    return null;
  }
}
