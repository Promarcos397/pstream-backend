/**
 * P-Stream Giga Engine Resolver v17.0.0
 * "Full Diagnostics + Hardened Race"
 *
 * ══ PROVIDER STATUS (2026-04-29) ═══════════════════════════════════════════
 *
 * ✅ VaPlayer  (streamdata.vaplayer.ru) — 4 mirrors, clean JSON API.      ~2.4s
 * ✅ VidZee    (player.vidzee.wtf)      — 3-5 sources, AES-GCM/CBC.       ~8s
 *                                         CDN blocks HF IPs → noProxy=true
 * ✅ VidSrc.ru (vsembed.ru)             — 3-hop HTML chain, cloudnestra.  ~7.7s
 *                                         noProxy=true already set.
 * ✅ LookMovie (lmscript.xyz)           — Title-search based, 1 source.   ~7.4s
 *                                         Requires title param from frontend.
 *
 * ⚠️  VidSrc.me (vidsrcme.ru)          — Embed-only fallback. No raw HLS.
 *                                         Used in Stage 3 only.
 *
 * ❌ VixSrc   (vixsrc.to) — DEAD AS OF 2026-04. Actively blocking
 *                           datacenter IPs (Hugging Face) + API automation.
 *                           Returns 403 on all extractor requests.
 *                           REMOVED from race.
 *
 * ══ REMOVED (previously dead, confirmed 2026-04-24) ═══════════════════════
 * ❌ VidSrc.to  — Wraps vsembed.ru (= VidSrc.ru). Redundant.
 * ❌ VidSrc.me  — SPA, JS-only (old domain). Replaced with vidsrcme.ru embed.
 * ❌ VidSrc.xyz — Consistent timeout (12-13s).
 * ❌ VidLink    — HTTP 400 on all requests.
 * ❌ FlixHQ     — HTTP 404 on TMDB path.
 * ❌ 2EmbedSkin — Wraps dead 2embed.cc.
 * ❌ VidBinge   — SPA, JS-only.
 * ❌ VidNest    — 403, blocks HF IPs.
 * ❌ NontonGo   — Connection refused.
 * ❌ RidoMovies — Cloudflare JS challenge.
 * ❌ SuperEmbed — 678KB SPA, no extractable stream.
 * ❌ AutoEmbed  — New Relic JS gate.
 * ❌ MoviesAPI  — SPA, JS-only.
 * ❌ HollyMovieHD — HTTP 404.
 *
 * ══ ARCHITECTURE ══════════════════════════════════════════════════════════
 *
 * Stage 1 (22s timeout):  VaPlayer + VidZee + VidSrc.ru + LookMovie — full parallel race.
 *   - VaPlayer: fastest remaining M3U8 provider (~2-3s).
 *   - VidZee / VidSrc.ru / LookMovie: slower but act as fallbacks.
 *   - After first success, 1.5s grace window collects additional winners.
 *   - All results merged: sources deduplicated, subtitles merged.
 *
 * Stage 2 (embed fallback): VidSrc.me embed — shown as iframe player.
 *   - Only fires if Stage 1 returns zero M3U8 sources.
 *   - Frontend must handle isEmbed=true sources via an <iframe>.
 *
 * Stage 3 (PrimeSrc embed): Last resort. Also embed-only.
 *
 * External subs: vdrk fetched in parallel throughout — never blocks stream.
 *
 * ══ DIAGNOSABILITY ════════════════════════════════════════════════════════
 *
 * Every extractor result now carries:
 *   _elapsedMs     — how long it took
 *   _providerName  — canonical name
 *   _failReason    — human-readable failure reason (on failure)
 *   _status        — 'success' | 'no_sources' | 'error' | 'timeout'
 *
 * The resolver also exports `diagnoseProviders(tmdbId, type, s, e)` which
 * runs all providers individually and returns a full diagnostic report.
 * This powers GET /api/stream/diagnose on the backend.
 */

import { scrapeVidZee }       from './extractors/vidzee.js';
import { scrapeVidSrc as scrapeVidSrcRu } from './extractors/vidsrcru.js';
import { extractVaPlayer }    from './extractors/vaplayer.js';
import { scrapeLookMovie }    from './extractors/lookmovie.js';
import { scrapePrimeSrc }     from './extractors/primesrc.js';
import { scrapeVidSrcMe }     from './extractors/vidsrcme.js';
import { scrapeVdrkCaptions } from './extractors/subs_vdrk.js';
import { filterByHealth }     from './services/providerHealth.js';

// ── Structured extractor result with diagnostics ──────────────────────────────

