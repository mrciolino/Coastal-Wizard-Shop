import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { spellCards, type SpellLevel, spellLevels } from './utils/spells';
import { STARTER_PACK, ADVANCED_PACK, STARTER_LEVEL_WEIGHTS, ADVANCED_LEVEL_WEIGHTS, CARD_WEIGHT_OVERRIDES } from './utils/constants';
import { isAutographable } from './utils/format';
import { panel, inp, eyebrow, secTitle } from './components/tokens';
import SearchWorkerClass from './utils/searchWorker?worker';
import type { WorkerCard, WorkerInputs, WorkerResult, WorkerInitMessage } from './utils/searchWorkerTypes';

/* ─────────────────────────────────────────────────────────────────────────────
 * MARKET SIMULATOR
 * Standalone analysis page: tweak every input, see deterministic per-level fair
 * values, check against target prices, and run a random parameter search to
 * find combinations that hit all targets within ±20%.
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

const TOLERANCE = 0.20;            // per-target fair-value tolerance (±20%)
const CROSS_PACK_TOLERANCE = 0.30; // cross-pack avg divergence threshold

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
    evPass: boolean;  // variant EV within ±20% of raw EV
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
 * Cross-pack fair value computation
 * For each spell, compute the pack-implied base fair price. Returns 0 when
 * the spell's level has zero weight (not drawable from that pack).
 * ─────────────────────────────────────────────────────────────────────────── */
function computeSpellFairValues(inp: SimInputs): Map<string, number> {
    const conjRate = inp.conjurationRate / 100;
    const conjWeight = spellCards
        .filter((c) => c.pool === 'conjuration')
        .reduce((s, c) => s + (inp.levelWeights[c.level as SpellLevel] ?? 0) * (inp.cardWeightOverrides[c.fileName] ?? 1), 0);
    const stapleWeight = spellCards
        .filter((c) => c.pool === 'staple')
        .reduce((s, c) => s + (inp.levelWeights[c.level as SpellLevel] ?? 0) * (inp.cardWeightOverrides[c.fileName] ?? 1), 0);
    const drawableCount = spellCards.filter(
        (c) => (inp.levelWeights[c.level as SpellLevel] ?? 0) * (inp.cardWeightOverrides[c.fileName] ?? 1) > 0,
    ).length;
    const avgPDraw = drawableCount > 0 ? 1 / drawableCount : 1;
    const out = new Map<string, number>();
    for (const card of spellCards) {
        const pPool = card.pool === 'conjuration' ? conjRate : 1 - conjRate;
        const poolWeight = card.pool === 'conjuration' ? conjWeight : stapleWeight;
        const cardWt = (inp.levelWeights[card.level as SpellLevel] ?? 0) * (inp.cardWeightOverrides[card.fileName] ?? 1);
        const pDraw = poolWeight > 0 ? (pPool * cardWt) / poolWeight : 0;
        const fairRaw = pDraw > 0 ? (inp.packPrice / inp.cardsInPack) * (avgPDraw / pDraw) : 0;
        out.set(card.fileName, fairRaw > 0 ? Math.max(1, fairRaw * inp.baseRate) : 0);
    }
    return out;
}

