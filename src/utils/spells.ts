export type SpellRarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary';
export type SpellPool = 'conjuration' | 'staple';

export type SpellCard = {
    id: string;
    fileName: string;
    imageUrl: string;
    backImageUrl?: string;
    displayName: string;
    level: number;
    school: string;
    rarity: SpellRarity;
    pool: SpellPool;
    /** Per-card weight multiplier applied on top of rarity weight (default 1). */
    weightMultiplier: number;
};

const schoolNames = new Set([
    'Abjuration',
    'Conjuration',
    'Divination',
    'Enchantment',
    'Evocation',
    'Illusion',
    'Necromancy',
    'Transmutation',
]);

const schoolAliases: Record<string, string> = {
    Conjuratoin: 'Conjuration',
};

const levelFolders: Record<string, number> = {
    '0 - Cantrips': 0,
    '1st': 1,
    '2nd': 2,
    '3rd': 3,
    '4th': 4,
    '5th': 5,
    '6th': 6,
    '7th': 7,
    '8th': 8,
    '9th': 9,
};

export const rarityForLevel = (level: number): SpellRarity => {
    if (level <= 1) return 'common';
    if (level === 2) return 'uncommon';
    if (level === 3) return 'rare';
    if (level <= 5) return 'very_rare';
    return 'legendary';
};

export type SpellLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const spellLevels: SpellLevel[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Draw-weight per spell level (0–9). Sum should be ~100 for intuitive percentages. */
export const levelWeights: Record<SpellLevel, number> = {
    0: 43.23500614393656,
    1: 37.369195937951716,
    2: 8.700581700462225,
    3: 8.590410263256887,
    4: 0.887059691327142,
    5: 0.9214041796614746,
    6: 0.08440428759742864,
    7: 0.08411560166974012,
    8: 0.09104597924034745,
    9: 0.03677621489648301,
};

/** @deprecated Use levelWeights. Kept only for legacy type compatibility. */
export const rarityWeights: Record<SpellRarity, number> = {
    common: 50,
    uncommon: 17,
    rare: 12,
    very_rare: 15,
    legendary: 6,
};

/** Per-card weight multipliers keyed by file stem (without .png).
 *  e.g. 0.5 = half chance, 0.1 = one-tenth chance. */
const cardWeightOverrides: Record<string, number> = {
    '9-True Resurrection-Necromancy': 0.5905,
    '9-Wish-Conjuration1': 0.0884,
};

const imageModules = import.meta.glob('../data/Spells/**/*.png', {
    eager: true,
    import: 'default',
}) as Record<string, string>;

const backModules = import.meta.glob('../data/Spells/Back/*.png', {
    eager: true,
    import: 'default',
}) as Record<string, string>;

// Map: front card fileName (lowercase) → back image URL
// Back files are named like "1-Find Familiar-Conjuration2.png" (trailing digit before .png)
const backMap: Record<string, string> = Object.fromEntries(
    Object.entries(backModules).map(([path, url]) => {
        const base = fileBaseName(path);
        const normalized = base.replace(/\d+$/, '').toLowerCase();
        return [normalized, url];
    }),
);

function fileBaseName(path: string): string {
    return path.split('/').pop()?.replace(/\.png$/i, '') ?? path;
}

function normalizeSchool(value: string) {
    const trimmed = value.trim();
    return schoolAliases[trimmed] ?? trimmed;
}

function parseImageMeta(path: string, imageUrl: string): SpellCard | null {
    const parts = path.split('/');
    const spellsFolderIndex = parts.lastIndexOf('Spells');
    const folder = spellsFolderIndex >= 0 ? parts[spellsFolderIndex + 1] : undefined;
    if (!folder || folder === 'Back') {
        return null;
    }

    const fileName = fileBaseName(path);
    const levelMatch = fileName.match(/^(\d+)\s*-/);
    const level = levelMatch
        ? Number.parseInt(levelMatch[1], 10)
        : (levelFolders[folder] ?? (Number.parseInt(folder, 10) || 0));
    const withoutLevel = fileName.replace(/^\d+\s*-\s*/, '');
    const segments = withoutLevel.split('-');

    let school = 'Unknown';
    let namePart = withoutLevel;

    if (segments.length >= 2) {
        const possibleSchool = normalizeSchool(segments[segments.length - 1].replace(/\d+$/, '').trim());
        if (schoolNames.has(possibleSchool)) {
            school = possibleSchool;
            namePart = segments.slice(0, -1).join('-').trim();
        }
    }

    const cleanedName = namePart.replace(/\d+$/, '').replace(/\s*-\s*/g, ' ').trim();

    return {
        id: fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        fileName,
        imageUrl,
        displayName: cleanedName || fileName,
        level,
        school,
        rarity: rarityForLevel(level),
        pool: school === 'Conjuration' ? 'conjuration' : 'staple',
        weightMultiplier: 1,
    };
}

export const spellCards = Object.entries(imageModules)
    .map(([path, imageUrl]) => parseImageMeta(path, imageUrl))
    .filter((card): card is SpellCard => card !== null)
    .map((card) => {
        const backKey = card.fileName.toLowerCase().replace(/\d+$/, '');
        const backImageUrl = backMap[backKey];
        const weightMultiplier = cardWeightOverrides[card.fileName] ?? 1;
        return backImageUrl ? { ...card, backImageUrl, weightMultiplier } : { ...card, weightMultiplier };
    })
    .sort((left, right) => {
        if (left.level !== right.level) return left.level - right.level;
        if (left.rarity !== right.rarity) return left.rarity.localeCompare(right.rarity);
        return left.displayName.localeCompare(right.displayName);
    });

export const currencyPerPack = 1000;
export const cardsPerPack = 5;
export const conjurationChance = 0.50;
