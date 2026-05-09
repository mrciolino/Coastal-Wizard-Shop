import { spellCards, type SpellCard, type SpellRarity } from './spells';

export type SpellOdds = {
    spell: SpellCard;
    pDraw: number;
    expectedPacks: number;
    goldNeeded: number;
};

export type ComputeSpellOddsParams = {
    conjurationRate: number; // 0–100 integer (percentage)
    rarityWeights: Record<SpellRarity, number>;
    cardsInPack: number;
    packPrice: number;
};

export function computeSpellOdds({
    conjurationRate,
    rarityWeights,
    cardsInPack,
    packPrice,
}: ComputeSpellOddsParams): SpellOdds[] {
    const conjRate = conjurationRate / 100;
    const conjCards = spellCards.filter((c) => c.pool === 'conjuration');
    const stapleCards = spellCards.filter((c) => c.pool === 'staple');
    const conjWeight = conjCards.reduce((s, c) => s + (rarityWeights[c.rarity] ?? 0), 0);
    const stapleWeight = stapleCards.reduce((s, c) => s + (rarityWeights[c.rarity] ?? 0), 0);

    return spellCards.map((spell) => {
        const pPool = spell.pool === 'conjuration' ? conjRate : 1 - conjRate;
        const poolWeight = spell.pool === 'conjuration' ? conjWeight : stapleWeight;
        // Probability of drawing this spell on a single card slot
        const pDraw = poolWeight > 0 ? pPool * (rarityWeights[spell.rarity] ?? 0) / poolWeight : 0;
        // Probability of hitting it at least once in a full pack of n cards
        const pHitInPack = pDraw > 0 ? 1 - Math.pow(1 - pDraw, cardsInPack) : 0;
        // Expected packs (geometric distribution mean): E[packs] = 1 / pHitInPack
        const expectedPacks = pHitInPack > 0 ? 1 / pHitInPack : Infinity;
        // Gold needed: ceil because you must buy whole packs
        const goldNeeded = Number.isFinite(expectedPacks) ? Math.ceil(expectedPacks) * packPrice : Infinity;
        return { spell, pDraw, expectedPacks, goldNeeded };
    }).sort((a, b) => b.pDraw - a.pDraw);
}
