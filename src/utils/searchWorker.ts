/// <reference lib="webworker" />
import type { WorkerCard, WorkerInputs, WorkerResult, WorkerTargetResult, WorkerMessage } from './searchWorkerTypes';

/* ─────────────────────────────────────────────────────────────────────────────
 * Constants — must stay in sync with Simulation.tsx
 * ─────────────────────────────────────────────────────────────────────────── */
const TOLERANCE = 0.20;
const CROSS_PACK_TOLERANCE = 0.30;
// Matches PRICE_TARGETS order in Simulation.tsx
const TARGET_PRICES = new Float64Array([
    100, 100, 400, 400,
    4_000, 4_000,
    40_000, 40_000, 40_000,
    100_000, 200_000, 200_000,
]);

/* ─────────────────────────────────────────────────────────────────────────────
 * Worker state — initialised once via 'init' message
 * ─────────────────────────────────────────────────────────────────────────── */
let N = 0;
let WISH_IDX = -1;
let TRUEREZ_IDX = -1;
let cardIsConj: Uint8Array;
let cardLevel: Uint8Array;
let cardIsAutographable: Uint8Array;
let cardIsLegendary: Uint8Array;
let targetGroups: Uint16Array[];

/** Pre-allocated evaluation scratch buffers — reused on every evaluateFast call. */
let fairBaseArr: Float64Array;
let fairWithVarArr: Float64Array;

/* ─────────────────────────────────────────────────────────────────────────────
 * Optimised evaluation
 *
 * Key improvements over the original evaluateInputs + computeSpellFairValues:
 * • Single pass over all cards (was two separate passes)
 * • Precomputed target-group indices — no per-call filter()
 * • Pre-allocated Float64Array scratch buffers — no per-call allocation
 * • Typed-array reads for static card data — better CPU cache behaviour
 * ─────────────────────────────────────────────────────────────────────────── */
