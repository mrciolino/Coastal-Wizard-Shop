import { spellLevels, rarityForLevel, type SpellLevel, type SpellRarity } from './spells';
import { STARTER_PACK, ADVANCED_PACK, STARTER_LEVEL_WEIGHTS, ADVANCED_LEVEL_WEIGHTS } from './constants';

export type PackPreset = {
    id: string;
    name: string;
    packPrice: number;
    cardsInPack: number;
    levelWeights: Record<SpellLevel, number>;
    conjurationRate: number;
    baseRate: number;
    shinyChance: number;
    autographChance: number;
    shinyMultiplierAvg: number;
    autoMultiplierAvg: number;
    autoLegMultiplierAvg: number;
};

export const PACK_PRESETS: PackPreset[] = [
    {
        id: 'starter',
        name: 'Starter',
        packPrice: STARTER_PACK.packPrice,
        cardsInPack: STARTER_PACK.cardsInPack,
        levelWeights: STARTER_LEVEL_WEIGHTS,
        conjurationRate: STARTER_PACK.conjurationRate,
        baseRate: STARTER_PACK.baseRate,
        shinyChance: STARTER_PACK.shinyChance,
        autographChance: STARTER_PACK.autographChance,
        shinyMultiplierAvg: STARTER_PACK.shinyMultiplierAvg,
        autoMultiplierAvg: STARTER_PACK.autoMultiplierAvg,
        autoLegMultiplierAvg: STARTER_PACK.autoLegMultiplierAvg,
    },
    {
        id: 'advanced',
        name: 'Advanced',
        packPrice: ADVANCED_PACK.packPrice,
        cardsInPack: ADVANCED_PACK.cardsInPack,
        levelWeights: ADVANCED_LEVEL_WEIGHTS,
        conjurationRate: ADVANCED_PACK.conjurationRate,
        baseRate: ADVANCED_PACK.baseRate,
        shinyChance: ADVANCED_PACK.shinyChance,
        autographChance: ADVANCED_PACK.autographChance,
        shinyMultiplierAvg: ADVANCED_PACK.shinyMultiplierAvg,
        autoMultiplierAvg: ADVANCED_PACK.autoMultiplierAvg,
        autoLegMultiplierAvg: ADVANCED_PACK.autoLegMultiplierAvg,
    },
];

export const LEVEL_LABELS: Record<number, string> = {
    0: 'Cantrip', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4',
    5: 'Level 5', 6: 'Level 6', 7: 'Level 7', 8: 'Level 8', 9: 'Level 9',
};

export type RarityRow = { rarity: SpellRarity; pct: number; levelLabel: string };

export function getPackRarityBreakdown(weights: Record<SpellLevel, number>): RarityRow[] {
    const totalWeight = spellLevels.reduce<number>((sum, l) => sum + weights[l], 0);
    return spellLevels
        .filter(l => weights[l] > 0)
        .map(l => ({
            rarity: rarityForLevel(l),
            pct: (weights[l] / totalWeight) * 100,
            levelLabel: LEVEL_LABELS[l],
        }));
}
