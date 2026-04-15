/**
 * P-Stream Extractor Validation Suite v12.0
 * Run: node test.js
 * Tests all extractors individually and the full resolver.
 */
import { resolveStreaming } from './resolver.js';
import { scrapeMoviesApi } from './extractors/moviesapi.js';
import { scrapeVidSrcXyz } from './extractors/vidsrcxyz.js';
import { scrapeSuperEmbed } from './extractors/superembed.js';
import { scrapeVixSrc } from './extractors/vixsrc.js';
import { extractVaPlayer } from './extractors/vaplayer.js';
import { scrapeVidSrc as scrapeVidSrcRu } from './extractors/vidsrcru.js';

const TEST_MOVIE_TMDB = '27205';  // Inception
const TEST_TV_TMDB = '1396';      // Breaking Bad
const TEST_SEASON = 1;
const TEST_EPISODE = 1;

async function testExtractor(name, fn) {
    console.log(`\n[TEST] ${name}...`);
    const start = Date.now();
    try {
        const result = await fn();
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (result?.success && result.sources?.length) {
            console.log(`  ✅ SUCCESS in ${elapsed}s — Provider: ${result.provider}`);
            console.log(`  📺 Sources: ${result.sources.length}, Subtitles: ${(result.subtitles || []).length}`);
            const s = result.sources[0];
            console.log(`  🔗 URL: ${s.url.substring(0, 80)}... ${s.noProxy ? '[noProxy]' : '[proxied]'}`);
        } else {
            console.log(`  ❌ FAILED in ${elapsed}s — No sources returned`);
        }
        return result;
    } catch (e) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  ❌ ERROR in ${elapsed}s — ${e.message}`);
        return null;
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log('  P-Stream Extractor Validation Suite v12.0');
    console.log('═'.repeat(60));

    // ── Unit tests: individual extractors ────────────────────────────────────
    await testExtractor('VixSrc (Movie)', () => scrapeVixSrc(TEST_MOVIE_TMDB, 'movie'));
    await testExtractor('VixSrc (TV)', () => scrapeVixSrc(TEST_TV_TMDB, 'tv', TEST_SEASON, TEST_EPISODE));
    await testExtractor('VaPlayer (Movie)', () => extractVaPlayer({ tmdbId: TEST_MOVIE_TMDB, type: 'movie' }));
    await testExtractor('VaPlayer (TV)', () => extractVaPlayer({ tmdbId: TEST_TV_TMDB, type: 'tv', season: TEST_SEASON, episode: TEST_EPISODE }));
    await testExtractor('VidSrc.ru (Movie)', () => scrapeVidSrcRu(TEST_MOVIE_TMDB, 'movie'));
    await testExtractor('VidSrc.xyz (Movie)', () => scrapeVidSrcXyz(TEST_MOVIE_TMDB, 'movie'));
    await testExtractor('MoviesAPI (Movie)', () => scrapeMoviesApi(TEST_MOVIE_TMDB, 'movie'));
    await testExtractor('SuperEmbed (Movie)', () => scrapeSuperEmbed(TEST_MOVIE_TMDB, 'movie'));

    // ── Full resolver tests ───────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('  Full Resolver Test (Inception)');
    console.log('═'.repeat(60));
    await testExtractor('Full Resolver - Movie', () => resolveStreaming(TEST_MOVIE_TMDB, 'movie', 1, 1, 'Inception', 2010));

    console.log('\n' + '═'.repeat(60));
    console.log('  Full Resolver Test (Breaking Bad S1E1)');
    console.log('═'.repeat(60));
    await testExtractor('Full Resolver - TV', () => resolveStreaming(TEST_TV_TMDB, 'tv', TEST_SEASON, TEST_EPISODE, 'Breaking Bad', 2008));

    console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
