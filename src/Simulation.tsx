import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { spellCards, type SpellLevel, spellLevels } from './utils/spells';
import { STARTER_PACK, ADVANCED_PACK, STARTER_LEVEL_WEIGHTS, ADVANCED_LEVEL_WEIGHTS, CARD_WEIGHT_OVERRIDES } from './utils/constants';
import { isAutographable } from './utils/format';
import { panel, inp, eyebrow, secTitle } from './components/tokens';

/* ─────────────────────────────────────────────────────────────────────────────
 * MARKET SIMULATOR
 * Standalone analysis page: tweak every input, see deterministic per-level fair
 * values, check against target prices, and run a random parameter search to
 * find combinations that hit all targets within ±10%.
 *
 * Visit at /#sim
 * ───────────────────────────────────────────────────────────────────────── */

type PriceTarget = { label: string; rarity: string; price: number; filter: (fileName: string, level: number) => boolean };

const WISH_FILE = '9-Wish-Conjuration1';
const TRUEREZ_FILE = '9-True Resurrection-Necromancy';

const PACK_PRESETS_SIM = [
    { id: 'starter' as const, name: 'Starter', packPrice: STARTER_PACK.packPrice, cardsInPack: STARTER_PACK.cardsInPack, conjurationRate: STARTER_PACK.conjurationRate, levelWeights: STARTER_LEVEL_WEIGHTS },
    { id: 'advanced' as const, name: 'Advanced', packPrice: ADVANCED_PACK.packPrice, cardsInPack: ADVANCED_PACK.cardsInPack, conjurationRate: ADVANCED_PACK.conjurationRate, levelWeights: ADVANCED_LEVEL_WEIGHTS },
] as const;

const PRICE_TARGETS: PriceTarget[] = [
    { label: 'Cantrip (L0)', rarity: 'common', price: 100, filter: (_f, l) => l === 0 },
    { label: 'L1', rarity: 'common', price: 100, filter: (_f, l) => l === 1 },
    { label: 'L2', rarity: 'uncommon', price: 400, filter: (_f, l) => l === 2 },
    { label: 'L3', rarity: 'uncommon', price: 400, filter: (_f, l) => l === 3 },
    { label: 'L4', rarity: 'rare', price: 4_000, filter: (_f, l) => l === 4 },
    { label: 'L5', rarity: 'rare', price: 4_000, filter: (_f, l) => l === 5 },
    { label: 'L6', rarity: 'very_rare', price: 40_000, filter: (_f, l) => l === 6 },
    { label: 'L7', rarity: 'very_rare', price: 40_000, filter: (_f, l) => l === 7 },
    { label: 'L8', rarity: 'very_rare', price: 40_000, filter: (_f, l) => l === 8 },
    {
        label: 'L9 (other legendary)', rarity: 'legendary', price: 100_000,
        filter: (f, l) => l === 9 && f !== WISH_FILE && f !== TRUEREZ_FILE
    },
    {
        label: 'True Resurrection (L9)', rarity: 'legendary', price: 200_000,
        filter: (f) => f === TRUEREZ_FILE
    },
    {
        label: 'Wish (L9)', rarity: 'legendary', price: 200_000,
        filter: (f) => f === WISH_FILE
    },
];

const TOLERANCE = 0.20; // ±10%

type SimInputs = {
    packPrice: number;
    cardsInPack: number;
    conjurationRate: number; // 0–100
    levelWeights: Record<SpellLevel, number>;
    baseRate: number;
    shinyChance: number;       // 0–1
    autographChance: number;   // 0–1 (only applied to rare/legendary)
    shinyMultiplierAvg: number;     // E[shinyMult]
    autoMultiplierAvg: number;      // E[autoMult] non-leg
    autoLegMultiplierAvg: number;   // E[autoMult] legendary
    cardWeightOverrides: Record<string, number>;
};

function defaultInputs(): SimInputs {
    return {
        packPrice: ADVANCED_PACK.packPrice,
        cardsInPack: ADVANCED_PACK.cardsInPack,
        conjurationRate: ADVANCED_PACK.conjurationRate,
        levelWeights: { ...ADVANCED_LEVEL_WEIGHTS },
        baseRate: ADVANCED_PACK.baseRate,
        shinyChance: ADVANCED_PACK.shinyChance,
        autographChance: ADVANCED_PACK.autographChance,
        shinyMultiplierAvg: ADVANCED_PACK.shinyMultiplierAvg,
        autoMultiplierAvg: ADVANCED_PACK.autoMultiplierAvg,
        autoLegMultiplierAvg: ADVANCED_PACK.autoLegMultiplierAvg,
        cardWeightOverrides: { ...CARD_WEIGHT_OVERRIDES },
    };
}

type TargetEval = {
    label: string;
    targetRarity: string;
    targetPrice: number;
    avgFair: number;
    avgWithVariants: number;
    cardCount: number;
    excluded: boolean; // true when all cards in this group have pDraw = 0 (level not in pack)
    pass: boolean;
    deltaPct: number;
};

type EvalResult = {
    targets: TargetEval[];
    packEV: number;
    rawPackEV: number;
    score: number;
    activeTargetCount: number; // non-excluded targets + 1 (evPass)
    passAll: boolean;
    evPass: boolean;  // variant EV within ±10% of raw EV
};

function variantUplift(rarity: string, inputs: SimInputs): number {
    let m = 1 + inputs.shinyChance * (inputs.shinyMultiplierAvg - 1);
    if (isAutographable(rarity as Parameters<typeof isAutographable>[0])) {
        const avg = rarity === 'legendary' ? inputs.autoLegMultiplierAvg : inputs.autoMultiplierAvg;
        m += inputs.autographChance * (avg - 1);
    }
    return m;
}

