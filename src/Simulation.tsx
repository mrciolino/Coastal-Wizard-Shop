import { useMemo, useRef, useState } from 'react';
import { spellCards, levelWeights as defaultLevelWeights, currencyPerPack, cardsPerPack, conjurationChance, type SpellLevel, spellLevels } from './utils/spells';
import { DEFAULT_VOLATILITY } from './utils/pricing';
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
        packPrice: currencyPerPack,
        cardsInPack: cardsPerPack,
        conjurationRate: Math.round(conjurationChance * 100),
        levelWeights: { ...defaultLevelWeights },
        baseRate: DEFAULT_VOLATILITY.baseRate,
        shinyChance: 0.02,
        autographChance: 0.04278,
        shinyMultiplierAvg: DEFAULT_VOLATILITY.shinyMin + DEFAULT_VOLATILITY.shinyRange / 2,
        autoMultiplierAvg: DEFAULT_VOLATILITY.autoMin + DEFAULT_VOLATILITY.autoRange / 2,
        autoLegMultiplierAvg: DEFAULT_VOLATILITY.autoLegMin + DEFAULT_VOLATILITY.autoLegRange / 2,
        cardWeightOverrides: {
            '9-True Resurrection-Necromancy': 0.5767,
            '9-Wish-Conjuration1': 0.06525,
        },
    };
}

type TargetEval = {
    label: string;
    targetRarity: string;
    targetPrice: number;
    avgFair: number;
    avgWithVariants: number;
    cardCount: number;
    pass: boolean;
    deltaPct: number;
};

type EvalResult = {
    targets: TargetEval[];
    packEV: number;
    rawPackEV: number;
    score: number;
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

    const avgPDraw = cards.length > 0 ? 1 / cards.length : 1;

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
        const avgFair = group.length > 0 ? group.reduce((s, r) => s + r.fairBase, 0) / group.length : 0;
        const avgWithVariants = group.length > 0 ? group.reduce((s, r) => s + r.fairWithVariants, 0) / group.length : 0;
        const deltaPct = (avgFair - t.price) / t.price;
        return {
            label: t.label,
            targetRarity: t.rarity,
            targetPrice: t.price,
            avgFair,
            avgWithVariants,
            cardCount: group.length,
            pass: Math.abs(deltaPct) <= TOLERANCE,
            deltaPct,
        };
    });

    const rawPackEV = rows.reduce((s, r) => s + r.pDraw * r.fair, 0) * inputs.cardsInPack;
    const packEV = rows.reduce((s, r) => s + r.pDraw * r.fairBase * variantUplift(r.card.rarity, inputs), 0) * inputs.cardsInPack;
    const evPass = rawPackEV > 0 && Math.abs(packEV / rawPackEV - 1) <= TOLERANCE;
    const score = targets.filter((t) => t.pass).length + (evPass ? 1 : 0);
    return { targets, packEV, rawPackEV, score, passAll: score === PRICE_TARGETS.length + 1, evPass };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Random search
 * ───────────────────────────────────────────────────────────────────────── */

type SearchResult = {
    inputs: SimInputs;
    eval: EvalResult;
    sse: number; // sum-squared error of log(avgFair / target)
};

/** Returns a value uniformly within ±25% of `base`, clamped to [lo, hi]. */
function jitter(base: number, lo: number, hi: number): number {
    const v = base * (0.75 + Math.random() * 0.5);
    return Math.min(hi, Math.max(lo, v));
}