function evaluateFast(inp: WorkerInputs, refFairValues: Float64Array | null): WorkerResult {
    const conjRate = inp.conjurationRate / 100;
    const lw = inp.levelWeights;
    const co = inp.cardOverrides;

    // ── Pass 1: pool weights + drawable count ────────────────────────────────
    let conjWeight = 0, stapleWeight = 0, drawableCount = 0;
    for (let i = 0; i < N; i++) {
        const w = lw[cardLevel[i]] * co[i];
        if (cardIsConj[i]) conjWeight += w; else stapleWeight += w;
        if (w > 0) drawableCount++;
    }
    const avgPDraw = drawableCount > 0 ? 1.0 / drawableCount : 1;
    const ppCard = inp.packPrice / inp.cardsInPack;

    // ── Pass 2: per-card fair values into pre-allocated buffers ──────────────
    let rawPackEV = 0, packEV = 0;
    for (let i = 0; i < N; i++) {
        const isConj = cardIsConj[i];
        const poolWeight = isConj ? conjWeight : stapleWeight;
        const pPool = isConj ? conjRate : 1.0 - conjRate;
        const w = lw[cardLevel[i]] * co[i];
        const pDraw = poolWeight > 0 ? pPool * w / poolWeight : 0;

        const fairRaw = pDraw > 0 ? ppCard * avgPDraw / pDraw : ppCard;
        const fairBase = Math.max(1, fairRaw * inp.baseRate);
        fairBaseArr[i] = fairBase;

        let uplift = 1 + inp.shinyChance * (inp.shinyMultiplierAvg - 1);
        if (cardIsAutographable[i]) {
            const avg = cardIsLegendary[i] ? inp.autoLegMultiplierAvg : inp.autoMultiplierAvg;
            uplift += inp.autographChance * (avg - 1);
        }
        const fwv = fairBase * uplift;
        fairWithVarArr[i] = fwv;

        rawPackEV += pDraw * fairRaw;
        packEV += pDraw * fwv;
    }
    rawPackEV *= inp.cardsInPack;
    packEV *= inp.cardsInPack;

    // ── Per-target stats via precomputed index groups ────────────────────────
    const n12 = targetGroups.length;
    const targets: WorkerTargetResult[] = new Array(n12);
    let sse = 0, score = 0, activeCount = 0;

    for (let t = 0; t < n12; t++) {
        const group = targetGroups[t];
        const n = group.length;
        if (n === 0) {
            targets[t] = { avgFair: 0, avgWithVariants: 0, cardCount: 0, excluded: true, pass: true, deltaPct: 0 };
            continue;
        }
        // Excluded when no card in group is drawable
        let hasDrawable = false;
        for (let j = 0; j < n; j++) {
            const ci = group[j];
            if (lw[cardLevel[ci]] * co[ci] > 0) { hasDrawable = true; break; }
        }
        if (!hasDrawable) {
            targets[t] = { avgFair: 0, avgWithVariants: 0, cardCount: n, excluded: true, pass: true, deltaPct: 0 };
            continue;
        }
        let fairSum = 0, varSum = 0;
        for (let j = 0; j < n; j++) {
            const ci = group[j];
            fairSum += fairBaseArr[ci];
            varSum += fairWithVarArr[ci];
        }
        const avgFair = fairSum / n;
        const tPrice = TARGET_PRICES[t];
        const deltaPct = (avgFair - tPrice) / tPrice;
        const pass = Math.abs(deltaPct) <= TOLERANCE;
        if (pass) score++;
        activeCount++;
        if (avgFair > 0) { const d = Math.log(avgFair / tPrice); sse += d * d; }
        targets[t] = { avgFair, avgWithVariants: varSum / n, cardCount: n, excluded: false, pass, deltaPct };
    }

    // ── EV check ─────────────────────────────────────────────────────────────
    const evPass = rawPackEV > 0 && Math.abs(packEV / rawPackEV - 1) <= TOLERANCE;
    if (evPass) score++;
    activeCount++;

    // ── Cross-pack divergence ─────────────────────────────────────────────────
    let crossPackDivPct = 0;
    if (refFairValues !== null) {
        let divSum = 0, divCount = 0;
        for (let i = 0; i < N; i++) {
            const af = fairBaseArr[i];
            const rf = refFairValues[i];
            if (af > 0 && rf > 0) {
                divSum += Math.abs(af - rf) / Math.sqrt(af * rf);
                divCount++;
            }
        }
        crossPackDivPct = divCount > 0 ? divSum / divCount : 0;
        sse += crossPackDivPct * crossPackDivPct;
    }

    return {
        inputs: inp, score, activeTargetCount: activeCount,
        passAll: score === activeCount, evPass, packEV, rawPackEV,
        sse, crossPackDivPct, targets,
    };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Jitter helper
 * ─────────────────────────────────────────────────────────────────────────── */
function jitter(base: number, lo: number, hi: number, spread: number): number {
    const v = base * (1.0 - spread + Math.random() * spread * 2.0);
    return v < lo ? lo : v > hi ? hi : v;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Search
 * Candidates are generated in-place using reused slices; only top-10 results
 * allocate their own copies via slice() at result-push time.
 * ─────────────────────────────────────────────────────────────────────────── */
function runSearch(
    base: WorkerInputs,
    iterations: number,
    deadline: number,
    spread: number,
    locked: boolean[],
    conjRange: [number, number],
    baseRange: [number, number],
    refFairValues: Float64Array | null,
): WorkerResult[] {
    const results: WorkerResult[] = [];
    // Reuse single mutable candidate arrays; only slice when building the final object.
    const candLw = base.levelWeights.slice();
    const candCo = base.cardOverrides.slice();

    for (let iter = 0; iter < iterations; iter++) {
        // Deadline check every 128 iters to amortise Date.now() cost
        if ((iter & 127) === 0 && Date.now() > deadline) break;

        // Jitter + normalise level weights
        for (let l = 0; l < 10; l++) {
            candLw[l] = locked[l] ? base.levelWeights[l] : jitter(base.levelWeights[l], 0.001, 1e9, spread);
        }
        let lockedSum = 0, unlockedSum = 0;
        for (let l = 0; l < 10; l++) {
            if (locked[l]) lockedSum += candLw[l]; else unlockedSum += candLw[l];
        }
        const wTarget = 100 - lockedSum;
        if (unlockedSum > 0 && wTarget > 0) {
            const scale = wTarget / unlockedSum;
            for (let l = 0; l < 10; l++) {
                if (!locked[l]) candLw[l] *= scale;
            }
        }

        // Copy base overrides then jitter special cards
        for (let i = 0; i < N; i++) candCo[i] = base.cardOverrides[i];
        if (WISH_IDX >= 0) candCo[WISH_IDX] = jitter(base.cardOverrides[WISH_IDX], 0.001, 5, spread);
        if (TRUEREZ_IDX >= 0) candCo[TRUEREZ_IDX] = jitter(base.cardOverrides[TRUEREZ_IDX], 0.001, 5, spread);

        const candidate: WorkerInputs = {
            packPrice: base.packPrice,
            cardsInPack: base.cardsInPack,
            conjurationRate: Math.round(jitter(base.conjurationRate, conjRange[0], conjRange[1], spread)),
            levelWeights: candLw.slice(),
            baseRate: jitter(base.baseRate, baseRange[0], baseRange[1], spread),
            shinyChance: jitter(base.shinyChance, 0.02, 0.20, spread),
            autographChance: jitter(base.autographChance, 0.02, 0.20, spread),
            shinyMultiplierAvg: jitter(base.shinyMultiplierAvg, 1, 5, spread),
            autoMultiplierAvg: jitter(base.autoMultiplierAvg, 1, 5, spread),
            autoLegMultiplierAvg: jitter(base.autoLegMultiplierAvg, 1, 5, spread),
            cardOverrides: candCo.slice(),
        };
        results.push(evaluateFast(candidate, refFairValues));
    }

    results.sort((a, b) => {
        const sa = a.score + (a.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0);
        const sb = b.score + (b.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0);
        return (sb - sa) || (a.sse - b.sse);
    });
    return results.slice(0, 10);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Message handler
 * ─────────────────────────────────────────────────────────────────────────── */
self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;

    if (msg.type === 'init') {
        const { cards, wishIdx, trueRezIdx, targetGroupIndices } = msg;
        N = cards.length;
        WISH_IDX = wishIdx;
        TRUEREZ_IDX = trueRezIdx;

        cardIsConj = new Uint8Array(N);
        cardLevel = new Uint8Array(N);
        cardIsAutographable = new Uint8Array(N);
        cardIsLegendary = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
            cardIsConj[i] = cards[i].isConj ? 1 : 0;
            cardLevel[i] = cards[i].level;
            cardIsAutographable[i] = cards[i].isAutographable ? 1 : 0;
            cardIsLegendary[i] = cards[i].isLegendary ? 1 : 0;
        }
        // Pre-allocate evaluation scratch buffers
        fairBaseArr = new Float64Array(N);
        fairWithVarArr = new Float64Array(N);

        targetGroups = targetGroupIndices.map(g => new Uint16Array(g));
        self.postMessage({ type: 'ready' });

    } else if (msg.type === 'search') {
        const { base, iterations, spread, locked, conjRange, baseRange, refFairValues, id } = msg;
        const refFair = refFairValues && refFairValues.length > 0
            ? new Float64Array(refFairValues)
            : null;
        const results = runSearch(
            base, iterations, Date.now() + 15_000,
            spread, locked, conjRange, baseRange,
            refFair,
        );
        self.postMessage({ type: 'results', id, results });
    }
});