function evaluateInputs(inputs: SimInputs): EvalResult {
    // Apply overrides to a fresh card list
    const cards = spellCards.map((c) => ({
        ...c,
        weightMultiplier: inputs.cardWeightOverrides[c.fileName] ?? 1,
    }));
    // computeSpellOdds reads from spellCards directly; we need to inline the math.
    const conjRate = inputs.conjurationRate / 100;
    const conjCards = cards.filter((c) => c.pool === 'conjuration');
    const stapleCards = cards.filter((c) => c.pool === 'staple');
    const conjWeight = conjCards.reduce((s, c) => s + (inputs.levelWeights[c.level as SpellLevel] ?? 0) * c.weightMultiplier, 0);
    const stapleWeight = stapleCards.reduce((s, c) => s + (inputs.levelWeights[c.level as SpellLevel] ?? 0) * c.weightMultiplier, 0);

    // avgPDraw must be computed only over drawable cards (pDraw > 0), otherwise cards
    // excluded by a zero level-weight deflate fair values and rawPackEV falls below packPrice.
    const drawableCount = cards.filter(
        (c) => (inputs.levelWeights[c.level as SpellLevel] ?? 0) * c.weightMultiplier > 0,
    ).length;
    const avgPDraw = drawableCount > 0 ? 1 / drawableCount : 1;

    type Row = { card: typeof cards[number]; pDraw: number; fair: number; fairBase: number; fairWithVariants: number };
    const rows: Row[] = cards.map((card) => {
        const pPool = card.pool === 'conjuration' ? conjRate : 1 - conjRate;
        const poolWeight = card.pool === 'conjuration' ? conjWeight : stapleWeight;
        const pDraw = poolWeight > 0
            ? pPool * (inputs.levelWeights[card.level as SpellLevel] ?? 0) * card.weightMultiplier / poolWeight
            : 0;
        const fairRaw = pDraw > 0
            ? (inputs.packPrice / inputs.cardsInPack) * (avgPDraw / pDraw)
            : inputs.packPrice / inputs.cardsInPack;
        const fairBase = Math.max(1, fairRaw * inputs.baseRate);
        const uplift = variantUplift(card.rarity, inputs);
        return { card, pDraw, fair: fairRaw, fairBase, fairWithVariants: fairBase * uplift };
    });

    // Per-target averages
    const targets: TargetEval[] = PRICE_TARGETS.map((t) => {
        const group = rows.filter((r) => t.filter(r.card.fileName, r.card.level));
        const excluded = group.length === 0 || group.every((r) => r.pDraw === 0);
        const avgFair = group.length > 0 ? group.reduce((s, r) => s + r.fairBase, 0) / group.length : 0;
        const avgWithVariants = group.length > 0 ? group.reduce((s, r) => s + r.fairWithVariants, 0) / group.length : 0;
        const deltaPct = excluded ? 0 : (avgFair - t.price) / t.price;
        return {
            label: t.label,
            targetRarity: t.rarity,
            targetPrice: t.price,
            avgFair,
            avgWithVariants,
            cardCount: group.length,
            excluded,
            pass: excluded || Math.abs(deltaPct) <= TOLERANCE,
            deltaPct,
        };
    });

    const rawPackEV = rows.reduce((s, r) => s + r.pDraw * r.fair, 0) * inputs.cardsInPack;
    const packEV = rows.reduce((s, r) => s + r.pDraw * r.fairBase * variantUplift(r.card.rarity, inputs), 0) * inputs.cardsInPack;
    const evPass = rawPackEV > 0 && Math.abs(packEV / rawPackEV - 1) <= TOLERANCE;
    const activeTargetCount = targets.filter((t) => !t.excluded).length + 1;
    const score = targets.filter((t) => !t.excluded && t.pass).length + (evPass ? 1 : 0);
    return { targets, packEV, rawPackEV, score, activeTargetCount, passAll: score === activeTargetCount, evPass };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Random search
 * ───────────────────────────────────────────────────────────────────────── */

type SearchResult = {
    inputs: SimInputs;
    eval: EvalResult;
    sse: number; // sum-squared error of log(avgFair / target)
};

/** Returns a value uniformly within ±spread of `base`, clamped to [lo, hi]. */
function jitter(base: number, lo: number, hi: number, spread = 0.25): number {
    const v = base * (1 - spread + Math.random() * spread * 2);
    return Math.min(hi, Math.max(lo, v));
}

function randomSearch(base: SimInputs, iterations: number, deadline: number, spread = 0.25, locked: Partial<Record<SpellLevel, boolean>> = {}, conjRange: [number, number] = [40, 90], baseRange: [number, number] = [0.1, 2]): SearchResult[] {
    const results: SearchResult[] = [];
    for (let i = 0; i < iterations; i++) {
        if (Date.now() > deadline) break;
        const candidate: SimInputs = {
            ...base,
            conjurationRate: Math.round(jitter(base.conjurationRate, conjRange[0], conjRange[1], spread)),
            baseRate: jitter(base.baseRate, baseRange[0], baseRange[1], spread),
            levelWeights: Object.fromEntries(
                (Object.keys(base.levelWeights) as unknown as SpellLevel[]).map((k) => [
                    k,
                    locked[k] ? base.levelWeights[k] : jitter(base.levelWeights[k], 0.001, Infinity, spread),
                ])
            ) as Record<SpellLevel, number>,
            shinyChance: jitter(base.shinyChance, 0.02, 0.20, spread),
            autographChance: jitter(base.autographChance, 0.02, 0.20, spread),
            shinyMultiplierAvg: jitter(base.shinyMultiplierAvg, 1, 5, spread),
            autoMultiplierAvg: jitter(base.autoMultiplierAvg, 1, 5, spread),
            autoLegMultiplierAvg: jitter(base.autoLegMultiplierAvg, 1, 5, spread),
            cardWeightOverrides: {
                ...base.cardWeightOverrides,
                [WISH_FILE]: jitter(base.cardWeightOverrides[WISH_FILE] ?? 1, 0.001, 5, spread),
                [TRUEREZ_FILE]: jitter(base.cardWeightOverrides[TRUEREZ_FILE] ?? 1, 0.001, 5, spread),
            },
        };
        // Normalize: locked weights stay fixed; unlocked weights scale so total = 100.
        const lvlKeys = Object.keys(candidate.levelWeights) as unknown as SpellLevel[];
        const lockedSum = lvlKeys.filter((k) => locked[k]).reduce((s, k) => s + candidate.levelWeights[k], 0 as number);
        const unlockedKeys = lvlKeys.filter((k) => !locked[k]);
        const unlockedSum = unlockedKeys.reduce((s, k) => s + candidate.levelWeights[k], 0 as number);
        const target = 100 - lockedSum;
        if (unlockedSum > 0 && target > 0) {
            for (const k of unlockedKeys) {
                candidate.levelWeights[k] = (candidate.levelWeights[k] / unlockedSum) * target;
            }
        }
        const ev = evaluateInputs(candidate);
        const sse = ev.targets.reduce((s, t) => {
            if (t.cardCount === 0 || t.avgFair <= 0) return s;
            const d = Math.log(t.avgFair / t.targetPrice);
            return s + d * d;
        }, 0);
        results.push({ inputs: candidate, eval: ev, sse });
    }
    // Sort: most passes first, then lowest SSE
    results.sort((a, b) => (b.eval.score - a.eval.score) || (a.sse - b.sse));
    return results.slice(0, 10);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * BAYESIAN OPTIMISATION
 * ─────────────────────────────────────────────────────────────────────────── */

// 19-dimensional normalised search space
// dims: [conjRate, baseRate, w0..w9, shinyChance, autoChance, shinyMult, autoMult, autoLegMult, wish, trez]
const BO_DIM = 19;
const BO_LO: number[] = [40,  0.6, 10,  10,  5,   3,   1,   1,   0.3, 0.1, 0.05, 0.05, 0.02, 0.02, 1, 1, 1, 0.001, 0.001];
const BO_HI: number[] = [90,  1.0, 50,  45,  35,  28,  21,  19,  10.3,7.1, 5.05, 5.05, 0.20, 0.20, 5, 5, 5, 5.0,   5.0  ];

function boNorm(v: number, dim: number): number {
    return (v - BO_LO[dim]) / (BO_HI[dim] - BO_LO[dim]);
}
function boDenorm(t: number, dim: number): number {
    return BO_LO[dim] + Math.min(1, Math.max(0, t)) * (BO_HI[dim] - BO_LO[dim]);
}

function encodeInputs(inp: SimInputs): number[] {
    return [
        boNorm(inp.conjurationRate,           0),
        boNorm(inp.baseRate,                  1),
        boNorm(inp.levelWeights[0],           2),
        boNorm(inp.levelWeights[1],           3),
        boNorm(inp.levelWeights[2],           4),
        boNorm(inp.levelWeights[3],           5),
        boNorm(inp.levelWeights[4],           6),
        boNorm(inp.levelWeights[5],           7),
        boNorm(inp.levelWeights[6],           8),
        boNorm(inp.levelWeights[7],           9),
        boNorm(inp.levelWeights[8],          10),
        boNorm(inp.levelWeights[9],          11),
        boNorm(inp.shinyChance,              12),
        boNorm(inp.autographChance,          13),
        boNorm(inp.shinyMultiplierAvg,       14),
        boNorm(inp.autoMultiplierAvg,        15),
        boNorm(inp.autoLegMultiplierAvg,     16),
        boNorm(inp.cardWeightOverrides[WISH_FILE] ?? 1,     17),
        boNorm(inp.cardWeightOverrides[TRUEREZ_FILE] ?? 1,  18),
    ].map((v) => Math.min(1, Math.max(0, v)));
}

function decodeVector(vec: number[], base: SimInputs, locked: Partial<Record<SpellLevel, boolean>> = {}): SimInputs {
    // Decode unlocked dims; locked dims keep their base value.
    const raw = ([2,3,4,5,6,7,8,9,10,11] as const).map((vecIdx, j) => {
        const lvl = j as SpellLevel;
        return locked[lvl] ? base.levelWeights[lvl] : boDenorm(vec[vecIdx], vecIdx);
    });
    // Normalize: locked weights fixed, unlocked weights scaled to fill remainder.
    const lockedSum = raw.reduce((s, v, j) => (locked[j as SpellLevel] ? s + v : s), 0);
    const unlockedRaw = raw.map((v, j) => (locked[j as SpellLevel] ? 0 : v));
    const unlockedSum = unlockedRaw.reduce((a, v) => a + v, 0) || 1;
    const target = 100 - lockedSum;
    const s = target > 0 ? target / unlockedSum : 0;
    return {
        ...base,
        conjurationRate:      Math.round(boDenorm(vec[0], 0)),
        baseRate:             boDenorm(vec[1], 1),
        levelWeights: {
            0: locked[0] ? base.levelWeights[0] : unlockedRaw[0] * s,
            1: locked[1] ? base.levelWeights[1] : unlockedRaw[1] * s,
            2: locked[2] ? base.levelWeights[2] : unlockedRaw[2] * s,
            3: locked[3] ? base.levelWeights[3] : unlockedRaw[3] * s,
            4: locked[4] ? base.levelWeights[4] : unlockedRaw[4] * s,
            5: locked[5] ? base.levelWeights[5] : unlockedRaw[5] * s,
            6: locked[6] ? base.levelWeights[6] : unlockedRaw[6] * s,
            7: locked[7] ? base.levelWeights[7] : unlockedRaw[7] * s,
            8: locked[8] ? base.levelWeights[8] : unlockedRaw[8] * s,
            9: locked[9] ? base.levelWeights[9] : unlockedRaw[9] * s,
        },
        shinyChance:          boDenorm(vec[12], 12),
        autographChance:      boDenorm(vec[13], 13),
        shinyMultiplierAvg:   boDenorm(vec[14], 14),
        autoMultiplierAvg:    boDenorm(vec[15], 15),
        autoLegMultiplierAvg: boDenorm(vec[16], 16),
        cardWeightOverrides: {
            ...base.cardWeightOverrides,
            [WISH_FILE]:    boDenorm(vec[17], 17),
            [TRUEREZ_FILE]: boDenorm(vec[18], 18),
        },
    };
}

/** Combined objective: maximise passes first, then minimise SSE. */
function computeObjective(ev: EvalResult): number {
    const sse = ev.targets.reduce((s, t) => {
        if (t.cardCount === 0 || t.avgFair <= 0) return s;
        const d = Math.log(t.avgFair / t.targetPrice);
        return s + d * d;
    }, 0);
    return ev.score * 100 - sse;
}

// ─── Gaussian Process (RBF kernel, UCB acquisition) ──────────────────────────

function rbfKernel(a: number[], b: number[], ls: number): number {
    let d2 = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; d2 += d * d; }
    return Math.exp(-0.5 * d2 / (ls * ls));
}

function choleskyDecomp(A: number[][]): number[][] | null {
    const n = A.length;
    const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let s = A[i][j];
            for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
            if (i === j) {
                if (s < 0) return null;
                L[i][j] = Math.sqrt(s);
            } else {
                L[i][j] = L[j][j] > 1e-12 ? s / L[j][j] : 0;
            }
        }
    }
    return L;
}

