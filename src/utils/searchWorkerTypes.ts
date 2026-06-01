/** Shared types passed between the main thread and searchWorker. */

export type WorkerCard = {
    level: number;           // 0–9
    isConj: boolean;         // pool === 'conjuration'
    isAutographable: boolean; // rarity === 'rare' || 'legendary'
    isLegendary: boolean;    // rarity === 'legendary'
};

/**
 * A flat, serialisation-friendly representation of SimInputs.
 * levelWeights is a 10-element array (index = level 0–9).
 * cardOverrides is an N-element array (index = position in spellCards[]).
 */
export type WorkerInputs = {
    packPrice: number;
    cardsInPack: number;
    conjurationRate: number;  // 0–100 integer
    levelWeights: number[];   // length 10
    baseRate: number;
    shinyChance: number;
    autographChance: number;
    shinyMultiplierAvg: number;
    autoMultiplierAvg: number;
    autoLegMultiplierAvg: number;
    cardOverrides: number[];  // length = N cards
};

export type WorkerTargetResult = {
    avgFair: number;
    avgWithVariants: number;
    cardCount: number;
    excluded: boolean;
    pass: boolean;
    deltaPct: number;
};

export type WorkerResult = {
    inputs: WorkerInputs;
    score: number;
    activeTargetCount: number;
    passAll: boolean;
    evPass: boolean;
    packEV: number;
    rawPackEV: number;
    sse: number;
    crossPackDivPct: number;
    targets: WorkerTargetResult[];
};

/** Discriminated union of messages sent from the main thread to the worker. */
export type WorkerInitMessage = {
    type: 'init';
    cards: WorkerCard[];
    wishIdx: number;
    trueRezIdx: number;
    targetGroupIndices: number[][];
};

export type WorkerSearchMessage = {
    type: 'search';
    id: number;
    base: WorkerInputs;
    iterations: number;
    spread: number;
    locked: boolean[];
    conjRange: [number, number];
    baseRange: [number, number];
    refFairValues: number[] | null;
};

export type WorkerMessage = WorkerInitMessage | WorkerSearchMessage;