type SearchResult = {
    inputs: SimInputs;
    eval: EvalResult;
    sse: number;
    crossPackDivPct: number; // avg abs divergence from reference pack (0 when no ref)
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Worker infrastructure
 *
 * Precomputed once at module load; sent to every worker on init.
 * ─────────────────────────────────────────────────────────────────────────── */

/** fileName, indexed by card position — used to convert to/from WorkerInputs. */
const CARD_FILE_NAMES = spellCards.map((c) => c.fileName);

const WORKER_CARDS: WorkerCard[] = spellCards.map((c) => ({
    level: c.level,
    isConj: c.pool === 'conjuration',
    isAutographable: c.rarity === 'rare' || c.rarity === 'legendary',
    isLegendary: c.rarity === 'legendary',
}));

const WORKER_WISH_IDX = spellCards.findIndex((c) => c.fileName === WISH_FILE);
const WORKER_TRUEREZ_IDX = spellCards.findIndex((c) => c.fileName === TRUEREZ_FILE);

/** For each PRICE_TARGET, the indices of matching cards in spellCards[]. */
const WORKER_TARGET_GROUPS: number[][] = PRICE_TARGETS.map((t) =>
    spellCards.flatMap((c, i) => (t.filter(c.fileName, c.level) ? [i] : [])),
);

/** Number of parallel workers. Leave one core free for the UI thread. */
const NUM_WORKERS = typeof navigator !== 'undefined'
    ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
    : 3;

const WORKER_INIT_MSG: WorkerInitMessage = {
    type: 'init',
    cards: WORKER_CARDS,
    wishIdx: WORKER_WISH_IDX,
    trueRezIdx: WORKER_TRUEREZ_IDX,
    targetGroupIndices: WORKER_TARGET_GROUPS,
};

// ── Serialisation helpers ──────────────────────────────────────────────────

function toWorkerInputs(inp: SimInputs): WorkerInputs {
    return {
        packPrice: inp.packPrice,
        cardsInPack: inp.cardsInPack,
        conjurationRate: inp.conjurationRate,
        levelWeights: spellLevels.map((l) => inp.levelWeights[l]),
        baseRate: inp.baseRate,
        shinyChance: inp.shinyChance,
        autographChance: inp.autographChance,
        shinyMultiplierAvg: inp.shinyMultiplierAvg,
        autoMultiplierAvg: inp.autoMultiplierAvg,
        autoLegMultiplierAvg: inp.autoLegMultiplierAvg,
        cardOverrides: CARD_FILE_NAMES.map((f) => inp.cardWeightOverrides[f] ?? 1),
    };
}

function fromWorkerResult(wr: WorkerResult): SearchResult {
    const levelWeights = Object.fromEntries(
        spellLevels.map((l, i) => [l, wr.inputs.levelWeights[i]]),
    ) as Record<SpellLevel, number>;
    const cardWeightOverrides = Object.fromEntries(
        CARD_FILE_NAMES.map((f, i) => [f, wr.inputs.cardOverrides[i]]),
    );
    const inputs: SimInputs = {
        packPrice: wr.inputs.packPrice,
        cardsInPack: wr.inputs.cardsInPack,
        conjurationRate: wr.inputs.conjurationRate,
        levelWeights,
        baseRate: wr.inputs.baseRate,
        shinyChance: wr.inputs.shinyChance,
        autographChance: wr.inputs.autographChance,
        shinyMultiplierAvg: wr.inputs.shinyMultiplierAvg,
        autoMultiplierAvg: wr.inputs.autoMultiplierAvg,
        autoLegMultiplierAvg: wr.inputs.autoLegMultiplierAvg,
        cardWeightOverrides,
    };
    const evalResult: EvalResult = {
        targets: PRICE_TARGETS.map((t, i) => ({
            label: t.label,
            targetRarity: t.rarity,
            targetPrice: t.price,
            ...wr.targets[i],
        })),
        packEV: wr.packEV,
        rawPackEV: wr.rawPackEV,
        score: wr.score,
        activeTargetCount: wr.activeTargetCount,
        passAll: wr.passAll,
        evPass: wr.evPass,
    };
    return { inputs, eval: evalResult, sse: wr.sse, crossPackDivPct: wr.crossPackDivPct };
}

/** Dispatch a search request to one worker and return the top-10 results. */
let _msgIdCounter = 0;
function dispatchSearch(
    worker: Worker,
    base: WorkerInputs,
    iterations: number,
    spread: number,
    locked: boolean[],
    conjRange: [number, number],
    baseRange: [number, number],
    refFairValues: number[] | null,
): Promise<WorkerResult[]> {
    const id = ++_msgIdCounter;
    return new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
            if (e.data.type === 'results' && e.data.id === id) {
                worker.removeEventListener('message', handler);
                resolve(e.data.results as WorkerResult[]);
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'search', id, base, iterations, spread, locked, conjRange, baseRange, refFairValues });
    });
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