function fwdSolve(L: number[][], b: number[]): number[] {
    const n = b.length;
    const x = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let j = 0; j < i; j++) s -= L[i][j] * x[j];
        x[i] = L[i][i] > 1e-12 ? s / L[i][i] : 0;
    }
    return x;
}

function bwdSolve(L: number[][], b: number[]): number[] {
    const n = b.length;
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let s = b[i];
        for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j];
        x[i] = L[i][i] > 1e-12 ? s / L[i][i] : 0;
    }
    return x;
}

type GPModel = { X: number[][]; alpha: number[]; L: number[][]; ls: number; noise: number };

function fitGP(X: number[][], y: number[], ls: number, noise: number): GPModel | null {
    const n = X.length;
    const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            const v = rbfKernel(X[i], X[j], ls) + (i === j ? noise : 0);
            K[i][j] = v;
            K[j][i] = v;
        }
    }
    const L = choleskyDecomp(K);
    if (!L) return null;
    const alpha = bwdSolve(L, fwdSolve(L, y));
    return { X, alpha, L, ls, noise };
}

/** Upper-confidence-bound acquisition: μ + β·σ. */
function gpUCB(model: GPModel, xStar: number[], beta: number): number {
    const { X, alpha, L, ls, noise } = model;
    const kStar = X.map((xi) => rbfKernel(xi, xStar, ls));
    const mu = kStar.reduce((s, k, i) => s + k * alpha[i], 0);
    const v = fwdSolve(L, kStar);
    const variance = Math.max(1e-12, 1 + noise - v.reduce((s, vi) => s + vi * vi, 0));
    return mu + beta * Math.sqrt(variance);
}

/** Latin-hypercube sample: n well-spread points in [0,1]^d. */
function lhsSample(n: number, d: number): number[][] {
    const pts: number[][] = Array.from({ length: n }, () => new Array(d).fill(0));
    for (let j = 0; j < d; j++) {
        const perm = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
            const k = Math.floor(Math.random() * (i + 1));
            [perm[i], perm[k]] = [perm[k], perm[i]];
        }
        for (let i = 0; i < n; i++) pts[i][j] = (perm[i] + Math.random()) / n;
    }
    return pts;
}

