import { spellCards, type SpellCard, type SpellPool, type SpellLevel } from './spells';
import { weightedPick } from './roll';

export type GeneratedResult = {
    card: SpellCard;
    pool: SpellPool;
    isShiny: boolean;
    isAutographed: boolean;
};

export type SelectedCard = {
    card: SpellCard;
    pool: SpellPool;
    isShiny: boolean;
    isAutographed: boolean;
    packIndex: number;
    cardIndex: number;
};

export function generatePack(n: number, conjRate: number, weights: Record<SpellLevel, number>): GeneratedResult[] {
    const conj = spellCards.filter((c) => c.pool === 'conjuration');
    const staple = spellCards.filter((c) => c.pool === 'staple');
    return Array.from({ length: n }, () => {
        const pool: SpellPool = Math.random() < conjRate ? 'conjuration' : 'staple';
        const source = pool === 'conjuration' ? conj : staple;
        const cards = source.length > 0 ? source : spellCards;
        if (cards.length === 0) {
            throw new Error('No spell cards are available to generate a pack.');
        }
        const card = weightedPick(cards, (e) => weights[e.level as SpellLevel] ?? 0);
        const isAutographed = (card.rarity === 'rare' || card.rarity === 'legendary') && Math.random() < 0.04278;
        return { card, pool, isShiny: Math.random() < 0.02, isAutographed };
    });
}

export function countBy<T extends string>(values: T[]): Record<T, number> {
    return values.reduce<Record<T, number>>((acc, v) => {
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
    }, {} as Record<T, number>);
}

export function hasCard(entry: GeneratedResult | null | undefined): entry is GeneratedResult {
    return entry?.card != null;
}