/**
 * Run a single extractor with a timeout, capturing timing + failure reason.
 * Always resolves (never rejects). Returns a diagnostic-enriched result object.
 *
 * @param {Object} provider - { id, name, run }
 * @param {number} timeoutMs
 * @returns {Promise<Object>} diagnostic result
 */
async function runExtractorDiag(provider, timeoutMs = 18000) {
    const start = Date.now();
    let status = 'error';
    let failReason = null;
    let result = null;

    try {
        const raw = await Promise.race([
            provider.run(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`TIMEOUT_${timeoutMs}ms`)), timeoutMs)
            )
        ]);

        const elapsed = Date.now() - start;

        if (!raw) {
            status = 'no_sources';
            failReason = 'Extractor returned null — provider likely down, blocked, or returned empty data';
        } else if (!raw.success) {
            status = 'no_sources';
            failReason = raw.error || 'success=false with no error message';
        } else if (!raw.sources?.length) {
            status = 'no_sources';
            failReason = 'success=true but sources array is empty';
        } else if (raw.sources.every(s => s.isEmbed)) {
            status = 'embed_only';
            failReason = 'All sources are embed iframes — no raw M3U8 available from this provider';
            result = { ...raw, _elapsedMs: elapsed, _providerName: provider.name, _providerId: provider.id, _status: 'embed_only', _failReason: failReason };
        } else {
            status = 'success';
            result = { ...raw, _elapsedMs: elapsed, _providerName: provider.name, _providerId: provider.id, _status: 'success' };
        }

        return result || {
            success: false,
            provider: provider.name,
            _providerName: provider.name,
            _providerId: provider.id,
            _elapsedMs: elapsed,
            _status: status,
            _failReason: failReason,
        };

    } catch (err) {
        const elapsed = Date.now() - start;
        const isTimeout = /TIMEOUT_/.test(err.message) || err.name === 'TimeoutError';
        status = isTimeout ? 'timeout' : 'error';
        failReason = isTimeout
            ? `Timed out after ${elapsed}ms — provider too slow or unresponsive`
            : `Threw exception: ${err.message}`;

        console.warn(`[Race] ✗ ${provider.name} (${status}): ${failReason}`);

        return {
            success: false,
            provider: provider.name,
            _providerName: provider.name,
            _providerId: provider.id,
            _elapsedMs: elapsed,
            _status: status,
            _failReason: failReason,
        };
    }
}


/**
 * Race multiple extractors. Returns all successful (non-embed) results.
 * After the first success, waits `graceAfterFirstMs` for other fast providers
 * before finalising — so we can merge sources from multiple winners.
 *
 * Diagnostics: logs every provider outcome (success, fail reason, timing).
 */
function collectExtractorResults(extractors, timeoutMs, graceAfterFirstMs = 1500) {
    return new Promise(resolve => {
        let settled = 0;
        const total = extractors.length;
        let resolved = false;
        let firstSuccessSeen = false;
        let graceTimer = null;
        const successes = [];
        const allDiagnostics = [];

        if (total === 0) { resolve([]); return; }

        const finalize = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(masterTimer);
            if (graceTimer) clearTimeout(graceTimer);

            // Summary log
            console.log(`[Race] ── Final summary ────────────────────────────────`);
            for (const d of allDiagnostics) {
                const icon = d._status === 'success' ? '✅' : d._status === 'embed_only' ? '📦' : '❌';
                console.log(`[Race] ${icon} ${d._providerName} → ${d._status}${d._failReason ? ` (${d._failReason})` : ''} [${d._elapsedMs}ms]`);
            }
            if (successes.length === 0) {
                console.warn(`[Race] ❌ ALL providers failed. Check individual failure reasons above.`);
            } else {
                console.log(`[Race] ✅ ${successes.length}/${total} provider(s) succeeded.`);
            }
            console.log(`[Race] ─────────────────────────────────────────────────`);

            resolve(successes);
        };

        const masterTimer = setTimeout(() => {
            console.warn(`[Race] ⏱ Master timeout (${timeoutMs}ms) reached.`);
            finalize();
        }, timeoutMs);

        extractors.forEach((provider, i) => {
            runExtractorDiag(provider, Math.floor(timeoutMs * 0.9)).then(diagResult => {
                if (resolved) return;

                allDiagnostics.push(diagResult);
                settled++;

                if (diagResult._status === 'success') {
                    firstSuccessSeen = true;
                    successes.push(diagResult);
                    console.log(`[Race] ✅ ${diagResult._providerName} in ${diagResult._elapsedMs}ms → ${diagResult.sources?.length} source(s)`);

                    // Start grace window after first success
                    if (!graceTimer) {
                        graceTimer = setTimeout(() => finalize(), graceAfterFirstMs);
                    }
                }

                if (settled === total) {
                    finalize();
                }
            });
        });
    });
}


// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveStreaming(tmdbId, type, season, episode, title, year) {
    console.log(`[Resolver v17] Resolving: ${title || tmdbId} (${type}${type === 'tv' ? ` S${season}E${episode}` : ''})`);

    // External subtitles fetched in parallel throughout — never blocks stream
    const externalSubsPromise = scrapeVdrkCaptions(tmdbId, type, season, episode).catch(() => []);

    const mergeSubtitles = async (result) => {
        if (!result) return result;
        // Cap subtitle wait at 2s — subs are bonus content, never block stream delivery.
        // If VDRK is slow (proxy chain adds 8-12s latency), skip and return stream immediately.
        try {
            const externalSubs = await Promise.race([
                externalSubsPromise,
                new Promise(resolve => setTimeout(() => resolve([]), 2000))
            ]);
            if (externalSubs?.length) {
                result.subtitles = [...(result.subtitles || []), ...externalSubs];
            }
        } catch (_) {}
        return result;
    };

    // ══ Stage 1: Parallel race — all M3U8 providers ════════════════════════
    // VaPlayer (~2-3s) is the fastest remaining reliable provider.
    // VidZee/VidSrc.ru/LookMovie are slower but serve as backup.
    // VixSrc REMOVED — actively blocking datacenter IPs as of 2026-04.
    const providers = [
        { id: 'vaplayer',   name: 'VaPlayer',   run: () => extractVaPlayer({ tmdbId, type, season, episode }) },
        { id: 'vidzee',     name: 'VidZee',     run: () => scrapeVidZee(tmdbId, type, season, episode) },
        { id: 'vidsrc_ru',  name: 'VidSrc.ru',  run: () => scrapeVidSrcRu(tmdbId, type, season, episode) },
        {
            id: 'lookmovie',
            name: 'LookMovie',
            // LookMovie needs title+year from TMDB. If not passed, skip silently rather than
            // wasting a scrape slot on a guaranteed null result.
            run: () => (title
                ? scrapeLookMovie(tmdbId, type === 'movie' ? 'movie' : 'show', season, episode, title, year)
                : Promise.resolve({ success: false, _skipReason: 'title not provided by frontend — LookMovie requires title+year' })
            )
        },
    ];

    const healthyProviders = await filterByHealth(providers);
    const activeProviders = healthyProviders.length ? healthyProviders : providers;

    console.log(`[Resolver] Racing ${activeProviders.length} M3U8 provider(s): ${activeProviders.map(p => `${p.name}${p.HealthScore !== undefined ? ` (health:${p.HealthScore})` : ''}`).join(', ')}`);

    const stage1Results = await collectExtractorResults(activeProviders, 22000, 1500);

    if (stage1Results.length) {
        const sortedByLatency = [...stage1Results].sort((a, b) => (a._elapsedMs || 0) - (b._elapsedMs || 0));
        const winner = sortedByLatency[0];

        const subtitles = [];
        const subtitleSeen = new Set();
        const sourceSeen = new Set();
        const mergedSources = [];

        for (const result of sortedByLatency) {
            for (const src of (result.sources || [])) {
                if (src.isEmbed) continue; // Don't mix embed sources into M3U8 stage
                const key = `${src.url}|${src.quality || 'auto'}`;
                if (sourceSeen.has(key)) continue;
                sourceSeen.add(key);
                mergedSources.push({
                    ...src,
                    provider: src.provider || result.provider || result._providerName || 'unknown',
                    providerId: src.providerId || result._providerId || 'unknown',
                });
            }
            for (const sub of (result.subtitles || [])) {
                const key = `${sub.url}|${sub.lang || ''}`;
                if (subtitleSeen.has(key)) continue;
                subtitleSeen.add(key);
                subtitles.push(sub);
            }
        }

        if (mergedSources.length) {
            const mergedResult = {
                ...winner,
                success: true,
                provider: winner.provider || winner._providerName,
                providerId: winner._providerId || 'unknown',
                sources: mergedSources,
                subtitles,
                _diagnostics: {
                    stage: 1,
                    providerCount: stage1Results.length,
                    sourceCount: mergedSources.length,
                    winnerProvider: winner._providerName,
                    winnerElapsedMs: winner._elapsedMs,
                },
            };
            console.log(`[Resolver] ✅ Stage 1 winner: ${mergedResult.provider} | merged ${stage1Results.length} provider(s) → ${mergedSources.length} source(s)`);
            return mergeSubtitles(mergedResult);
        }
    }

    // ══ Stage 2: VidSrc.me embed fallback ══════════════════════════════════
    console.log('[Resolver] Stage 2: VidSrc.me embed fallback...');
    try {
        const embedResult = await scrapeVidSrcMe(tmdbId, type, season, episode);
        if (embedResult?.success && embedResult.sources?.length) {
            embedResult.isEmbedFallback = true;
            embedResult._diagnostics = { stage: 2, note: 'All M3U8 providers failed — embed fallback active' };
            console.log(`[Resolver] ⚠️  Stage 2 Embed Fallback: ${embedResult.provider}`);
            return mergeSubtitles(embedResult);
        }
    } catch (_) {}

    // ══ Stage 3: PrimeSrc embed last resort ════════════════════════════════
    console.log('[Resolver] Stage 3: PrimeSrc embed last resort...');
    try {
        const stage3Result = await scrapePrimeSrc(tmdbId, type, season, episode);
        if (stage3Result?.success && stage3Result.sources?.length) {
            stage3Result.isEmbedFallback = true;
            stage3Result._diagnostics = { stage: 3, note: 'All M3U8 and VidSrc embed failed — PrimeSrc last resort' };
            console.log(`[Resolver] ⚠️  Stage 3 Embed Fallback: ${stage3Result.provider}`);
            return stage3Result;
        }
    } catch (_) {}

    console.warn(`[Resolver] ❌ All stages failed for: ${title || tmdbId}`);
    return {
        success: false,
        error: 'No stream found. All providers are currently unavailable. Please try again in a moment.',
        _diagnostics: { stage: 'all_failed', note: 'Check /api/stream/diagnose for per-provider detail' },
    };
}