/** Derive a locked-weights map from any weight set — locks every level whose weight is 0. */
function locksFromWeights(weights: Record<SpellLevel, number>): Partial<Record<SpellLevel, boolean>> {
    return Object.fromEntries(
        spellLevels.filter((l) => weights[l] === 0).map((l) => [l, true]),
    ) as Partial<Record<SpellLevel, boolean>>;
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
    const [lockedWeights, setLockedWeights] = useState<Partial<Record<SpellLevel, boolean>>>(
        () => locksFromWeights(defaultInputs().levelWeights),
    );
    const [inactiveLockedWeights, setInactiveLockedWeights] = useState<Partial<Record<SpellLevel, boolean>>>(
        () => locksFromWeights(defaultStarterInputs().levelWeights),
    );
    const lockedWeightsRef = useRef<Partial<Record<SpellLevel, boolean>>>(
        locksFromWeights(defaultInputs().levelWeights),
    );
    const [conjRateRange, setConjRateRange] = useState<[number, number]>([40, 90]);
    const [baseRateRange, setBaseRateRange] = useState<[number, number]>([0.6, 1.0]);
    const [inactiveConjRateRange, setInactiveConjRateRange] = useState<[number, number]>([40, 90]);
    const [inactiveBaseRateRange, setInactiveBaseRateRange] = useState<[number, number]>([0.6, 1.0]);
    const conjRateRangeRef = useRef<[number, number]>([40, 90]);
    const baseRateRangeRef = useRef<[number, number]>([0.6, 1.0]);
    const [searchIter, setSearchIter] = useState<number>(2000);
    const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
    const [genePool, setGenePool] = useState<SearchResult[]>([]);
    const [looping, setLooping] = useState(false);
    const [loopRound, setLoopRound] = useState(0);
    const loopRef = useRef(false);
    const genePoolRef = useRef<SearchResult[]>([]);
    const loopInitialInputsRef = useRef<SimInputs>(defaultInputs());
    const loopInactiveFairRef = useRef<Map<string, number>>(new Map());
    const loopSearchIterRef = useRef(2000);

    // ── Worker pool ─────────────────────────────────────────────────────────
    const [workersReady, setWorkersReady] = useState(false);
    const workersRef = useRef<Worker[]>([]);

    useEffect(() => {
        const pool: Worker[] = Array.from({ length: NUM_WORKERS }, () => new SearchWorkerClass());
        let readyCount = 0;
        for (const w of pool) {
            const h = (e: MessageEvent) => {
                if (e.data.type === 'ready') {
                    w.removeEventListener('message', h);
                    readyCount++;
                    if (readyCount === NUM_WORKERS) {
                        workersRef.current = pool;
                        setWorkersReady(true);
                    }
                }
            };
            w.addEventListener('message', h);
            w.postMessage(WORKER_INIT_MSG);
        }
        return () => {
            for (const w of pool) w.terminate();
            workersRef.current = [];
            setWorkersReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Each preset's eval reads from its own independent inputs.
    const starterEval = useMemo(() => evaluateInputs(activePreset === 'starter' ? inputs : inactiveInputs), [activePreset, inputs, inactiveInputs]);
    const advancedEval = useMemo(() => evaluateInputs(activePreset === 'advanced' ? inputs : inactiveInputs), [activePreset, inputs, inactiveInputs]);

    const starterFairMap = useMemo(
        () => computeSpellFairValues(activePreset === 'starter' ? inputs : inactiveInputs),
        [activePreset, inputs, inactiveInputs],
    );
    const advancedFairMap = useMemo(
        () => computeSpellFairValues(activePreset === 'advanced' ? inputs : inactiveInputs),
        [activePreset, inputs, inactiveInputs],
    );

    const crossPackDiv = useMemo(() => {
        const activeMap = activePreset === 'starter' ? starterFairMap : advancedFairMap;
        const refMap = activePreset === 'starter' ? advancedFairMap : starterFairMap;
        const divs: number[] = [];
        for (const card of spellCards) {
            const af = activeMap.get(card.fileName) ?? 0;
            const rf = refMap.get(card.fileName) ?? 0;
            if (af > 0 && rf > 0) {
                const u = Math.sqrt(af * rf);
                if (u > 0) divs.push(Math.abs(af - rf) / u);
            }
        }
        return divs.length > 0 ? divs.reduce((s, v) => s + v, 0) / divs.length : 0;
    }, [activePreset, starterFairMap, advancedFairMap]);

    const evaluation = useMemo(() => {
        const base = evaluateInputs(inputs);
        const cpPass = crossPackDiv <= CROSS_PACK_TOLERANCE;
        return {
            ...base,
            score: base.score + (cpPass ? 1 : 0),
            activeTargetCount: base.activeTargetCount + 1,
            passAll: base.passAll && cpPass,
        };
    }, [inputs, crossPackDiv]);

    function switchPreset(id: 'starter' | 'advanced') {
        if (id === activePreset) return;
        // Save active → inactive slot, load inactive → active slot
        const savedInputs = inputs;
        const savedText = overridesText;
        const savedLocked = lockedWeights;
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
        // Auto-lock zero weights so the search doesn't waste iterations on excluded levels;
        // auto-unlock when a non-zero value is entered.
        setLockedWeights((prev) => {
            const next = { ...prev, [lvl]: value === 0 };
            lockedWeightsRef.current = next;
            return next;
        });
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
    function startLoop() {
        if (loopRef.current || !workersReady) return;
        loopSearchIterRef.current = searchIter;
        loopInitialInputsRef.current = inputs;
        loopInactiveFairRef.current = computeSpellFairValues(inactiveInputs);
        // Drop any gene pool entries from a different pack configuration so they
        // don't contaminate seeds with a wrong packPrice or cardsInPack.
        const compatiblePool = genePool.filter(
            (r) => r.inputs.packPrice === inputs.packPrice && r.inputs.cardsInPack === inputs.cardsInPack,
        );
        genePoolRef.current = compatiblePool;
        setGenePool(compatiblePool);
        loopRef.current = true;
        setLooping(true);
        setLoopRound(0);
        setTimeout(loopStep, 0);
    }
    function stopLoop() {
        loopRef.current = false;
    }
    async function loopStep() {
        if (!loopRef.current) {
            setLooping(false);
            return;
        }
        const pool = genePoolRef.current;
        const refFairMap = loopInactiveFairRef.current;
        const iters = loopSearchIterRef.current;
        const poolMaxSize = Math.max(10, Math.round(iters * 0.1));
        const workers = workersRef.current;

        // Convert inactive fair map → flat array (once per round, shared by all workers)
        const refFairValues: number[] | null = refFairMap.size > 0
            ? CARD_FILE_NAMES.map((f) => refFairMap.get(f) ?? 0)
            : null;

        const locked = spellLevels.map((l) => !!(lockedWeightsRef.current[l]));
        const conjRange = conjRateRangeRef.current;
        const baseRange = baseRateRangeRef.current;

        // Each worker gets its own seed drawn independently from the top of the pool.
        const requests = workers.map((worker) => {
            const seedIdx = pool.length > 0
                ? Math.floor(Math.random() * Math.min(5, pool.length))
                : -1;
            const seed = seedIdx >= 0 ? pool[seedIdx].inputs : loopInitialInputsRef.current;
            return dispatchSearch(worker, toWorkerInputs(seed), iters, 0.25, locked, conjRange, baseRange, refFairValues);
        });

        const allBatches = await Promise.all(requests);

        if (!loopRef.current) {
            setLooping(false);
            return;
        }

        const newResults = allBatches.flat().map(fromWorkerResult);
        const merged = [...pool, ...newResults];
        merged.sort((a, b) => {
            const sa = a.eval.score + (a.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0);
            const sb = b.eval.score + (b.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0);
            return (sb - sa) || (a.sse - b.sse);
        });
        const newPool = merged.slice(0, poolMaxSize);
        genePoolRef.current = newPool;
        setGenePool(newPool);
        setSearchResults(newPool.slice(0, 10));
        // Preserve packPrice and cardsInPack — they are user-owned structural
        // inputs, not optimizer parameters.
        setInputs((prev) => ({ ...newPool[0].inputs, packPrice: prev.packPrice, cardsInPack: prev.cardsInPack }));
        setOverridesText(JSON.stringify(newPool[0].inputs.cardWeightOverrides, null, 2));
        setLoopRound((n) => n + 1);
        setTimeout(loopStep, 0);
    }
    function applyResult(r: SearchResult) {
        setInputs(r.inputs);
        setOverridesText(JSON.stringify(r.inputs.cardWeightOverrides, null, 2));
        setOverridesError(null);
    }
    function reset() {
        const d = activePreset === 'starter' ? defaultStarterInputs() : defaultInputs();
        const defaultLocks = locksFromWeights(d.levelWeights);
        setInputs(d);
        setOverridesText(JSON.stringify(d.cardWeightOverrides, null, 2));
        setOverridesError(null);
        setLockedWeights(defaultLocks);
        lockedWeightsRef.current = defaultLocks;
        setSearchResults(null);
        setGenePool([]);
        genePoolRef.current = [];
        loopRef.current = false;
        setLooping(false);
        setLoopRound(0);
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
                                <span className={`shrink-0 px-2.5 py-1 rounded-full border text-xs font-bold tabular-nums ${evaluation.passAll
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
                                            className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${activePreset === p.id
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
                        <div className={`${panel} p-4 flex flex-col gap-3`}>
                            <div className="flex items-center justify-between gap-2">
                                <h2 className={secTitle}>Search loop</h2>
                                {looping && (
                                    <p className="text-xs text-emerald-400 font-mono">
                                        Round {loopRound} · {NUM_WORKERS}w · pool {genePool.length}
                                        {searchResults?.[0] ? ` · ${searchResults[0].eval.score + (searchResults[0].crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0)}/${searchResults[0].eval.activeTargetCount + 1} · div ${(searchResults[0].crossPackDivPct * 100).toFixed(1)}% · sse ${searchResults[0].sse.toFixed(3)}` : ''}
                                    </p>
                                )}
                            </div>
                            <label className="flex items-center gap-2 text-xs">
                                <span className="text-slate-400 flex-1">Iterations / round / worker</span>
                                <input type="number" value={searchIter} min={100} max={50_000} step={500}
                                    onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) setSearchIter(v); }}
                                    className={inp + ' w-24 py-1 px-2 text-xs text-right font-mono'} />
                            </label>
                            <p className="text-xs text-slate-500 leading-snug">
                                {NUM_WORKERS} parallel workers · {(searchIter * NUM_WORKERS).toLocaleString()} candidates/round · gene pool top {Math.max(10, Math.round(searchIter * 0.1)).toLocaleString()}
                            </p>
                            {looping ? (
                                <button type="button" onClick={stopLoop}
                                    className="rounded-lg px-3 py-2 bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold transition-colors">
                                    ■ Stop loop
                                </button>
                            ) : (
                                <button type="button" onClick={startLoop} disabled={!workersReady}
                                    className="rounded-lg px-3 py-2 bg-gradient-to-br from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-xs font-semibold transition-all disabled:opacity-50">
                                    {workersReady ? '▶ Start loop' : '⏳ Initializing workers…'}
                                </button>
                            )}
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
                                    <div key={name} className={`grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_3.5rem] gap-1 items-center py-1.5 border-b border-slate-800/40 text-xs rounded transition-colors cursor-pointer hover:bg-white/3 ${isActive ? 'text-white' : 'text-slate-400'
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
                                    <div key={t.label} className={`grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_4rem_1.25rem] gap-1 items-center py-1 border-b border-slate-800/40 text-xs rounded transition-colors ${t.excluded ? 'opacity-35' : 'hover:bg-white/3'
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
                                <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_4rem_1.25rem] gap-1 items-center py-1 text-xs border-t border-slate-700/40">
                                    <span className="text-slate-400">Cross-pack align</span>
                                    <span className="text-right font-mono text-slate-600">≤{(CROSS_PACK_TOLERANCE * 100).toFixed(0)}%</span>
                                    <span className={`text-right font-mono ${crossPackDiv <= CROSS_PACK_TOLERANCE ? 'text-emerald-300' : 'text-red-300'}`}>{(crossPackDiv * 100).toFixed(1)}%</span>
                                    <span className={`text-right font-mono ${crossPackDiv <= CROSS_PACK_TOLERANCE ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(crossPackDiv - CROSS_PACK_TOLERANCE)}</span>
                                    <DeltaBar pct={crossPackDiv / CROSS_PACK_TOLERANCE - 1} pass={crossPackDiv <= CROSS_PACK_TOLERANCE} />
                                    <span className={`text-center ${crossPackDiv <= CROSS_PACK_TOLERANCE ? 'text-emerald-400' : 'text-red-400'}`}>{crossPackDiv <= CROSS_PACK_TOLERANCE ? '●' : '○'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Cross-pack marketplace */}
                        <CrossPackMarketSection starterFairMap={starterFairMap} advancedFairMap={advancedFairMap} />

                        {searchResults && <ResultsCards results={searchResults} title={`Search results — top ${searchResults.length} (pool: ${genePool.length})`} onApply={applyResult} />}

                        <div className={`${panel} px-4 py-2.5`}>
                            <p className="text-xs text-slate-600">
                                {spellCards.length} cards · {NUM_WORKERS} workers · {(searchIter * NUM_WORKERS).toLocaleString()} candidates/round · gene pool top {Math.max(10, Math.round(searchIter * 0.1))} · seeded from best 5
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
            <div className="grid grid-cols-[1.5rem_3rem_3.5rem_3.5rem_4.5rem_1fr_5rem] gap-2 px-3 pb-1.5 mb-1 border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                <span>#</span>
                <span>Score</span>
                <span>Div%</span>
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
                        <div className="grid grid-cols-[1.5rem_3rem_3.5rem_3.5rem_4.5rem_1fr_5rem] gap-2 items-center px-3 py-2 text-xs">
                            <span className="text-slate-500 font-mono">{i + 1}</span>
                            <span className={`font-mono font-semibold ${(r.eval.score + (r.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0)) >= r.eval.activeTargetCount ? 'text-emerald-300' : (r.eval.score + (r.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0)) >= r.eval.activeTargetCount - 1 ? 'text-yellow-300' : 'text-slate-300'}`}>
                                {r.eval.score + (r.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 1 : 0)}/{r.eval.activeTargetCount + 1}
                            </span>
                            <span className={`font-mono ${r.crossPackDivPct <= CROSS_PACK_TOLERANCE ? 'text-emerald-400' : 'text-red-400'}`}>{(r.crossPackDivPct * 100).toFixed(0)}%</span>
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Cross-Pack Marketplace section
 * Shows each spell's fair price as implied by Starter vs Advanced, side-by-side.
 * Unified price = geometric mean; divergence highlights inconsistencies so the
 * user can tune pack params until both packs agree on spell values.
 * ─────────────────────────────────────────────────────────────────────────── */
function CrossPackMarketSection({
    starterFairMap,
    advancedFairMap,
}: {
    starterFairMap: Map<string, number>;
    advancedFairMap: Map<string, number>;
}) {
    const [openLevels, setOpenLevels] = useState<Set<number>>(new Set());

    const levelData = useMemo(() => spellLevels.map((lvl) => {
        const spellsAtLevel = spellCards.filter((c) => c.level === lvl);
        const spellRows = spellsAtLevel.map((card) => {
            const sf = starterFairMap.get(card.fileName) ?? 0;
            const af = advancedFairMap.get(card.fileName) ?? 0;
            const bothDrawable = sf > 0 && af > 0;
            const unified = bothDrawable ? Math.sqrt(sf * af) : sf > 0 ? sf : af;
            const divPct = bothDrawable && unified > 0 ? (af - sf) / unified : 0;
            return { card, sf, af, unified, divPct, bothDrawable };
        });
        const sfRows = spellRows.filter((r) => r.sf > 0);
        const afRows = spellRows.filter((r) => r.af > 0);
        const bothRows = spellRows.filter((r) => r.bothDrawable);
        const starterAvg = sfRows.length > 0 ? sfRows.reduce((s, r) => s + r.sf, 0) / sfRows.length : 0;
        const advancedAvg = afRows.length > 0 ? afRows.reduce((s, r) => s + r.af, 0) / afRows.length : 0;
        const unifiedAvg = spellRows.length > 0 ? spellRows.reduce((s, r) => s + r.unified, 0) / spellRows.length : 0;
        const avgAbsDivPct = bothRows.length > 0
            ? bothRows.reduce((s, r) => s + Math.abs(r.divPct), 0) / bothRows.length
            : 0;
        return {
            lvl,
            rarity: LEVEL_TO_RARITY[lvl],
            label: LEVEL_LABELS[lvl],
            starterAvg,
            advancedAvg,
            unifiedAvg,
            avgAbsDivPct,
            spellRows,
            bothRowsCount: bothRows.length,
        };
    }), [starterFairMap, advancedFairMap]);

    const overallDivPct = useMemo(() => {
        const allBoth = levelData.flatMap((l) => l.spellRows.filter((r) => r.bothDrawable));
        return allBoth.length > 0 ? allBoth.reduce((s, r) => s + Math.abs(r.divPct), 0) / allBoth.length : 0;
    }, [levelData]);

    function toggleLevel(lvl: number) {
        setOpenLevels((prev) => {
            const next = new Set(prev);
            next.has(lvl) ? next.delete(lvl) : next.add(lvl);
            return next;
        });
    }

    const divColor = (absPct: number) =>
        absPct < 0.2 ? 'text-emerald-400' : absPct < 0.5 ? 'text-yellow-400' : 'text-red-400';

    return (
        <div className={`${panel} p-4`}>
            <div className="flex items-center justify-between mb-1">
                <h2 className={secTitle}>Cross-Pack Marketplace</h2>
                <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border ${overallDivPct < 0.2
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : overallDivPct < 0.5
                        ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-300'
                        : 'bg-red-500/10 border-red-500/25 text-red-300'
                    }`}>
                    avg div {(overallDivPct * 100).toFixed(1)}%
                </span>
            </div>
            <p className="text-xs text-slate-500 mb-3 leading-snug">
                A spell's value is the same regardless of which pack it came from. Divergence shows how much the two packs disagree on a spell's implied price. Lower is better.
            </p>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_4rem_4rem_4rem_4rem] gap-1 pb-1.5 mb-0.5 border-b border-slate-700/40 text-xs text-slate-500 uppercase tracking-wider">
                <span>Level / Spell</span>
                <span className="text-right">Starter</span>
                <span className="text-right">Advanced</span>
                <span className="text-right">Div%</span>
                <span className="text-right">Unified</span>
            </div>
            {levelData.map(({ lvl, rarity, label, starterAvg, advancedAvg, unifiedAvg, avgAbsDivPct, spellRows, bothRowsCount }) => {
                const isOpen = openLevels.has(lvl);
                return (
                    <div key={lvl}>
                        {/* Level group row */}
                        <div
                            className="grid grid-cols-[1fr_4rem_4rem_4rem_4rem] gap-1 items-center py-1.5 border-b border-slate-800/40 text-xs rounded transition-colors cursor-pointer select-none hover:bg-white/3"
                            onClick={() => toggleLevel(lvl)}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RARITY_DOT[rarity]}`} />
                                <span className={`font-medium ${RARITY_TEXT[rarity]}`}>{label}</span>
                                <span className="text-slate-600">{isOpen ? '▾' : '▸'} {spellRows.length}</span>
                            </div>
                            <span className="text-right font-mono text-slate-400">
                                {starterAvg > 0 ? fmtMoney(starterAvg) : '—'}
                            </span>
                            <span className="text-right font-mono text-slate-400">
                                {advancedAvg > 0 ? fmtMoney(advancedAvg) : '—'}
                            </span>
                            <span className={`text-right font-mono ${bothRowsCount > 0 ? divColor(avgAbsDivPct) : 'text-slate-600'}`}>
                                {bothRowsCount > 0 ? `${(avgAbsDivPct * 100).toFixed(0)}%` : '—'}
                            </span>
                            <span className="text-right font-mono text-slate-200">{fmtMoney(unifiedAvg)}</span>
                        </div>
                        {/* Per-spell rows */}
                        {isOpen && (
                            <div className="pl-3 pb-1 border-b border-slate-800/30">
                                {spellRows.map(({ card, sf, af, unified, divPct, bothDrawable }) => (
                                    <div
                                        key={card.fileName}
                                        className="grid grid-cols-[1fr_4rem_4rem_4rem_4rem] gap-1 items-center py-0.5 text-xs hover:bg-white/3 rounded transition-colors"
                                    >
                                        <span className="text-slate-400 truncate pl-1">{card.displayName}</span>
                                        <span className="text-right font-mono text-slate-500">{sf > 0 ? fmtMoney(sf) : '—'}</span>
                                        <span className="text-right font-mono text-slate-500">{af > 0 ? fmtMoney(af) : '—'}</span>
                                        <span className={`text-right font-mono ${!bothDrawable ? 'text-slate-700' : divColor(Math.abs(divPct))}`}>
                                            {bothDrawable ? fmtPct(divPct) : '—'}
                                        </span>
                                        <span className="text-right font-mono text-slate-300">{fmtMoney(unified)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