function runBayesOpt(base: SimInputs, boIterations: number, deadline: number, locked: Partial<Record<SpellLevel, boolean>> = {}, conjRange: [number, number] = [BO_LO[0], BO_HI[0]], baseRange: [number, number] = [BO_LO[1], BO_HI[1]]): SearchResult[] {
    // Temporarily patch dims 0 and 1 so encodeInputs/decodeVector use the custom ranges.
    const [savedLO0, savedLO1, savedHI0, savedHI1] = [BO_LO[0], BO_LO[1], BO_HI[0], BO_HI[1]];
    BO_LO[0] = conjRange[0]; BO_HI[0] = conjRange[1];
    BO_LO[1] = baseRange[0]; BO_HI[1] = baseRange[1];
    try {
    const INIT_N  = 10;   // LHS seed evaluations
    const LS      = 0.3;  // RBF length scale in [0,1] space
    const NOISE   = 0.01; // diagonal noise for numerical stability
    const BETA    = 2.0;  // UCB exploration weight
    const N_CANDS = 300;  // acquisition-maximisation candidates per step

    const allResults: SearchResult[] = [];

    function evalVec(vec: number[]): SearchResult {
        const inp = decodeVector(vec, base, locked);
        const ev  = evaluateInputs(inp);
        const sse = ev.targets.reduce((s, t) => {
            if (t.cardCount === 0 || t.avgFair <= 0) return s;
            const d = Math.log(t.avgFair / t.targetPrice);
            return s + d * d;
        }, 0);
        return { inputs: inp, eval: ev, sse };
    }

    // 1. Seed with LHS; replace first point with current config
    const initVecs = lhsSample(INIT_N, BO_DIM);
    initVecs[0] = encodeInputs(base);
    const X: number[][] = [];
    const Y: number[]   = [];
    for (const vec of initVecs) {
        if (Date.now() > deadline) break;
        const r = evalVec(vec);
        allResults.push(r);
        X.push([...vec]);
        Y.push(computeObjective(r.eval));
    }

    // 2. BO loop: standardise → fit GP → maximise UCB → evaluate → add to data
    for (let iter = 0; iter < boIterations; iter++) {
        if (Date.now() > deadline) break;
        const yMean = Y.reduce((a, v) => a + v, 0) / Y.length;
        const yStd  = Math.sqrt(Y.reduce((s, v) => s + (v - yMean) ** 2, 0) / Y.length) || 1;
        const yNorm = Y.map((v) => (v - yMean) / yStd);

        const model = fitGP(X, yNorm, LS, NOISE);

        // Candidates: global LHS + local perturbations around current best
        const bestSoFar = allResults.reduce((b, r) =>
            computeObjective(r.eval) > computeObjective(b.eval) ? r : b,
        );
        const bestVec = encodeInputs(bestSoFar.inputs);
        const cands   = lhsSample(N_CANDS, BO_DIM);
        for (let k = 0; k < 50; k++) {
            cands.push(bestVec.map((v) => Math.min(1, Math.max(0, v + (Math.random() - 0.5) * 0.2))));
        }

        let bestAcq = -Infinity;
        let nextVec = cands[0];
        if (model) {
            for (const c of cands) {
                const acq = gpUCB(model, c, BETA);
                if (acq > bestAcq) { bestAcq = acq; nextVec = c; }
            }
        } else {
            nextVec = cands[Math.floor(Math.random() * cands.length)];
        }

        const r = evalVec(nextVec);
        allResults.push(r);
        X.push([...nextVec]);
        Y.push(computeObjective(r.eval));
    }

    allResults.sort((a, b) => (b.eval.score - a.eval.score) || (a.sse - b.sse));
    return allResults.slice(0, 10);
    } finally {
        BO_LO[0] = savedLO0; BO_LO[1] = savedLO1;
        BO_HI[0] = savedHI0; BO_HI[1] = savedHI1;
    }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * UI
 * ───────────────────────────────────────────────────────────────────────── */

const LEVEL_LABELS: Record<number, string> = {
    0: 'Cantrip', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4',
    5: 'Level 5', 6: 'Level 6', 7: 'Level 7', 8: 'Level 8', 9: 'Level 9',
};

const LEVEL_TO_RARITY: Record<number, string> = {
    0: 'common', 1: 'common',
    2: 'uncommon', 3: 'uncommon',
    4: 'rare', 5: 'rare',
    6: 'very_rare', 7: 'very_rare', 8: 'very_rare',
    9: 'legendary',
};

const RARITY_TEXT: Record<string, string> = {
    common: 'text-slate-300',
    uncommon: 'text-emerald-300',
    rare: 'text-cyan-300',
    very_rare: 'text-purple-300',
    legendary: 'text-amber-300',
};

const RARITY_DOT: Record<string, string> = {
    common: 'bg-slate-400',
    uncommon: 'bg-emerald-400',
    rare: 'bg-cyan-400',
    very_rare: 'bg-purple-400',
    legendary: 'bg-amber-400',
};

function fmtMoney(n: number): string {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
    return Math.round(n).toLocaleString();
}

function fmtPct(n: number): string {
    return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

function navTo(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
}

function defaultStarterInputs(): SimInputs {
    return {
        ...defaultInputs(),
        packPrice: STARTER_PACK.packPrice,
        cardsInPack: STARTER_PACK.cardsInPack,
        conjurationRate: STARTER_PACK.conjurationRate,
        baseRate: STARTER_PACK.baseRate,
        levelWeights: { ...STARTER_LEVEL_WEIGHTS },
        shinyChance: STARTER_PACK.shinyChance,
        shinyMultiplierAvg: STARTER_PACK.shinyMultiplierAvg,
        autographChance: STARTER_PACK.autographChance,
        autoMultiplierAvg: STARTER_PACK.autoMultiplierAvg,
        autoLegMultiplierAvg: STARTER_PACK.autoLegMultiplierAvg,
    };
}

export default function Simulation() {
    // Two fully-independent input states, one per pack preset.
    // `inputs` is always the active pack; `inactiveInputs` is the saved state of the other.
    const [activePreset, setActivePreset] = useState<'starter' | 'advanced'>('advanced');
    const [inputs, setInputs] = useState<SimInputs>(defaultInputs);
    const [inactiveInputs, setInactiveInputs] = useState<SimInputs>(defaultStarterInputs);
    const [overridesText, setOverridesText] = useState<string>(
        JSON.stringify(defaultInputs().cardWeightOverrides, null, 2),
    );
    const [inactiveOverridesText, setInactiveOverridesText] = useState<string>(
        JSON.stringify(defaultStarterInputs().cardWeightOverrides, null, 2),
    );
    const [overridesError, setOverridesError] = useState<string | null>(null);
    const [lockedWeights, setLockedWeights] = useState<Partial<Record<SpellLevel, boolean>>>({});
    const [inactiveLockedWeights, setInactiveLockedWeights] = useState<Partial<Record<SpellLevel, boolean>>>({});
    const lockedWeightsRef = useRef<Partial<Record<SpellLevel, boolean>>>({});
    const [conjRateRange, setConjRateRange] = useState<[number, number]>([40, 90]);
    const [baseRateRange, setBaseRateRange] = useState<[number, number]>([0.6, 1.0]);
    const [inactiveConjRateRange, setInactiveConjRateRange] = useState<[number, number]>([40, 90]);
    const [inactiveBaseRateRange, setInactiveBaseRateRange] = useState<[number, number]>([0.6, 1.0]);
    const conjRateRangeRef = useRef<[number, number]>([40, 90]);
    const baseRateRangeRef = useRef<[number, number]>([0.6, 1.0]);
    const [searchIter, setSearchIter] = useState<number>(2000);
    const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [boIter, setBoIter] = useState<number>(50);
    const [boResults, setBoResults] = useState<SearchResult[] | null>(null);
    const [boRunning, setBoRunning] = useState(false);
    const boLoopRef = useRef(false);
    const boLoopInputsRef = useRef<SimInputs>(defaultInputs());
    const searchPendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const boPendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [boLooping, setBoLooping] = useState(false);
    const [boLoopRound, setBoLoopRound] = useState(0);

    const evaluation = useMemo(() => evaluateInputs(inputs), [inputs]);

    // Each preset's eval reads from its own independent inputs.
    const starterEval  = useMemo(() => evaluateInputs(activePreset === 'starter'  ? inputs : inactiveInputs), [activePreset, inputs, inactiveInputs]);
    const advancedEval = useMemo(() => evaluateInputs(activePreset === 'advanced' ? inputs : inactiveInputs), [activePreset, inputs, inactiveInputs]);

    function switchPreset(id: 'starter' | 'advanced') {
        if (id === activePreset) return;
        // Save active → inactive slot, load inactive → active slot
        const savedInputs  = inputs;
        const savedText    = overridesText;
        const savedLocked  = lockedWeights;
        const savedConjRange = conjRateRange;
        const savedBaseRange = baseRateRange;
        setInputs(inactiveInputs);
        setInactiveInputs(savedInputs);
        setOverridesText(inactiveOverridesText);
        setInactiveOverridesText(savedText);
        setLockedWeights(inactiveLockedWeights);
        setInactiveLockedWeights(savedLocked);
        lockedWeightsRef.current = inactiveLockedWeights;
        setConjRateRange(inactiveConjRateRange);
        setInactiveConjRateRange(savedConjRange);
        conjRateRangeRef.current = inactiveConjRateRange;
        setBaseRateRange(inactiveBaseRateRange);
        setInactiveBaseRateRange(savedBaseRange);
        baseRateRangeRef.current = inactiveBaseRateRange;
        setActivePreset(id);
        setOverridesError(null);
    }

    function toggleLock(lvl: SpellLevel) {
        setLockedWeights((prev) => {
            const next = { ...prev, [lvl]: !prev[lvl] };
            lockedWeightsRef.current = next;
            return next;
        });
    }

    function update<K extends keyof SimInputs>(key: K, value: SimInputs[K]) {
        setInputs((prev) => ({ ...prev, [key]: value }));
        if (key === 'cardWeightOverrides') {
            setOverridesText(JSON.stringify(value, null, 2));
            setOverridesError(null);
        }
    }
    function updateWeight(lvl: SpellLevel, value: number) {
        setInputs((prev) => ({ ...prev, levelWeights: { ...prev.levelWeights, [lvl]: value } }));
    }
    function commitOverrides() {
        try {
            const parsed = JSON.parse(overridesText);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Must be object');
            setInputs((prev) => ({ ...prev, cardWeightOverrides: parsed }));
            setOverridesError(null);
        } catch (e) {
            setOverridesError(e instanceof Error ? e.message : String(e));
        }
    }
    function runSearch() {
        // Cancel any queued search that hasn't started yet
        if (searchPendingRef.current !== null) {
            clearTimeout(searchPendingRef.current);
        }
        setSearching(true);
        searchPendingRef.current = setTimeout(() => {
            searchPendingRef.current = null;
            const top = randomSearch(inputs, searchIter, Date.now() + 10_000, 0.25, lockedWeightsRef.current, conjRateRangeRef.current, baseRateRangeRef.current);
            setSearchResults(top);
            setSearching(false);
        }, 50);
    }
    function runBO() {
        if (boPendingRef.current !== null) {
            clearTimeout(boPendingRef.current);
        }
        setBoRunning(true);
        boPendingRef.current = setTimeout(() => {
            boPendingRef.current = null;
            const top = runBayesOpt(inputs, boIter, Date.now() + 10_000, lockedWeightsRef.current, conjRateRangeRef.current, baseRateRangeRef.current);
            setBoResults(top);
            setBoRunning(false);
        }, 50);
    }
    function startBoLoop() {
        boLoopRef.current = true;
        boLoopInputsRef.current = inputs;
        setBoLooping(true);
        setBoLoopRound(0);
        setTimeout(boLoopStep, 50);
    }
    function boLoopStep() {
        if (!boLoopRef.current) {
            setBoLooping(false);
            return;
        }
        const top = randomSearch(boLoopInputsRef.current, searchIter, Date.now() + 10_000, 0.50, lockedWeightsRef.current, conjRateRangeRef.current, baseRateRangeRef.current);
        const best = top[0];
        boLoopInputsRef.current = best.inputs;
        setBoResults(top);
        setInputs(best.inputs);
        setOverridesText(JSON.stringify(best.inputs.cardWeightOverrides, null, 2));
        setBoLoopRound((n) => n + 1);
        setTimeout(boLoopStep, 50);
    }
    function stopBoLoop() {
        boLoopRef.current = false;
        // setBoLooping(false) happens when the next boLoopStep fires and sees the flag
    }
    function applyResult(r: SearchResult) {
        setInputs(r.inputs);
        setOverridesText(JSON.stringify(r.inputs.cardWeightOverrides, null, 2));
        setOverridesError(null);
    }
    function reset() {
        const d = activePreset === 'starter' ? defaultStarterInputs() : defaultInputs();
        setInputs(d);
        setOverridesText(JSON.stringify(d.cardWeightOverrides, null, 2));
        setOverridesError(null);
        setSearchResults(null);
        setBoResults(null);
        boLoopRef.current = false;
        setBoLooping(false);
        setBoLoopRound(0);
    }

    const weightSum = Object.values(inputs.levelWeights).reduce((a, b) => a + b, 0);
    const evRatio = evaluation.rawPackEV / inputs.packPrice;

    return (
        <main className="h-dvh overflow-hidden text-slate-100">
            <div className="h-full max-w-screen-2xl mx-auto grid lg:grid-cols-[20rem_minmax(0,1fr)]">

                {/* ── LEFT: Inputs ─────────────────────────────────── */}
                <aside className="flex flex-col overflow-y-auto border-r border-slate-700/40">
                    <div className="p-3 flex flex-col gap-3">

                        {/* Header */}
                        <div className={`${panel} p-3.5`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div>
                                    <p className={eyebrow}>Market</p>
                                    <h1 className="text-lg font-bold text-white m-0 mt-0.5 leading-tight">Simulation</h1>
                                </div>
                                <span className={`shrink-0 px-2.5 py-1 rounded-full border text-xs font-bold tabular-nums ${
                                    evaluation.passAll
                                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                        : 'bg-yellow-500/10 border-yellow-500/25 text-yellow-300'
                                }`}>
                                    {evaluation.score}<span className="text-slate-500 font-normal mx-0.5">/</span>{evaluation.activeTargetCount}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2.5 leading-snug">
                                Calibrate fair prices vs targets (±{(TOLERANCE * 100).toFixed(0)}%). Run search to find optimal params.
                            </p>
                            <div className="flex gap-1.5 flex-wrap">
                                <button onClick={() => navTo('/')} className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg bg-white/5 border border-slate-700/50 hover:border-slate-500 transition-colors">← App</button>
                                <button type="button" onClick={reset} className="ml-auto text-xs text-slate-500 hover:text-slate-300 px-2.5 py-1 rounded-lg hover:bg-white/5 border border-transparent hover:border-slate-700/50 transition-colors">Reset</button>
                            </div>
                        </div>

                        {/* Pack settings */}
                        <div className={`${panel} p-3.5 grid gap-2.5`}>
                            <div className="flex items-center justify-between">
                                <h2 className={secTitle}>Pack</h2>
                                <div className="flex gap-1">
                                    {PACK_PRESETS_SIM.map((p) => (
                                        <button key={p.id} type="button" onClick={() => switchPreset(p.id)}
                                            className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                                                activePreset === p.id
                                                    ? 'bg-indigo-500/25 border-indigo-500/50 text-indigo-200'
                                                    : 'bg-white/5 border-slate-700/50 hover:border-slate-500 text-slate-400 hover:text-slate-200'
                                            }`}>
                                            {p.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <CompactField label="Price (gp)">
                                    <input type="number" value={inputs.packPrice} step={100}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('packPrice', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                                <CompactField label="Cards / pack">
                                    <input type="number" value={inputs.cardsInPack} min={1} step={1}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('cardsInPack', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                                <CompactField label="Conj rate %">
                                    <input type="number" value={inputs.conjurationRate} min={0} max={100} step={1}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('conjurationRate', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                                <CompactField label="Base rate">
                                    <input type="number" value={inputs.baseRate} min={0.1} max={2} step={0.01}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('baseRate', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                            </div>
                            {/* Search ranges */}
                            <div className="grid gap-1.5 pt-0.5 border-t border-slate-700/40">
                                <p className="text-xs text-slate-600 uppercase tracking-wider">Search ranges</p>
                                {([
                                    ['Conj %', conjRateRange, (v: [number, number]) => { setConjRateRange(v); conjRateRangeRef.current = v; }, 0, 100, 1],
                                    ['Base rate', baseRateRange, (v: [number, number]) => { setBaseRateRange(v); baseRateRangeRef.current = v; }, 0.05, 4, 0.05],
                                ] as const).map(([label, range, setRange, min, max, step]) => (
                                    <div key={label} className="flex items-center gap-1.5 text-xs">
                                        <span className="w-16 shrink-0 text-slate-500">{label}</span>
                                        <input type="number" value={range[0]} min={min} max={range[1]} step={step}
                                            onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v) && v < range[1]) setRange([v, range[1]]); }}
                                            className={inp + ' py-0.5 px-1.5 text-xs text-right font-mono flex-1'} />
                                        <span className="text-slate-600 shrink-0">–</span>
                                        <input type="number" value={range[1]} min={range[0]} max={max} step={step}
                                            onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v) && v > range[0]) setRange([range[0], v]); }}
                                            className={inp + ' py-0.5 px-1.5 text-xs text-right font-mono flex-1'} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Level weights */}
                        <div className={`${panel} p-3.5 grid gap-2.5`}>
                            <div className="flex items-center justify-between">
                                <h2 className={secTitle}>Level weights</h2>
                                <span className={`text-xs font-mono ${Math.abs(weightSum - 100) > 0.5 ? 'text-yellow-400' : 'text-slate-600'}`}>
                                    Σ {weightSum.toFixed(1)}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                {spellLevels.map((lvl) => {
                                    const isLocked = !!lockedWeights[lvl];
                                    return (
                                        <div key={lvl} className="flex items-center gap-1 text-xs">
                                            <span className={`w-10 shrink-0 ${RARITY_TEXT[LEVEL_TO_RARITY[lvl]]}`}>{LEVEL_LABELS[lvl]}</span>
                                            <input type="number" value={inputs.levelWeights[lvl]} step={0.01} min={0}
                                                disabled={isLocked}
                                                onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) updateWeight(lvl, v); }}
                                                className={inp + ' py-0.5 px-1.5 text-xs text-right font-mono flex-1' + (isLocked ? ' opacity-40 cursor-not-allowed' : '')} />
                                            <button type="button" onClick={() => toggleLock(lvl)}
                                                title={isLocked ? 'Unlock' : 'Lock'}
                                                className={`shrink-0 rounded p-0.5 transition-colors ${isLocked ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-slate-400'}`}>
                                                {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Variants */}
                        <div className={`${panel} p-3.5 grid gap-2.5`}>
                            <h2 className={secTitle}>Variants</h2>
                            <div className="grid grid-cols-2 gap-2">
                                <CompactField label="Shiny chance">
                                    <input type="number" value={inputs.shinyChance} min={0} max={1} step={0.005}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('shinyChance', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                                <CompactField label="E[shiny ×]">
                                    <input type="number" value={inputs.shinyMultiplierAvg} min={1} step={0.05}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('shinyMultiplierAvg', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                                <CompactField label="Auto chance">
                                    <input type="number" value={inputs.autographChance} min={0} max={1} step={0.005}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('autographChance', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                                <CompactField label="E[auto ×] non-leg">
                                    <input type="number" value={inputs.autoMultiplierAvg} min={1} step={0.05}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('autoMultiplierAvg', v); }}
                                        className={inp + ' py-1 px-2 text-xs text-right font-mono'} />
                                </CompactField>
                            </div>
                            <label className="flex items-center gap-2 text-xs">
                                <span className="text-slate-400 flex-1">E[auto ×] legendary</span>
                                <input type="number" value={inputs.autoLegMultiplierAvg} min={1} step={0.05}
                                    onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('autoLegMultiplierAvg', v); }}
                                    className={inp + ' w-24 py-1 px-2 text-xs text-right font-mono'} />
                            </label>
                        </div>

                        {/* Spell overrides */}
                        <div className={`${panel} p-3.5 grid gap-2.5`}>
                            <h2 className={secTitle}>Spell overrides</h2>
                            <label className="flex items-center gap-2 text-xs">
                                <span className="text-amber-300/80 flex-1">True Resurrection</span>
                                <input type="number" value={inputs.cardWeightOverrides['9-True Resurrection-Necromancy'] ?? 1}
                                    min={0.001} max={5} step={0.005}
                                    onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('cardWeightOverrides', { ...inputs.cardWeightOverrides, '9-True Resurrection-Necromancy': v }); }}
                                    className={inp + ' w-24 py-1 px-2 text-xs text-right font-mono'} />
                            </label>
                            <label className="flex items-center gap-2 text-xs">
                                <span className="text-amber-300/80 flex-1">Wish</span>
                                <input type="number" value={inputs.cardWeightOverrides['9-Wish-Conjuration1'] ?? 1}
                                    min={0.001} max={5} step={0.005}
                                    onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) update('cardWeightOverrides', { ...inputs.cardWeightOverrides, '9-Wish-Conjuration1': v }); }}
                                    className={inp + ' w-24 py-1 px-2 text-xs text-right font-mono'} />
                            </label>
                            <details>
                                <summary className="text-xs text-slate-500 cursor-pointer select-none hover:text-slate-400 transition-colors">▸ Edit all as JSON</summary>
                                <div className="mt-1.5 grid gap-1">
                                    <textarea value={overridesText} onChange={(e) => setOverridesText(e.target.value)}
                                        onBlur={commitOverrides} rows={5}
                                        className={inp + ' font-mono text-xs'} />
                                    {overridesError && <p className="text-xs text-red-400">JSON error: {overridesError}</p>}
                                </div>
                            </details>
                        </div>

                    </div>
                </aside>

                {/* ── RIGHT: Results ─────────────────────────────────── */}
                <section className="overflow-y-auto">
                    <div className="p-3 flex flex-col gap-3">

                        {/* Search controls */}
                        <div className={`${panel} p-4 grid grid-cols-1 sm:grid-cols-2 gap-4`}>
                            <div className="grid gap-2">
                                <h2 className={secTitle}>Random search</h2>
                                <label className="flex items-center gap-2 text-xs">
                                    <span className="text-slate-400 flex-1">Iterations</span>
                                    <input type="number" value={searchIter} min={100} max={50_000} step={500}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) setSearchIter(v); }}
                                        className={inp + ' w-24 py-1 px-2 text-xs text-right font-mono'} />
                                </label>
                                <div className="flex gap-1.5">
                                    <button type="button" onClick={runSearch} disabled={searching || boLooping}
                                        className="flex-1 rounded-lg px-3 py-2 bg-gradient-to-br from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-xs font-semibold disabled:opacity-50 transition-all">
                                        {searching ? '↻ Running…' : `Run ${searchIter.toLocaleString()}`}
                                    </button>
                                    {boLooping ? (
                                        <button type="button" onClick={stopBoLoop}
                                            className="flex-1 rounded-lg px-3 py-2 bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold transition-colors">
                                            ■ Stop
                                        </button>
                                    ) : (
                                        <button type="button" onClick={startBoLoop} disabled={searching || boRunning}
                                            className="flex-1 rounded-lg px-3 py-2 bg-gradient-to-br from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold disabled:opacity-50 transition-all">
                                            Loop ∞
                                        </button>
                                    )}
                                </div>
                                {boLooping && (
                                    <p className="text-xs text-emerald-400 font-mono">
                                        Round {boLoopRound} · {boResults?.[0]
                                            ? `${boResults[0].eval.score}/${boResults[0].eval.activeTargetCount} · SSE ${boResults[0].sse.toFixed(3)}`
                                            : '…'}
                                    </p>
                                )}
                            </div>
                            <div className="grid gap-2 sm:border-l border-slate-700/40 sm:pl-4">
                                <h2 className={secTitle}>Bayesian opt</h2>
                                <label className="flex items-center gap-2 text-xs">
                                    <span className="text-slate-400 flex-1">BO iterations</span>
                                    <input type="number" value={boIter} min={10} max={200} step={10}
                                        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) setBoIter(v); }}
                                        className={inp + ' w-24 py-1 px-2 text-xs text-right font-mono'} />
                                </label>
                                <button type="button" onClick={runBO} disabled={boRunning || boLooping}
                                    className="rounded-lg px-3 py-2 bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold disabled:opacity-50 transition-all">
                                    {boRunning ? '↻ Optimising…' : `Run ${boIter} BO steps`}
                                </button>
                                <p className="text-xs text-slate-600">RBF-GP + UCB · {BO_DIM}D · {boIter + 10} evals/run</p>
                            </div>
                        </div>

                        {/* Pack EV comparison */}
                        <div className={`${panel} p-4`}>
                            <h2 className={`${secTitle} mb-3`}>Pack EV comparison</h2>
                            <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_3.5rem] gap-1 pb-1.5 mb-0.5 border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                                <span>Pack</span>
                                <span className="text-right">Price</span>
                                <span className="text-right">Raw EV</span>
                                <span className="text-right">EV/price</span>
                                <span className="text-right">+Variants</span>
                            </div>
                            {([['Starter', starterEval, 500, 'starter'], ['Advanced', advancedEval, 1000, 'advanced']] as const).map(([name, ev, price, presetId]) => {
                                const ratio = ev.rawPackEV / price;
                                const isActive = activePreset === presetId;
                                return (
                                    <div key={name} className={`grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_3.5rem] gap-1 items-center py-1.5 border-b border-slate-800/40 text-xs rounded transition-colors cursor-pointer hover:bg-white/3 ${
                                        isActive ? 'text-white' : 'text-slate-400'
                                    }`} onClick={() => switchPreset(presetId)}>
                                        <div className="flex items-center gap-1.5">
                                            {isActive && <span className="w-1 h-1 rounded-full bg-indigo-400 shrink-0" />}
                                            <span className="font-medium">{name}</span>
                                        </div>
                                        <span className="text-right font-mono">{fmtMoney(price)}</span>
                                        <span className={`text-right font-mono ${Math.abs(ratio - 1) < 0.05 ? 'text-emerald-300' : ratio > 1.05 ? 'text-sky-300' : 'text-red-300'}`}>
                                            {fmtMoney(ev.rawPackEV)}
                                        </span>
                                        <span className={`text-right font-mono ${Math.abs(ratio - 1) < 0.05 ? 'text-emerald-300' : ratio > 1.05 ? 'text-sky-300' : 'text-red-300'}`}>
                                            {ratio.toFixed(3)}×
                                        </span>
                                        <span className="text-right font-mono text-slate-400">{fmtMoney(ev.packEV)}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Pack EV check */}
                        <div className={`${panel} p-4`}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className={secTitle}>Pack EV check</h2>
                                <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border ${evaluation.evPass ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/25 text-red-300'}`}>
                                    {evaluation.evPass ? '● balanced' : '○ drifted'}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <Stat label="Pack price" value={fmtMoney(inputs.packPrice) + ' gp'} />
                                <Stat label="Raw EV" value={fmtMoney(evaluation.rawPackEV) + ' gp'}
                                    tone={Math.abs(evRatio - 1) < 0.001 ? 'good' : 'bad'}
                                    hint={`× ${evRatio.toFixed(3)}`} />
                                <Stat label="Variant EV" value={fmtMoney(evaluation.packEV) + ' gp'}
                                    hint={`× ${(evaluation.packEV / inputs.packPrice).toFixed(3)}`} />
                            </div>
                        </div>

                        {/* Price targets */}
                        <div className={`${panel} p-4`}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className={secTitle}>Price targets</h2>
                                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${evaluation.passAll ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-yellow-500/10 border-yellow-500/25 text-yellow-300'}`}>
                                    {evaluation.score} / {evaluation.activeTargetCount} pass
                                </span>
                            </div>
                            <div>
                                <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_4rem_1.25rem] gap-1 pb-1.5 mb-0.5 border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                                    <span>Target</span>
                                    <span className="text-right">Goal</span>
                                    <span className="text-right">Fair</span>
                                    <span className="text-right">Δ%</span>
                                    <span className="text-center">Δ bar</span>
                                    <span />
                                </div>
                                {evaluation.targets.map((t) => (
                                    <div key={t.label} className={`grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_4rem_1.25rem] gap-1 items-center py-1 border-b border-slate-800/40 text-xs rounded transition-colors ${
                                        t.excluded ? 'opacity-35' : 'hover:bg-white/3'
                                    }`}>
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RARITY_DOT[t.targetRarity] ?? 'bg-slate-400'}`} />
                                            <span className="text-slate-200 truncate">{t.label}</span>
                                        </div>
                                        <span className="text-right font-mono text-slate-600">{fmtMoney(t.targetPrice)}</span>
                                        {t.excluded ? (
                                            <>
                                                <span className="text-right font-mono text-slate-700">—</span>
                                                <span className="text-right font-mono text-slate-700">N/A</span>
                                                <div />
                                                <span className="text-center text-slate-700">—</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className={`text-right font-mono ${t.pass ? 'text-emerald-300' : 'text-red-300'}`}>{fmtMoney(t.avgFair)}</span>
                                                <span className={`text-right font-mono ${t.pass ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(t.deltaPct)}</span>
                                                <DeltaBar pct={t.deltaPct} pass={t.pass} />
                                                <span className={`text-center ${t.pass ? 'text-emerald-400' : 'text-red-400'}`}>{t.pass ? '●' : '○'}</span>
                                            </>
                                        )}
                                    </div>
                                ))}
                                <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_4rem_1.25rem] gap-1 items-center py-1 text-xs border-t-2 border-slate-600/50 mt-0.5">
                                    <span className="text-slate-400">Variant EV ≈ Raw EV</span>
                                    <span className="text-right font-mono text-slate-600">{fmtMoney(evaluation.rawPackEV)}</span>
                                    <span className={`text-right font-mono ${evaluation.evPass ? 'text-emerald-300' : 'text-red-300'}`}>{fmtMoney(evaluation.packEV)}</span>
                                    <span className={`text-right font-mono ${evaluation.evPass ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(evaluation.packEV / evaluation.rawPackEV - 1)}</span>
                                    <DeltaBar pct={evaluation.packEV / evaluation.rawPackEV - 1} pass={evaluation.evPass} />
                                    <span className={`text-center ${evaluation.evPass ? 'text-emerald-400' : 'text-red-400'}`}>{evaluation.evPass ? '●' : '○'}</span>
                                </div>
                            </div>
                        </div>

                        {searchResults && <ResultsCards results={searchResults} title="Random search — top 10" onApply={applyResult} />}
                        {boResults && <ResultsCards results={boResults} title="Bayesian opt — top 10" onApply={applyResult} />}

                        <div className={`${panel} px-4 py-2.5`}>
                            <p className="text-xs text-slate-600">
                                {spellCards.length} cards · Random search: uniform ±25% over bounds · BO: RBF-GP + UCB · {BO_DIM}D
                            </p>
                        </div>

                    </div>
                </section>
            </div>
        </main>
    );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Helper components
 * ───────────────────────────────────────────────────────────────────────── */

function CompactField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid gap-0.5">
            <span className="text-xs text-slate-500">{label}</span>
            {children}
        </div>
    );
}

function DeltaBar({ pct, pass }: { pct: number; pass: boolean }) {
    const clamped = Math.max(-1, Math.min(1, pct));
    const width = Math.abs(clamped) * 50;
    const isRight = clamped >= 0;
    return (
        <div className="flex items-center px-0.5">
            <div className="w-full h-2 bg-slate-800 rounded-full relative overflow-hidden">
                <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600 -translate-x-px" />
                <div
                    className={`absolute inset-y-0 rounded-full transition-all duration-200 ${pass ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ left: isRight ? '50%' : `${50 - width}%`, width: `${width}%` }}
                />
            </div>
        </div>
    );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad'; hint?: string }) {
    const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-100';
    return (
        <div className="rounded-xl bg-white/5 border border-slate-700/50 px-3 py-2.5">
            <div className="text-xs text-slate-500 mb-0.5">{label}</div>
            <div className={`text-sm font-bold font-mono ${color} leading-tight`}>{value}</div>
            {hint && <div className="text-xs text-slate-600 font-mono mt-0.5">{hint}</div>}
        </div>
    );
}