// ── Diagnostic helper (powers /api/stream/diagnose) ──────────────────────────

/**
 * Runs every provider individually (no race-short-circuit) and returns a
 * detailed per-provider report. This is slow (up to 25s) but gives you the
 * full picture of what's working and what isn't.
 *
 * Response shape:
 * {
 *   tmdbId, type, season, episode,
 *   elapsedMs: number,
 *   providers: [
 *     {
 *       id, name,
 *       status: 'success' | 'no_sources' | 'error' | 'timeout' | 'embed_only',
 *       elapsedMs: number,
 *       failReason?: string,
 *       sourceCount?: number,
 *       sources?: Array<{ url, quality, isM3U8, isEmbed, noProxy }>,
 *       subtitleCount?: number,
 *     }
 *   ]
 * }
 */
export async function diagnoseProviders(tmdbId, type, season = '1', episode = '1', title = '', year = '') {
    const DIAG_TIMEOUT = 25000;

    const allProviders = [
        { id: 'vaplayer',   name: 'VaPlayer',   run: () => extractVaPlayer({ tmdbId, type, season, episode }) },
        { id: 'vidzee',     name: 'VidZee',     run: () => scrapeVidZee(tmdbId, type, season, episode) },
        { id: 'vidsrc_ru',  name: 'VidSrc.ru',  run: () => scrapeVidSrcRu(tmdbId, type, season, episode) },
        { id: 'lookmovie',  name: 'LookMovie',  run: () => scrapeLookMovie(tmdbId, type === 'movie' ? 'movie' : 'show', season, episode, title, year) },
        { id: 'vidsrcme',   name: 'VidSrc.me',  run: () => scrapeVidSrcMe(tmdbId, type, season, episode) },
        { id: 'primesrc',   name: 'PrimeSrc',   run: () => scrapePrimeSrc(tmdbId, type, season, episode) },
    ];

    const startAll = Date.now();
    console.log(`[Diagnose] Running full provider diagnostic for ${title || tmdbId} (${type})...`);

    const results = await Promise.all(
        allProviders.map(p => runExtractorDiag(p, DIAG_TIMEOUT))
    );

    const report = {
        tmdbId,
        type,
        season,
        episode,
        title: title || null,
        elapsedMs: Date.now() - startAll,
        providers: results.map(r => {
            const out = {
                id: r._providerId,
                name: r._providerName,
                status: r._status,
                elapsedMs: r._elapsedMs,
            };
            if (r._failReason) out.failReason = r._failReason;
            if (r.sources?.length) {
                out.sourceCount = r.sources.length;
                // Include sanitised source preview (URL truncated for brevity)
                out.sources = r.sources.map(s => ({
                    urlPreview: s.url ? s.url.substring(0, 100) + (s.url.length > 100 ? '…' : '') : null,
                    quality: s.quality,
                    isM3U8: !!s.isM3U8,
                    isEmbed: !!s.isEmbed,
                    noProxy: !!s.noProxy,
                }));
            }
            if (r.subtitles?.length) out.subtitleCount = r.subtitles.length;
            return out;
        }),
    };

    const successCount = results.filter(r => r._status === 'success').length;
    console.log(`[Diagnose] ✅ ${successCount}/${allProviders.length} providers succeeded. Total: ${report.elapsedMs}ms`);

    return report;
}
