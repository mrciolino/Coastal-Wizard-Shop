import type { SpellCard, SpellPool, SpellRarity } from './spells';

export const rarityOrder: SpellRarity[] = ['common', 'uncommon', 'rare', 'very_rare', 'legendary'];

export const schoolOrder = [
    'Conjuration', 'Abjuration', 'Divination', 'Enchantment',
    'Evocation', 'Illusion', 'Necromancy', 'Transmutation', 'Unknown',
] as const;

export type SchoolName = typeof schoolOrder[number];

export function formatPool(pool: SpellPool): string {
    return pool === 'conjuration' ? 'Conjuration' : 'Staple';
}

export function formatRarity(r: SpellCard['rarity']): string {
    return r.replace('_', ' ');
}
