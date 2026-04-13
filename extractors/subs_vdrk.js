import { proxyAxios } from '../utils/http.js';

export async function scrapeVdrkCaptions(tmdbId, type, season, episode) {
    try {
        const url = type === 'tv' && season && episode
            ? `https://sub.vdrk.site/v1/tv/${tmdbId}/${season}/${episode}`
            : `https://sub.vdrk.site/v1/movie/${tmdbId}`;

        console.log(`[VDRK] Searching external subtitles: ${url}`);
        
        const response = await proxyAxios.get(url, { timeout: 8000 });
        const data = response.data;

        if (!Array.isArray(data)) {
            console.log("[VDRK] Invalid VDRK response format");
            return [];
        }

        const vdrkCaptions = [];

        for (const subtitle of data) {
            if (subtitle.file && subtitle.label) {
                const label = subtitle.label;
                const isHearingImpaired = label.includes(" Hi") || label.includes("Hi");
                const languageName = label
                    .replace(/\s*Hi\d*$/, "")
                    .replace(/\s*Hi$/, "")
                    .replace(/\d+$/, "")
                    .trim();

                // Simple language mapping for VDRK. A full mapper like ISO6391 might be better, 
                // but we can map the display name directly on frontend.
                const language = languageName || "English"; 

                vdrkCaptions.push({
                    url: subtitle.file,
                    label: subtitle.label,
                    lang: language.toLowerCase().substring(0, 2),
                    vdrk: true,
                    isHearingImpaired
                });
            }
        }

        console.log(`[VDRK] ✅ Found ${vdrkCaptions.length} external subtitles`);
        return vdrkCaptions;
    } catch (error) {
        console.error(`[VDRK] Error fetching VDRK subtitles: ${error.message}`);
        return [];
    }
}