function randomSearch(base: SimInputs, iterations: number, deadline: number): SearchResult[] {
    const results: SearchResult[] = [];
    for (let i = 0; i < iterations; i++) {
        if (Date.now() > deadline) break;
        const candidate: SimInputs = {
            ...base,
            conjurationRate: Math.round(40 + Math.random() * 50), // 40–90
            baseRate: 0.6 + Math.random() * 0.4,                  // 0.6–1.0
            levelWeights: {
                0: 10 + Math.random() * 40,   // 10–50
                1: 10 + Math.random() * 35,   // 10–45
                2: 5 + Math.random() * 30,    // 5–35
                3: 3 + Math.random() * 25,    // 3–28
                4: 1 + Math.random() * 20,    // 1–21
                5: 1 + Math.random() * 18,    // 1–19
                6: 0.3 + Math.random() * 10,  // 0.3–10.3
                7: 0.1 + Math.random() * 7,   // 0.1–7.1
                8: 0.05 + Math.random() * 5,  // 0.05–5.05
                9: 0.05 + Math.random() * 5,  // 0.05–5.05
            },
            // Variants: ±25% of current value, clamped to allowed ranges
            shinyChance: jitter(base.shinyChance, 0.02, 0.20),
            autographChance: jitter(base.autographChance, 0.02, 0.20),
            shinyMultiplierAvg: jitter(base.shinyMultiplierAvg, 1, 5),
            autoMultiplierAvg: jitter(base.autoMultiplierAvg, 1, 5),
            autoLegMultiplierAvg: jitter(base.autoLegMultiplierAvg, 1, 5),
            // Card weight overrides: ±25% of current value, clamped to [0.001, 5]
            cardWeightOverrides: {
                ...base.cardWeightOverrides,
                [WISH_FILE]: jitter(base.cardWeightOverrides[WISH_FILE] ?? 1, 0.001, 5),
                [TRUEREZ_FILE]: jitter(base.cardWeightOverrides[TRUEREZ_FILE] ?? 1, 0.001, 5),
            },
        };
        // Normalize weights to sum to 100 (preserves ratios)
        const sum = Object.values(candidate.levelWeights).reduce((a, b) => a + b, 0);
        if (sum > 0) {
            for (const k of Object.keys(candidate.levelWeights) as unknown as SpellLevel[]) {
                candidate.levelWeights[k] = (candidate.levelWeights[k] / sum) * 100;
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

function decodeVector(vec: number[], base: SimInputs): SimInputs {
    const raw = [2,3,4,5,6,7,8,9,10,11].map((i) => boDenorm(vec[i], i));
    const wSum = raw.reduce((a, v) => a + v, 0) || 1;
    const s = 100 / wSum;
    return {
        ...base,
        conjurationRate:      Math.round(boDenorm(vec[0], 0)),
        baseRate:             boDenorm(vec[1], 1),
        levelWeights: {
            0: raw[0] * s,
            1: raw[1] * s,
            2: raw[2] * s,
            3: raw[3] * s,
            4: raw[4] * s,
            5: raw[5] * s,
            6: raw[6] * s,
            7: raw[7] * s,
            8: raw[8] * s,
            9: raw[9] * s,
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

function runBayesOpt(base: SimInputs, boIterations: number, deadline: number): SearchResult[] {
    const INIT_N  = 10;   // LHS seed evaluations
    const LS      = 0.3;  // RBF length scale in [0,1] space
    const NOISE   = 0.01; // diagonal noise for numerical stability
    const BETA    = 2.0;  // UCB exploration weight
    const N_CANDS = 300;  // acquisition-maximisation candidates per step

    const allResults: SearchResult[] = [];

    function evalVec(vec: number[]): SearchResult {
        const inp = decodeVector(vec, base);
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
}

/* ─────────────────────────────────────────────────────────────────────────────
 * UI
 * ───────────────────────────────────────────────────────────────────────── */

const LEVEL_LABELS: Record<number, string> = {
    0: 'Cantrip', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4',
    5: 'Level 5', 6: 'Level 6', 7: 'Level 7', 8: 'Level 8', 9: 'Level 9',
};

function fmtMoney(n: number): string {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
    return Math.round(n).toLocaleString();
}

function fmtPct(n: number): string {
    return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

export default function Simulation() {
    const [inputs, setInputs] = useState<SimInputs>(defaultInputs);
    const [overridesText, setOverridesText] = useState<string>(
        JSON.stringify(defaultInputs().cardWeightOverrides, null, 2),
    );
    const [overridesError, setOverridesError] = useState<string | null>(null);
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
            const top = randomSearch(inputs, searchIter, Date.now() + 10_000);
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
            const top = runBayesOpt(inputs, boIter, Date.now() + 10_000);
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
        const top = runBayesOpt(boLoopInputsRef.current, boIter, Date.now() + 10_000);
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
        const d = defaultInputs();
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
        <main className="overflow-y-auto lg:h-screen lg:overflow-hidden bg-slate-950 text-slate-100 p-4">
            <div className="max-w-screen-2xl mx-auto lg:h-full grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">

                {/* LEFT: Inputs */}
                <aside className="grid gap-3 content-start lg:overflow-y-auto">
                    <header className={`${panel} p-4`}>
                        <p className={eyebrow}>Marketplace</p>
                        <h1 className="text-xl font-bold m-0 mt-1">Simulation</h1>
                        <p className="text-xs text-slate-400 mt-1 mb-0">
                            Tweak inputs, watch per-level prices vs targets (±{(TOLERANCE * 100).toFixed(0)}%).
                        </p>
                        <div className="flex gap-2 mt-3">
                            <a href="/" className="text-xs text-indigo-400 hover:underline">← Back to app</a>
                            <button type="button" onClick={reset} className="ml-auto text-xs text-slate-400 hover:text-slate-200">Reset to defaults</button>
                        </div>
                    </header>

                    <section className={`${panel} p-4 grid gap-3`}>
                        <h2 className={secTitle}>Pack</h2>
                        <NumberRow label="Pack price (gp)" value={inputs.packPrice} onChange={(v) => update('packPrice', v)} step={100} />
                        <NumberRow label="Cards / pack" value={inputs.cardsInPack} onChange={(v) => update('cardsInPack', v)} step={1} min={1} />
                        <NumberRow label="Conjuration rate %" value={inputs.conjurationRate} onChange={(v) => update('conjurationRate', v)} step={1} min={0} max={100} />
                        <NumberRow label="Base rate" value={inputs.baseRate} onChange={(v) => update('baseRate', v)} step={0.01} min={0.1} max={2} />
                    </section>

                    <section className={`${panel} p-4 grid gap-3`}>
                        <div className="flex justify-between items-baseline">
                            <h2 className={secTitle}>Level weights</h2>
                            <span className={`text-[10px] ${Math.abs(weightSum - 100) > 0.5 ? 'text-yellow-400' : 'text-slate-500'}`}>
                                Σ {weightSum.toFixed(2)}
                            </span>
                        </div>
                        {spellLevels.map((lvl) => (
                            <NumberRow
                                key={lvl}
                                label={LEVEL_LABELS[lvl]}
                                value={inputs.levelWeights[lvl]}
                                onChange={(v) => updateWeight(lvl, v)}
                                step={0.05}
                                min={0}
                            />
                        ))}
                    </section>

                    <section className={`${panel} p-4 grid gap-3`}>
                        <h2 className={secTitle}>Variants</h2>
                        <NumberRow label="Shiny chance" value={inputs.shinyChance} onChange={(v) => update('shinyChance', v)} step={0.005} min={0} max={1} />
                        <NumberRow label="Autograph chance" value={inputs.autographChance} onChange={(v) => update('autographChance', v)} step={0.005} min={0} max={1} />
                        <NumberRow label="E[shiny ×]" value={inputs.shinyMultiplierAvg} onChange={(v) => update('shinyMultiplierAvg', v)} step={0.05} min={1} />
                        <NumberRow label="E[auto ×] non-leg" value={inputs.autoMultiplierAvg} onChange={(v) => update('autoMultiplierAvg', v)} step={0.05} min={1} />
                        <NumberRow label="E[auto ×] legendary" value={inputs.autoLegMultiplierAvg} onChange={(v) => update('autoLegMultiplierAvg', v)} step={0.05} min={1} />
                    </section>

                    <section className={`${panel} p-4 grid gap-3`}>
                        <h2 className={secTitle}>Spell weight overrides</h2>
                        <NumberRow
                            label="True Resurrection (L9)"
                            value={inputs.cardWeightOverrides['9-True Resurrection-Necromancy'] ?? 1}
                            onChange={(v) => update('cardWeightOverrides', { ...inputs.cardWeightOverrides, '9-True Resurrection-Necromancy': v })}
                            step={0.005}
                            min={0.001}
                            max={5}
                        />
                        <NumberRow
                            label="Wish (L9)"
                            value={inputs.cardWeightOverrides['9-Wish-Conjuration1'] ?? 1}
                            onChange={(v) => update('cardWeightOverrides', { ...inputs.cardWeightOverrides, '9-Wish-Conjuration1': v })}
                            step={0.005}
                            min={0.001}
                            max={5}
                        />
                        <details className="mt-1">
                            <summary className="text-[11px] text-slate-500 cursor-pointer select-none">Advanced: edit all overrides as JSON</summary>
                            <div className="mt-2 grid gap-1">
                                <textarea
                                    value={overridesText}
                                    onChange={(e) => setOverridesText(e.target.value)}
                                    onBlur={commitOverrides}
                                    rows={6}
                                    className={inp + ' font-mono text-xs mt-1'}
                                />
                                {overridesError && <p className="text-xs text-red-400 m-0">JSON error: {overridesError}</p>}
                            </div>
                        </details>
                    </section>

                </aside>

                {/* RIGHT: Results */}
                <section className="grid gap-3 content-start lg:overflow-y-auto">

                    <div className={`${panel} p-4 grid grid-cols-1 sm:grid-cols-2 gap-4`}>
                        <div className="grid gap-3">
                            <h2 className={secTitle}>Random search</h2>
                            <NumberRow label="Iterations" value={searchIter} onChange={setSearchIter} step={500} min={100} max={50000} />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={runSearch}
                                    disabled={searching || boLooping}
                                    className="flex-1 rounded-xl px-3 py-2 bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold disabled:opacity-50"
                                >
                                    {searching ? 'Searching…' : `Run ${searchIter.toLocaleString()} trials`}
                                </button>
                                {boLooping ? (
                                    <button
                                        type="button"
                                        onClick={stopBoLoop}
                                        className="flex-1 rounded-xl px-3 py-2 bg-red-600/80 hover:bg-red-600 text-white text-sm font-semibold"
                                    >
                                        Stop
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={startBoLoop}
                                        disabled={searching || boRunning}
                                        className="flex-1 rounded-xl px-3 py-2 bg-gradient-to-br from-amber-500 to-orange-500 text-white text-sm font-semibold disabled:opacity-50"
                                    >
                                        Loop ∞
                                    </button>
                                )}
                            </div>
                            {boLooping && (
                                <p className="text-xs text-emerald-400 font-mono">
                                    Round {boLoopRound} — best: {boResults?.[0] ? `${boResults[0].eval.score}/${PRICE_TARGETS.length + 1} passes, SSE ${boResults[0].sse.toFixed(3)}` : '…'}
                                </p>
                            )}
                            <p className="text-xs text-slate-500">
                                Uniform sweep over bounds. <em>Loop</em> runs BO continuously, auto-applying the best result each round.
                            </p>
                        </div>
                        <div className="grid gap-3 sm:border-l border-slate-700/50 sm:pl-4">
                            <h2 className={secTitle}>Bayesian optimisation</h2>
                            <NumberRow label="BO iterations" value={boIter} onChange={setBoIter} step={10} min={10} max={200} />
                            <button
                                type="button"
                                onClick={runBO}
                                disabled={boRunning || boLooping}
                                className="rounded-xl px-3 py-2 bg-gradient-to-br from-emerald-500 to-teal-500 text-white text-sm font-semibold disabled:opacity-50"
                            >
                                {boRunning ? 'Optimising…' : `Run ${boIter} BO steps`}
                            </button>
                            <p className="text-xs text-slate-500">
                                RBF-GP surrogate + UCB acquisition over all {BO_DIM} parameters ({boIter + 10} evals per run).
                            </p>
                        </div>
                    </div>

                    <div className={`${panel} p-4 grid gap-3`}>
                        <h2 className={secTitle}>Pack EV check</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                            <Stat label="Pack price" value={fmtMoney(inputs.packPrice) + ' gp'} />
                            <Stat
                                label="Raw EV (sum pDraw·fair)"
                                value={fmtMoney(evaluation.rawPackEV) + ' gp'}
                                tone={Math.abs(evRatio - 1) < 0.001 ? 'good' : 'bad'}
                                hint={`× ${evRatio.toFixed(3)}`}
                            />
                            <Stat
                                label="Variant-adjusted EV"
                                value={fmtMoney(evaluation.packEV) + ' gp'}
                                hint={`× ${(evaluation.packEV / inputs.packPrice).toFixed(3)}`}
                            />
                        </div>
                        <p className="text-xs text-slate-500">
                            Raw EV is mathematically pinned to pack price. Variant EV shows total expected value once shiny/autograph variants are applied — anything above 1.00× means buyers come out ahead on average.
                        </p>
                    </div>

                    <div className={`${panel} p-4 grid gap-3`}>
                        <div className="flex items-baseline justify-between">
                            <h2 className={secTitle}>Per-level price targets</h2>
                            <span className={`text-xs font-semibold ${evaluation.passAll ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                {evaluation.score} / {PRICE_TARGETS.length + 1} pass
                            </span>
                        </div>
                        <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="text-xs text-slate-400 uppercase tracking-wider">
                                    <th className="text-left py-1">Target</th>
                                    <th className="text-left">Rarity</th>
                                    <th className="text-right">Target</th>
                                    <th className="text-right">Avg fair</th>
                                    <th className="text-right">Δ%</th>
                                    <th className="text-right">w/ variants</th>
                                    <th className="text-right">#</th>
                                    <th className="text-center">Pass</th>
                                </tr>
                            </thead>
                            <tbody>
                                {evaluation.targets.map((t) => (
                                    <tr key={t.label} className="border-t border-slate-700/40">
                                        <td className="py-1.5 text-slate-200 whitespace-nowrap">{t.label}</td>
                                        <td className="text-slate-300 capitalize">{t.targetRarity.replace('_', ' ')}</td>
                                        <td className="text-right font-mono text-slate-300">{fmtMoney(t.targetPrice)}</td>
                                        <td className={`text-right font-mono ${t.pass ? 'text-emerald-300' : 'text-red-300'}`}>{fmtMoney(t.avgFair)}</td>
                                        <td className={`text-right font-mono ${t.pass ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(t.deltaPct)}</td>
                                        <td className="text-right font-mono text-slate-400">{fmtMoney(t.avgWithVariants)}</td>
                                        <td className="text-right font-mono text-slate-500">{t.cardCount}</td>
                                        <td className="text-center">{t.pass ? '✓' : '✗'}</td>
                                    </tr>
                                ))}
                                <tr className="border-t-2 border-slate-600">
                                    <td className="py-1.5 text-slate-200 whitespace-nowrap">Variant EV ≈ Raw EV</td>
                                    <td className="text-slate-500">—</td>
                                    <td className="text-right font-mono text-slate-300">{fmtMoney(evaluation.rawPackEV)} gp</td>
                                    <td className={`text-right font-mono ${evaluation.evPass ? 'text-emerald-300' : 'text-red-300'}`}>{fmtMoney(evaluation.packEV)} gp</td>
                                    <td className={`text-right font-mono ${evaluation.evPass ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(evaluation.packEV / evaluation.rawPackEV - 1)}</td>
                                    <td className="text-slate-500">—</td>
                                    <td className="text-slate-500">—</td>
                                    <td className="text-center">{evaluation.evPass ? '✓' : '✗'}</td>
                                </tr>
                            </tbody>
                        </table>
                        </div>
                    </div>

                    {searchResults && <ResultsTable results={searchResults} title="Random search — top 10" onApply={applyResult} />}
                    {boResults && <ResultsTable results={boResults} title="Bayesian opt — top 10" onApply={applyResult} />}

                    <div className={`${panel} p-4`}>
                        <p className="text-xs text-slate-500">
                            Loaded {spellCards.length} cards. Random search: uniform over bounds (conj 40–90, base 0.6–1.0, level weights → 100).
                            Bayesian opt: RBF-GP surrogate + UCB acquisition over all {BO_DIM} parameters simultaneously.
                            Apply a top result and re-run either search to refine further.
                        </p>
                    </div>

                </section>
            </div>
        </main>
    );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────── */

function NumberRow({
    label, value, onChange, step = 1, min, max,
}: {
    label: string; value: number; onChange: (v: number) => void;
    step?: number; min?: number; max?: number;
}) {
    return (
        <label className="grid grid-cols-[1fr_6.5rem] items-center gap-2 text-xs">
            <span className="text-slate-300">{label}</span>
            <input
                type="number"
                value={value}
                onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (Number.isFinite(v)) onChange(v);
                }}
                step={step}
                min={min}
                max={max}
                className={inp + ' text-right font-mono'}
            />
        </label>
    );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad'; hint?: string }) {
    const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-100';
    return (
        <div className="rounded-xl bg-white/5 border border-slate-700/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
            <div className={`text-base font-bold font-mono ${color} mt-0.5`}>{value}</div>
            {hint && <div className="text-[10px] text-slate-500 font-mono mt-0.5">{hint}</div>}
        </div>
    );
}

function ResultsTable({ results, title, onApply }: {
    results: SearchResult[];
    title: string;
    onApply: (r: SearchResult) => void;
}) {
    return (
        <div className={`${panel} p-4`}>
            <h2 className={secTitle}>{title}</h2>
            <div className="overflow-x-auto mt-2">
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className="text-xs text-slate-400 uppercase tracking-wider">
                        <th className="text-left py-1">#</th>
                        <th className="text-right">Pass</th>
                        <th className="text-right">SSE</th>
                        <th className="text-right">conj%</th>
                        <th className="text-right">base</th>
                        <th className="text-right">L0</th>
                        <th className="text-right">L1</th>
                        <th className="text-right">L2</th>
                        <th className="text-right">L3</th>
                        <th className="text-right">L4</th>
                        <th className="text-right">L5</th>
                        <th className="text-right">L6</th>
                        <th className="text-right">L7</th>
                        <th className="text-right">L8</th>
                        <th className="text-right">L9</th>
                        <th className="text-right">shiny%</th>
                        <th className="text-right">auto%</th>
                        <th className="text-right">shiny×</th>
                        <th className="text-right">auto×</th>
                        <th className="text-right">aLeg×</th>
                        <th className="text-right">Wish</th>
                        <th className="text-right">TrueRes</th>
                        <th className="text-center">Apply</th>
                    </tr>
                </thead>
                <tbody>
                    {results.map((r, i) => (
                        <tr key={i} className="border-t border-slate-700/40">
                            <td className="py-1 text-slate-400">{i + 1}</td>
                            <td className={`text-right font-mono ${r.eval.passAll ? 'text-emerald-300' : 'text-slate-200'}`}>
                                {r.eval.score}/{PRICE_TARGETS.length + 1}
                            </td>
                            <td className="text-right font-mono text-slate-400">{r.sse.toFixed(3)}</td>
                            <td className="text-right font-mono">{r.inputs.conjurationRate}</td>
                            <td className="text-right font-mono">{r.inputs.baseRate.toFixed(3)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[0].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[1].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[2].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[3].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[4].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[5].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[6].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[7].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[8].toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.levelWeights[9].toFixed(2)}</td>
                            <td className="text-right font-mono">{(r.inputs.shinyChance * 100).toFixed(1)}%</td>
                            <td className="text-right font-mono">{(r.inputs.autographChance * 100).toFixed(1)}%</td>
                            <td className="text-right font-mono">{r.inputs.shinyMultiplierAvg.toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.autoMultiplierAvg.toFixed(2)}</td>
                            <td className="text-right font-mono">{r.inputs.autoLegMultiplierAvg.toFixed(2)}</td>
                            <td className="text-right font-mono">{(r.inputs.cardWeightOverrides[WISH_FILE] ?? 1).toFixed(3)}</td>
                            <td className="text-right font-mono">{(r.inputs.cardWeightOverrides[TRUEREZ_FILE] ?? 1).toFixed(3)}</td>
                            <td className="text-center">
                                <button
                                    type="button"
                                    onClick={() => onApply(r)}
                                    className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 border border-indigo-500/40"
                                >
                                    apply
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
        </div>
    );
}