function ResultsCards({ results, title, onApply }: {
    results: SearchResult[];
    title: string;
    onApply: (r: SearchResult) => void;
}) {
    const [expanded, setExpanded] = useState<number | null>(null);
    const globalMax = results.length > 0
        ? Math.max(1, ...results.flatMap((r) => spellLevels.map((l) => r.inputs.levelWeights[l])))
        : 1;

    return (
        <div className={`${panel} p-4`}>
            <h2 className={`${secTitle} mb-3`}>{title}</h2>
            <div className="grid grid-cols-[1.5rem_3rem_4rem_3.5rem_4.5rem_1fr_5rem] gap-2 px-3 pb-1.5 mb-1 border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                <span>#</span>
                <span>Pass</span>
                <span>SSE</span>
                <span>Conj</span>
                <span>Base</span>
                <span>Weights L0→L9</span>
                <span />
            </div>
            <div className="space-y-1">
                {results.map((r, i) => (
                    <div key={i}
                        className={`rounded-xl border transition-all cursor-pointer select-none ${expanded === i ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-slate-700/40 hover:border-slate-600/50 hover:bg-white/3'}`}
                        onClick={() => setExpanded(expanded === i ? null : i)}
                    >
                        {/* Summary row */}
                        <div className="grid grid-cols-[1.5rem_3rem_4rem_3.5rem_4.5rem_1fr_5rem] gap-2 items-center px-3 py-2 text-xs">
                            <span className="text-slate-500 font-mono">{i + 1}</span>
                            <span className={`font-mono font-semibold ${r.eval.passAll ? 'text-emerald-300' : r.eval.score >= r.eval.activeTargetCount - 2 ? 'text-yellow-300' : 'text-slate-300'}`}>
                                {r.eval.score}/{r.eval.activeTargetCount}
                            </span>
                            <span className="font-mono text-slate-400">{r.sse.toFixed(3)}</span>
                            <span className="font-mono text-slate-300">{r.inputs.conjurationRate}%</span>
                            <span className="font-mono text-slate-300">{r.inputs.baseRate.toFixed(3)}</span>
                            {/* Mini weight bar chart */}
                            <div className="flex items-end gap-px h-4">
                                {spellLevels.map((l) => {
                                    const w = r.inputs.levelWeights[l];
                                    const h = Math.max(1, Math.round((w / globalMax) * 14));
                                    return (
                                        <div key={l} className="flex-1 flex flex-col justify-end">
                                            <div className={`w-full rounded-sm opacity-75 ${RARITY_DOT[LEVEL_TO_RARITY[l]] ?? 'bg-slate-400'}`} style={{ height: `${h}px` }} />
                                        </div>
                                    );
                                })}
                            </div>
                            <button type="button"
                                onClick={(e) => { e.stopPropagation(); onApply(r); }}
                                className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 border border-indigo-500/30 transition-colors whitespace-nowrap">
                                Apply
                            </button>
                        </div>
                        {/* Expanded detail */}
                        {expanded === i && (
                            <div className="px-3 pb-3 border-t border-slate-700/30">
                                <div className="grid grid-cols-5 gap-1 pt-2.5 mb-3">
                                    {spellLevels.map((l) => (
                                        <div key={l} className="text-center">
                                            <div className={`text-xs mb-0.5 ${RARITY_TEXT[LEVEL_TO_RARITY[l]]}`}>
                                                {l === 0 ? 'C' : `L${l}`}
                                            </div>
                                            <div className="font-mono text-xs text-slate-200">{r.inputs.levelWeights[l].toFixed(1)}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                    <div className="flex justify-between"><span className="text-slate-500">Shiny %</span><span className="font-mono text-slate-300">{(r.inputs.shinyChance * 100).toFixed(2)}%</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Shiny ×</span><span className="font-mono text-slate-300">{r.inputs.shinyMultiplierAvg.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Auto %</span><span className="font-mono text-slate-300">{(r.inputs.autographChance * 100).toFixed(2)}%</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Auto ×</span><span className="font-mono text-slate-300">{r.inputs.autoMultiplierAvg.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">aLeg ×</span><span className="font-mono text-slate-300">{r.inputs.autoLegMultiplierAvg.toFixed(3)}</span></div>
                                    <div className="flex justify-between"><span className="text-amber-300/60">Wish ×</span><span className="font-mono text-slate-300">{(r.inputs.cardWeightOverrides[WISH_FILE] ?? 1).toFixed(3)}</span></div>
                                    <div className="flex justify-between col-span-2"><span className="text-amber-300/60">True Res ×</span><span className="font-mono text-slate-300">{(r.inputs.cardWeightOverrides[TRUEREZ_FILE] ?? 1).toFixed(3)}</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
