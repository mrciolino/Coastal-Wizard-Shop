import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import {
    cardsPerPack,
    conjurationChance,
    currencyPerPack,
    rarityWeights as defaultRarityWeights,
    spellCards,
    type SpellCard,
    type SpellPool,
    type SpellRarity,
} from './utils/spells';
import { weightedPick } from './utils/roll';

// ── Types ────────────────────────────────────────────────
type GeneratedResult = {
    card: SpellCard;
    pool: SpellPool;
    isShiny: boolean;
    isAutographed: boolean;
};

type SelectedCard = {
    card: SpellCard;
    pool: SpellPool;
    isShiny: boolean;
    isAutographed: boolean;
    packIndex: number;
    cardIndex: number;
};

type PackSettingKey = 'gold' | 'packPrice' | 'cardsInPack' | 'conjurationRate';

type PackSettingConfig = {
    key: PackSettingKey;
    label: string;
    value: number;
    inputValue: string;
    min: number;
    max?: number;
    step: number;
    set: (value: number) => void;
};

type MarketEntry = {
    spell: SpellCard;
    currentPrice: number;
    yesterdayPrice: number;
    change: number;
    changePct: number;
    history: number[];   // 14 days oldest→newest, last = currentPrice
    shinyPrice: number;
    autographPrice: number | null;
};

// ── Constants ────────────────────────────────────────────
const rarityOrder: SpellRarity[] = ['common', 'uncommon', 'rare', 'very_rare', 'legendary'];
const schoolOrder = [
    'Conjuration', 'Abjuration', 'Divination', 'Enchantment',
    'Evocation', 'Illusion', 'Necromancy', 'Transmutation', 'Unknown',
] as const;

// ── Design tokens ────────────────────────────────────────
const panel = 'bg-slate-900/90 border border-slate-700/60 shadow-xl backdrop-blur-sm rounded-2xl';
const field = 'grid gap-1 p-2 rounded-xl bg-white/5 border border-slate-700/50';
const row = 'flex justify-between gap-3 px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-slate-700/50';
const tag = 'px-2 py-0.5 rounded-full text-indigo-200 text-xs bg-indigo-500/15 border border-indigo-400/15';
const shinyTag = 'px-2 py-0.5 rounded-full text-xs bg-gradient-to-r from-slate-300/40 to-slate-400/20 border border-slate-300/30 text-white';
const autographedTag = 'px-2 py-0.5 rounded-full text-xs bg-gradient-to-r from-amber-400/40 to-yellow-300/20 border border-amber-400/30 text-amber-100';
const rarityTagClasses: Record<SpellRarity, string> = {
    common: 'text-slate-200 bg-slate-800/15 border-slate-300/20',
    uncommon: 'text-emerald-200 bg-emerald-800/15 border-emerald-400/20',
    rare: 'text-cyan-200 bg-cyan-800/15 border-cyan-400/20',
    very_rare: 'text-purple-200 bg-purple-800/15 border-purple-400/20',
    legendary: 'text-amber-200 bg-amber-800/15 border-amber-400/25',
};
const inp = 'w-full border border-slate-600/50 rounded-lg py-1.5 px-2.5 text-slate-50 bg-slate-950/60 outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/40 transition-colors text-sm';
const eyebrow = 'text-xs uppercase tracking-widest text-sky-400 m-0 mb-0.5 font-medium';
const secTitle = 'text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0';
const statLabel = 'text-xs font-medium text-indigo-300/70 uppercase tracking-wider leading-none';
const muted = 'text-slate-400 text-sm';

// ── Helpers ──────────────────────────────────────────────
function formatPool(pool: SpellPool) {
    return pool === 'conjuration' ? 'Conjuration' : 'Staple';
}
function formatRarity(r: SpellCard['rarity']) {
    return r.replace('_', ' ');
}
function getRarityTagClass(rarity: SpellRarity) {
    return rarityTagClasses[rarity];
}
function generatePack(n: number, conjRate: number, weights: Record<SpellRarity, number>): GeneratedResult[] {
    const conj = spellCards.filter((c) => c.pool === 'conjuration');
    const staple = spellCards.filter((c) => c.pool === 'staple');
    return Array.from({ length: n }, () => {
        const pool: SpellPool = Math.random() < conjRate ? 'conjuration' : 'staple';
        const source = pool === 'conjuration' ? conj : staple;
        const cards = source.length > 0 ? source : spellCards;
        if (cards.length === 0) {
            throw new Error('No spell cards are available to generate a pack.');
        }
        const card = weightedPick(cards, (e) => weights[e.rarity] ?? 0);
        const isAutographed = (card.rarity === 'rare' || card.rarity === 'legendary') && Math.random() < 0.05;
        return { card, pool, isShiny: Math.random() < 0.10, isAutographed }; // 10% shiny rate, just for fun
    });
}
function countBy<T extends string>(values: T[]) {
    return values.reduce<Record<T, number>>((acc, v) => {
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
    }, {} as Record<T, number>);
}
function hasCard(entry: GeneratedResult | null | undefined): entry is GeneratedResult {
    return entry?.card != null;
}

function toWeightInputs(weights: Record<SpellRarity, number>) {
    return Object.fromEntries(
        rarityOrder.map((rarity) => [rarity, String(weights[rarity])]),
    ) as Record<SpellRarity, string>;
}
function toPackSettingInputs(values: Record<PackSettingKey, number>) {
    return Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value)]),
    ) as Record<PackSettingKey, string>;
}

function Sparkline({ prices, up }: { prices: number[]; up: boolean }) {
    if (prices.length < 2) return <span className="inline-block w-20 h-7" />;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const W = 80, H = 28, P = 2;
    const pts = prices.map((v, i) => {
        const x = P + (i / (prices.length - 1)) * (W - P * 2);
        const y = P + (1 - (v - min) / range) * (H - P * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const color = up ? '#4ade80' : '#f87171';
    return (
        <svg width={W} height={H} className="shrink-0 overflow-visible">
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ── Component ────────────────────────────────────────────
export default function App() {
    const [gold, setGold] = useState(150);
    const [packPrice, setPackPrice] = useState(currencyPerPack);
    const [cardsInPack, setCardsInPack] = useState(cardsPerPack);
    const [conjurationRate, setConjurationRate] = useState(Math.round(conjurationChance * 100));
    const [packSettingInputs, setPackSettingInputs] = useState<Record<PackSettingKey, string>>(() => toPackSettingInputs({
        gold: 150,
        packPrice: currencyPerPack,
        cardsInPack: cardsPerPack,
        conjurationRate: Math.round(conjurationChance * 100),
    }));
    const [rarityWeights, setRarityWeights] = useState<Record<SpellRarity, number>>(defaultRarityWeights);
    const [rarityWeightInputs, setRarityWeightInputs] = useState<Record<SpellRarity, string>>(() => toWeightInputs(defaultRarityWeights));
    const [packs, setPacks] = useState<GeneratedResult[][]>([]);
    const [lastOpenedAt, setLastOpenedAt] = useState<string | null>(null);
    const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
    const [showMobileSettings, setShowMobileSettings] = useState(false);
    const [showMobileStats, setShowMobileStats] = useState(false);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [showEconomyModal, setShowEconomyModal] = useState(false);
    const [oddsSearch, setOddsSearch] = useState('');
    const [marketData, setMarketData] = useState<MarketEntry[] | null>(null);
    const [marketSearch, setMarketSearch] = useState('');
    const [marketSortKey, setMarketSortKey] = useState<'name' | 'price' | 'change'>('price');
    const [marketSortDir, setMarketSortDir] = useState<'asc' | 'desc'>('desc');
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const mobileSettingsRef = useRef<HTMLDivElement | null>(null);

    const focusMobileSettingsPanel = useCallback(() => {
        window.requestAnimationFrame(() => {
            mobileSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            mobileSettingsRef.current?.focus({ preventScroll: true });
        });
    }, []);

    const visiblePacks = useMemo(
        () => packs.map((pack) => pack.filter(hasCard)).filter((pack) => pack.length > 0),
        [packs],
    );

    // Navigate within the modal (dPack: pack delta, dCard: card delta)
    const navigate = useCallback((dPack: number, dCard: number) => {
        setSelectedCard((cur) => {
            if (!cur) return null;
            const newPackIndex = Math.max(0, Math.min(visiblePacks.length - 1, cur.packIndex + dPack));
            const newPack = visiblePacks[newPackIndex];
            if (!newPack) return null;
            // When moving between packs, keep card index clamped; when navigating cards wrap within pack
            const newCardIndex = Math.max(0, Math.min(newPack.length - 1, cur.cardIndex + dCard));
            const entry = newPack[newCardIndex];
            if (!entry) return null;
            return { card: entry.card, pool: entry.pool, isShiny: entry.isShiny, isAutographed: entry.isAutographed, packIndex: newPackIndex, cardIndex: newCardIndex };
        });
    }, [visiblePacks]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setSelectedCard(null); setShowStatsModal(false); setOddsSearch(''); setShowEconomyModal(false); return; }
            if (!selectedCard) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(0, -1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); navigate(0, 1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigate(-1, 0); }
            if (e.key === 'ArrowDown') { e.preventDefault(); navigate(1, 0); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedCard, navigate]);

    useEffect(() => {
        if (!showMobileSettings) return;
        focusMobileSettingsPanel();
    }, [showMobileSettings, focusMobileSettingsPanel]);

    const spellOdds = useMemo(() => {
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
    }, [conjurationRate, rarityWeights, cardsInPack, packPrice]);

    useEffect(() => {
        if (!showEconomyModal) {
            setMarketData(null);
            setMarketSearch('');
            return;
        }
        setMarketData(null);
        const timer = setTimeout(() => {
            // Price model: EV of opening one pack = packPrice.
            // Each card's fair value = (packPrice / cardsInPack) × (avgPDraw / pDraw)
            // so sum_over_slot(pDraw × price) = packPrice/cardsInPack per slot, × cardsInPack = packPrice ✓
            const avgPDraw = spellOdds.length > 0 ? 1 / spellOdds.length : 1;
            const data: MarketEntry[] = spellOdds.map(({ spell, pDraw }) => {
                const fairValue = pDraw > 0
                    ? (packPrice / cardsInPack) * (avgPDraw / pDraw)
                    : packPrice / cardsInPack;
                const base = Math.max(1, fairValue);
                const currentPrice = Math.round(base * (0.85 + Math.random() * 0.30));
                const yesterdayPrice = Math.round(currentPrice * (0.93 + Math.random() * 0.14));
                const change = currentPrice - yesterdayPrice;
                const changePct = yesterdayPrice > 0 ? (change / yesterdayPrice) * 100 : 0;
                const history: number[] = new Array(14);
                history[13] = currentPrice;
                let p = currentPrice;
                for (let i = 12; i >= 0; i--) {
                    p = p / (0.95 + Math.random() * 0.10);
                    history[i] = Math.round(Math.max(1, p));
                }
                const shinyPrice = Math.round(currentPrice * (7 + Math.random() * 6));
                const isAutographable = spell.rarity === 'rare' || spell.rarity === 'legendary';
                const autographPrice = isAutographable
                    ? Math.round(currentPrice * (spell.rarity === 'legendary' ? 20 + Math.random() * 10 : 12 + Math.random() * 8))
                    : null;
                return { spell, currentPrice, yesterdayPrice, change, changePct, history, shinyPrice, autographPrice };
            });
            setMarketData(data);
        }, 400);
        return () => clearTimeout(timer);
    }, [showEconomyModal, spellOdds]);

    const packCount = packPrice > 0 ? Math.max(0, Math.floor(gold / packPrice)) : 0;
    const totalCards = packCount * cardsInPack;

    const stats = useMemo(() => {
        const all = visiblePacks.flat();
        return {
            totalOpened: all.length,
            averageLevel: all.length ? (all.reduce((s, e) => s + e.card.level, 0) / all.length).toFixed(1) : '0.0',
            shiny: all.filter((e) => e.isShiny).length,
            autographed: all.filter((e) => e.isAutographed).length,
            rarity: countBy(all.map((e) => e.card.rarity)),
            pool: countBy(all.map((e) => e.pool)),
            schools: countBy(all.map((e) => e.card.school)),
        };
    }, [visiblePacks]);

    const libStats = useMemo(() => {
        const c = spellCards.filter((c) => c.pool === 'conjuration').length;
        return { total: spellCards.length, conjuration: c, staple: spellCards.length - c };
    }, []);

    const packSettings: PackSettingConfig[] = [
        { key: 'gold', label: 'Gold budget', value: gold, inputValue: packSettingInputs.gold, min: 0, max: undefined, step: 5, set: (v: number) => setGold(Math.max(0, v)) },
        { key: 'packPrice', label: 'Gold per pack', value: packPrice, inputValue: packSettingInputs.packPrice, min: 1, max: undefined, step: 5, set: (v: number) => setPackPrice(Math.max(1, v)) },
        { key: 'cardsInPack', label: 'Cards per pack', value: cardsInPack, inputValue: packSettingInputs.cardsInPack, min: 1, max: 20, step: 1, set: (v: number) => setCardsInPack(Math.min(20, Math.max(1, v))) },
        { key: 'conjurationRate', label: 'Conjuration rate %', value: conjurationRate, inputValue: packSettingInputs.conjurationRate, min: 0, max: 100, step: 1, set: (v: number) => setConjurationRate(Math.min(100, Math.max(0, v))) },
    ];
    const libraryInfo = [
        ['Available cards', libStats.total],
        ['Conjuration library', libStats.conjuration],
        ['Staple library', libStats.staple],
        ['Packs this batch', packCount],
        ['Cards this batch', totalCards],
    ] as const;
    const sessionStats = [
        { label: 'Opened packs', value: visiblePacks.length },
        { label: 'Opened cards', value: stats.totalOpened },
        { label: 'Conjuration pulls', value: stats.pool.conjuration ?? 0 },
        { label: 'Staple pulls', value: stats.pool.staple ?? 0 },
        { label: 'Avg. level', value: stats.averageLevel },
        { label: 'Shiny pulls', value: stats.shiny },
        { label: 'Autographed pulls', value: stats.autographed },
    ] as const;

    const rarityWeightSum = Object.values(rarityWeights).reduce((a, b) => a + b, 0);

    function setWeight(rarity: SpellRarity, value: number) {
        const nextValue = Math.max(0, Math.trunc(value));
        setRarityWeights((cur) => ({ ...cur, [rarity]: nextValue }));
        setRarityWeightInputs((cur) => ({ ...cur, [rarity]: String(nextValue) }));
    }
    function handleWeightInputChange(rarity: SpellRarity, value: string) {
        setRarityWeightInputs((cur) => ({ ...cur, [rarity]: value }));
        if (value === '') return;

        const nextValue = Number(value);
        if (Number.isNaN(nextValue)) return;

        setRarityWeights((cur) => ({ ...cur, [rarity]: Math.max(0, Math.trunc(nextValue)) }));
    }
    function handleWeightInputBlur(rarity: SpellRarity) {
        const currentValue = rarityWeightInputs[rarity].trim();
        setWeight(rarity, currentValue === '' ? 0 : Number(currentValue));
    }
    function setPackSetting(key: PackSettingKey, value: number) {
        const config = packSettings.find((setting) => setting.key === key);
        if (!config) return;

        const nextValue = Math.trunc(value);
        config.set(nextValue);

        const normalizedValue =
            key === 'gold' ? Math.max(0, nextValue)
                : key === 'packPrice' ? Math.max(1, nextValue)
                    : key === 'cardsInPack' ? Math.min(20, Math.max(1, nextValue))
                        : Math.min(100, Math.max(0, nextValue));

        setPackSettingInputs((cur) => ({ ...cur, [key]: String(normalizedValue) }));
    }
    function handlePackSettingInputChange(key: PackSettingKey, value: string) {
        setPackSettingInputs((cur) => ({ ...cur, [key]: value }));
        if (value === '') return;

        const nextValue = Number(value);
        if (Number.isNaN(nextValue)) return;

        const config = packSettings.find((setting) => setting.key === key);
        config?.set(Math.trunc(nextValue));
    }
    function handlePackSettingInputBlur(key: PackSettingKey) {
        const currentValue = packSettingInputs[key].trim();
        setPackSetting(key, currentValue === '' ? 0 : Number(currentValue));
    }
    function openPacks() {
        setPacks(Array.from({ length: packCount }, () =>
            generatePack(cardsInPack, conjurationRate / 100, rarityWeights)));
        setLastOpenedAt(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' at ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
        setSelectedCard(null);
        setShowMobileSettings(false);
    }
    function clearResults() {
        setPacks([]);
        setLastOpenedAt(null);
        setSelectedCard(null);
        setShowMobileStats(false);
    }
    function handleMobileSettingsClick() {
        setShowMobileStats(false);
        setShowMobileSettings((cur) => !cur);
    }
    function handleCardTouchStart(e: TouchEvent<HTMLDivElement>) {
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        touchStart.current = { x: touch.clientX, y: touch.clientY };
    }
    function handleCardTouchEnd(e: TouchEvent<HTMLDivElement>) {
        if (!selectedCard || !touchStart.current) return;
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        const dx = touch.clientX - touchStart.current.x;
        const dy = touch.clientY - touchStart.current.y;
        touchStart.current = null;

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) {
            navigate(0, dx > 0 ? -1 : 1);
            return;
        }
        if (Math.abs(dy) > 64) {
            navigate(dy > 0 ? -1 : 1, 0);
        }
    }

    // Derived modal nav state
    const currentPack = selectedCard ? visiblePacks[selectedCard.packIndex] : null;
    const canPrevCard = selectedCard != null && selectedCard.cardIndex > 0;
    const canNextCard = selectedCard != null && currentPack != null && selectedCard.cardIndex < currentPack.length - 1;
    const canPrevPack = selectedCard != null && selectedCard.packIndex > 0;
    const canNextPack = selectedCard != null && selectedCard.packIndex < visiblePacks.length - 1;
    const mobileSettingsPanel = (
        <div
            ref={mobileSettingsRef}
            id="mobile-settings-panel"
            tabIndex={-1}
            className={`${panel} overflow-hidden xl:hidden focus:outline-none focus:ring-2 focus:ring-indigo-500/50`}
        >
            <div className="px-3 py-2 border-b border-slate-700/50 grid gap-2">
                <p className={secTitle}>Pack settings</p>
                <div className="grid grid-cols-2 gap-2">
                    {packSettings.map(({ key, label, inputValue, min, max, step }) => (
                        <label key={label} className="grid gap-0.5 p-1.5 rounded-xl bg-white/5 border border-slate-700/50">
                            <span className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-medium leading-tight">{label}</span>
                            <input type="number" inputMode="numeric" min={min} max={max} step={step} value={inputValue}
                                onChange={(e) => handlePackSettingInputChange(key, e.target.value)} onBlur={() => handlePackSettingInputBlur(key)} className={inp} />
                        </label>
                    ))}
                </div>
            </div>

            <div className="px-3 py-2 border-b border-slate-700/50 grid gap-2">
                <div className="flex items-center justify-between gap-2">
                    <p className={secTitle}>Rarity weights</p>
                    {rarityWeightSum !== 100 && <span className="text-yellow-400/80 text-[10px] font-medium">Sum ≠ 100 (now {rarityWeightSum})</span>}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    {rarityOrder.map((rarity) => (
                        <label key={rarity} className="grid gap-0.5 p-1.5 rounded-xl bg-white/5 border border-slate-700/50">
                            <span className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-medium capitalize leading-tight">{formatRarity(rarity)}</span>
                            <input type="number" inputMode="numeric" min={0} step={1} value={rarityWeightInputs[rarity]}
                                onChange={(e) => handleWeightInputChange(rarity, e.target.value)} onBlur={() => handleWeightInputBlur(rarity)} className={inp} />
                        </label>
                    ))}
                </div>
            </div>

            <div className="px-3 py-2 grid gap-1.5">
                <p className={secTitle}>Information</p>
                <div className="grid grid-cols-2 gap-1">
                    {libraryInfo.map(([label, val]) => (
                        <div key={String(label)} className="flex justify-between gap-1 px-2 py-1 text-xs rounded-lg bg-white/5 border border-slate-700/50">
                            <span className="text-slate-300 truncate">{label}</span>
                            <strong className="text-slate-100 shrink-0">{val}</strong>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    // ── Shared card grid (used on both mobile scroll zone and XL center) ──
    const cardGrid = (
        <div className={`${panel} p-3 sm:p-4 w-full`}>
            <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base font-semibold text-slate-100 mt-0 mb-0">Spell cards</h2>
                <span className={muted}>{visiblePacks.length} pack(s)</span>
            </div>

            {visiblePacks.length === 0 ? (
                <div className="border border-dashed border-slate-700/60 rounded-xl p-6 sm:p-8 text-center">
                    <p className="text-slate-300 font-medium mb-1">No packs opened yet.</p>
                    <span className="text-slate-500 text-sm">Configure the pack settings, then open it.</span>
                </div>
            ) : (
                <div className="grid gap-3">
                    {visiblePacks.map((pack, packIndex) => {
                        const conjCount = pack.filter((e) => e.pool === 'conjuration').length;
                        return (
                            <article key={`${packIndex}-${pack.length}`}
                                className="rounded-xl p-3 bg-slate-950/50 border border-slate-700/40">
                                <header className="flex items-baseline justify-between gap-2 mb-3">
                                    <h3 className="text-sm font-semibold text-slate-100 mt-0 mb-0 shrink-0">Pack {packIndex + 1}</h3>
                                    <p className="text-slate-500 text-xs m-0 text-right">{conjCount} conjuration · {pack.length - conjCount} staple · {pack.length} cards</p>
                                </header>

                                <ol className="list-none p-0 m-0 grid gap-2 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
                                    {pack.map((entry, cardIndex) => (
                                        <li
                                            key={`${entry.card.id}-${cardIndex}`}
                                            onClick={() => setSelectedCard({ card: entry.card, pool: entry.pool, isShiny: entry.isShiny, isAutographed: entry.isAutographed, packIndex, cardIndex })}
                                            className="p-2.5 rounded-xl bg-white/4 border border-slate-700/40 hover:bg-white/8 transition-colors cursor-zoom-in"
                                        >
                                            <div className={`grid grid-cols-[5rem_minmax(0,1fr)] gap-3 items-center relative sm:grid-cols-[6rem_minmax(0,1fr)]${entry.isShiny ? ' shiny-card' : ''}${entry.isAutographed ? ' autographed-card' : ''}`}>
                                                <img
                                                    src={entry.card.imageUrl}
                                                    alt={entry.card.fileName}
                                                    loading="lazy"
                                                    className="w-20 h-28 object-contain rounded-lg border border-slate-700/40 bg-slate-950/80 sm:w-24 sm:h-32"
                                                />
                                                <div className="min-w-0">
                                                    <div className="font-semibold text-sm leading-tight text-slate-100 mb-0.5">{entry.card.displayName}</div>
                                                    <div className="text-xs text-slate-500 mb-2 break-words">{entry.card.fileName}.png</div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {entry.isShiny && <span className={shinyTag}>Shiny</span>}
                                                        {entry.isAutographed && <span className={autographedTag}>Autographed</span>}
                                                        <span className={tag}>{entry.card.school}</span>
                                                        <span className={tag}>Level {entry.card.level}</span>
                                                        <span className={`px-2 py-0.5 rounded-full text-xs border ${getRarityTagClass(entry.card.rarity)}`}>{formatRarity(entry.card.rarity)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </article>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <main className="flex flex-col h-dvh xl:block xl:overflow-hidden">

            {/* ══ MOBILE TOP BAR (compact, non-scrolling) ══════════════ */}
            <div className="xl:hidden shrink-0 border-b border-slate-700/40 bg-slate-950/95 px-2 pt-2 pb-2 z-10">
                <div className={`${panel} px-3 py-2`}>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <p className={eyebrow}>5e Scroll Pack Opener</p>
                            <p className="text-xs text-slate-400 mt-0.5 mb-0 leading-none">{packCount} pack{packCount !== 1 ? 's' : ''} ready · {totalCards} cards</p>
                        </div>
                        <button
                            type="button"
                            onClick={openPacks}
                            disabled={packCount === 0 || cardsInPack <= 0}
                            className="shrink-0 rounded-xl px-3 py-2 bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold shadow disabled:opacity-40 disabled:cursor-not-allowed border-0 transition-all"
                        >
                            Open {packCount}
                        </button>
                        <button
                            type="button"
                            onClick={clearResults}
                            className="shrink-0 rounded-xl px-2.5 py-2 bg-white/8 text-slate-200 text-sm font-medium border border-slate-700/50 transition-all hover:bg-white/12"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={handleMobileSettingsClick}
                            aria-label="Toggle controls"
                            aria-controls="mobile-settings-panel"
                            aria-expanded={showMobileSettings}
                            className={`shrink-0 rounded-xl px-2.5 py-2 text-sm font-medium transition-all border ${showMobileSettings ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12'}`}
                        >
                            ⚙
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowStatsModal(true)}
                            aria-label="Spell odds"
                            className="shrink-0 rounded-xl px-2.5 py-2 text-sm font-medium transition-all border bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12"
                        >
                            📊
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowEconomyModal(true)}
                            aria-label="Economy"
                            className="shrink-0 rounded-xl px-2.5 py-2 text-sm font-medium transition-all border bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12"
                        >
                            💰
                        </button>
                    </div>
                    {lastOpenedAt && <p className="text-xs text-slate-500 mt-1.5 mb-0 leading-none">Last: {lastOpenedAt}</p>}
                </div>
            </div>

            {/* ══ MOBILE SCROLLABLE ZONE ═══════════════════════════════ */}
            <div className="xl:hidden flex-1 min-h-0 overflow-y-auto px-2 py-3 pb-28">
                {showMobileSettings && <div className="mb-3">{mobileSettingsPanel}</div>}
                {cardGrid}
            </div>

            {/* ══ XL THREE-COLUMN LAYOUT ═══════════════════════════════ */}
            <section className="hidden xl:grid xl:h-full max-w-screen-3xl mx-auto gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_14rem] xl:px-1 xl:py-0">

                {/* ── LEFT RAIL ── */}
                <aside className="min-w-0 flex flex-col overflow-y-auto py-4">
                    <div className={`${panel} grid gap-0 p-0 overflow-hidden`}>

                        <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
                            <p className={eyebrow}>5e Scroll Pack Opener</p>
                            <h1 className="text-xl sm:text-2xl font-bold leading-tight mt-1 mb-1 text-slate-50">Pack controls</h1>
                            <p className={`${muted} leading-snug`}>Configure values, then open a batch on the right.</p>
                        </div>

                        <div className="px-4 py-2.5 border-b border-slate-700/50 grid gap-1.5">
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={openPacks}
                                    disabled={packCount === 0 || cardsInPack <= 0}
                                    className="flex-1 rounded-xl px-3 py-2 bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold shadow-lg transition-all hover:-translate-y-px hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:brightness-100 border-0"
                                >
                                    Open {packCount} pack{packCount !== 1 ? 's' : ''}
                                </button>
                                <button
                                    type="button"
                                    onClick={clearResults}
                                    className="flex-1 rounded-xl px-3 py-2 bg-white/8 text-slate-200 text-sm font-medium transition-all hover:-translate-y-px hover:bg-white/12 border border-slate-700/50"
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowStatsModal(true)}
                                    className="flex-1 rounded-xl px-3 py-1.5 bg-white/8 text-slate-200 text-xs font-medium transition-all hover:bg-white/12 border border-slate-700/50"
                                >
                                    📊 Odds
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowEconomyModal(true)}
                                    className="flex-1 rounded-xl px-3 py-1.5 bg-white/8 text-slate-200 text-xs font-medium transition-all hover:bg-white/12 border border-slate-700/50"
                                >
                                    💰 Market
                                </button>
                            </div>
                        </div>

                        <div className="px-4 py-3 border-b border-slate-700/50 grid gap-2.5">
                            <p className={secTitle}>Pack settings</p>
                            {packSettings.map(({ key, label, inputValue, min, max, step }) => (
                                <label key={label} className={field}>
                                    <span className="text-xs uppercase tracking-wider text-indigo-300/80 font-medium">{label}</span>
                                    <input type="number" min={min} max={max} step={step} value={inputValue}
                                        onChange={(e) => handlePackSettingInputChange(key, e.target.value)} onBlur={() => handlePackSettingInputBlur(key)} className={inp} />
                                </label>
                            ))}
                        </div>

                        <div className="px-4 py-3 border-b border-slate-700/50 grid gap-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <p className={secTitle}>Rarity weights</p>
                                {rarityWeightSum !== 100 && <span className="text-yellow-400/80 text-xs font-medium">Sum ≠ 100 (now {rarityWeightSum})</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {rarityOrder.map((rarity) => (
                                    <label key={rarity} className={field}>
                                        <span className="text-xs uppercase tracking-wider text-indigo-300/80 font-medium capitalize">{formatRarity(rarity)}</span>
                                        <input type="number" min={0} step={1} value={rarityWeightInputs[rarity]}
                                            onChange={(e) => handleWeightInputChange(rarity, e.target.value)} onBlur={() => handleWeightInputBlur(rarity)} className={inp} />
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="px-4 py-3 grid gap-2.5">
                            <p className={secTitle}>Information</p>
                            <ul className="list-none p-0 m-0 grid gap-1.5">
                                {libraryInfo.map(([label, val]) => (
                                    <li key={String(label)} className={row}>
                                        <span className="text-slate-300">{label}</span>
                                        <strong className="text-slate-100">{val}</strong>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </aside>

                {/* ── CENTER ── */}
                <section className="min-w-0 overflow-y-auto py-4 px-3">
                    <div className="grid gap-3">
                        {cardGrid}
                    </div>
                </section>

                {/* ── RIGHT RAIL ── */}
                <aside className="min-w-0 grid gap-3 grid-cols-1 overflow-y-auto py-4 content-start">

                    <section className={`${panel} p-4`}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-3">Session stats</h2>
                        <div className="grid gap-2">
                            {sessionStats.map(({ label, value }) => (
                                <div key={label} className="flex justify-between items-baseline gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-slate-700/50">
                                    <span className={statLabel + ' shrink-0'}>{label}</span>
                                    <strong className="text-sm font-bold text-slate-100 text-right leading-none">{value}</strong>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className={`${panel} p-4`}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-2.5">Rarity</h2>
                        <ul className="list-none p-0 m-0 grid gap-1.5">
                            {rarityOrder.map((rarity) => (
                                <li key={rarity} className={row}>
                                    <span className="text-slate-300 capitalize">{formatRarity(rarity)}</span>
                                    <strong className="text-slate-100">{stats.rarity[rarity] ?? 0}</strong>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className={`${panel} p-4`}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-2.5">Schools</h2>
                        <ul className="list-none p-0 m-0 grid gap-1.5">
                            {schoolOrder.map((school) => (
                                <li key={school} className={row}>
                                    <span className="text-slate-300">{school}</span>
                                    <strong className="text-slate-100">{stats.schools[school] ?? 0}</strong>
                                </li>
                            ))}
                        </ul>
                    </section>

                </aside>
            </section>

            {/* ══ MOBILE BOTTOM STATS BAR ══════════════════════════════ */}
            <div className="xl:hidden fixed inset-x-2 bottom-2 z-10">
                {showMobileStats && (
                    <div className={`${panel} mb-2 p-3 max-h-[55vh] overflow-y-auto`}>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <section className="grid gap-2">
                                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">Session stats</h2>
                                {sessionStats.map(({ label, value }) => (
                                    <div key={label} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                                        <span className="text-slate-300">{label}</span>
                                        <strong className="text-slate-100">{value}</strong>
                                    </div>
                                ))}
                            </section>
                            <section className="grid gap-2">
                                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">Rarity</h2>
                                {rarityOrder.map((rarity) => (
                                    <div key={rarity} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                                        <span className="text-slate-300 capitalize">{formatRarity(rarity)}</span>
                                        <strong className="text-slate-100">{stats.rarity[rarity] ?? 0}</strong>
                                    </div>
                                ))}
                            </section>
                            <section className="grid gap-2">
                                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">Schools</h2>
                                {schoolOrder.map((school) => (
                                    <div key={school} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                                        <span className="text-slate-300">{school}</span>
                                        <strong className="text-slate-100">{stats.schools[school] ?? 0}</strong>
                                    </div>
                                ))}
                            </section>
                        </div>
                    </div>
                )}
                <div className={`${panel} px-3 py-2.5`}>
                    <div className="flex items-center gap-3">
                        <div className="grid flex-1 grid-cols-4 gap-2">
                            {[
                                { label: 'Packs', value: visiblePacks.length },
                                { label: 'Cards', value: stats.totalOpened },
                                { label: 'Shiny', value: stats.shiny },
                                { label: 'Autog.', value: stats.autographed },
                            ].map(({ label, value }) => (
                                <div key={label} className="rounded-xl bg-white/5 border border-slate-700/50 px-2 py-2 text-center">
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
                                    <div className="text-sm font-semibold text-slate-50">{value}</div>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowMobileStats((cur) => !cur)}
                            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition-all border ${showMobileStats ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12'}`}
                        >
                            Stats
                        </button>
                    </div>
                </div>
            </div>

            {/* ══ MODAL LIGHTBOX ═══════════════════════════ */}
            {selectedCard && (
                <div
                    className="fixed inset-0 bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-1 sm:p-4 z-20"
                    onClick={() => setSelectedCard(null)}
                    role="presentation"
                >
                    <div
                        className={`${panel} relative flex flex-col w-full max-w-9/10 overflow-hidden`}
                        style={{ maxHeight: 'calc(100dvh - 0.5rem)' }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="modal-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* ── Header bar ── */}
                        <div className="flex items-center justify-between gap-3 px-3 py-2 sm:py-3 sm:px-5 border-b border-slate-700/60 shrink-0">
                            {/* Spacer to balance close button */}
                            <div className="w-8 shrink-0" />

                            {/* Centre: position + keyboard hint */}
                            <div className="flex flex-col items-center gap-0.5 sm:gap-1 flex-1 text-center">
                                <span className="text-sm font-medium text-slate-200">
                                    Pack <span className="text-white font-bold">{selectedCard.packIndex + 1}</span>
                                    <span className="text-slate-500 mx-2">·</span>
                                    Card <span className="text-white font-bold">{selectedCard.cardIndex + 1}</span>
                                    <span className="text-slate-500 mx-1">/</span>
                                    <span className="text-slate-400">{currentPack?.length ?? 0}</span>
                                </span>
                                <span className="hidden sm:block text-xs text-slate-500">
                                    use{' '}<kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">←</kbd>
                                    <kbd className="ml-0.5 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">→</kbd>
                                    <kbd className="ml-0.5 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">↑</kbd>
                                    <kbd className="ml-0.5 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs font-mono">↓</kbd>
                                    {' '}to navigate
                                </span>
                            </div>

                            {/* Close */}
                            <button
                                type="button"
                                onClick={() => setSelectedCard(null)}
                                aria-label="Close"
                                className="w-8 h-8 shrink-0 rounded-xl grid place-items-center bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60 text-lg p-0 transition-all hover:bg-slate-700/60 cursor-pointer"
                            >
                                ×
                            </button>
                        </div>

                        {/* ── Body ── */}
                        <div className="flex flex-col sm:flex-row gap-0 overflow-hidden flex-1 min-h-0">

                            {/* Image area: [↑] / [‹][image][›] / [↓] as flex rows+columns */}
                            <div
                                className="flex flex-col flex-[3] min-h-0 sm:flex-none sm:w-3/5 bg-slate-950/60 touch-pan-y"
                                onTouchStart={handleCardTouchStart}
                                onTouchEnd={handleCardTouchEnd}
                                onTouchCancel={() => { touchStart.current = null; }}
                            >

                                {/* Prev pack button — top row */}
                                <button
                                    type="button"
                                    onClick={() => navigate(-1, 0)}
                                    disabled={!canPrevPack}
                                    aria-label="Previous pack"
                                    className="h-7 shrink-0 flex items-center justify-center border-b border-slate-700/50 text-base sm:text-lg font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                                >
                                    ↑
                                </button>

                                {/* Middle row: [‹] [image] [›] */}
                                <div className="flex items-stretch flex-1 min-h-0">

                                    {/* Prev card button — left column */}
                                    <button
                                        type="button"
                                        onClick={() => navigate(0, -1)}
                                        disabled={!canPrevCard}
                                        aria-label="Previous card"
                                        className="w-8 shrink-0 flex items-center justify-center border-r border-slate-700/50 text-2xl font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                                    >
                                        ‹
                                    </button>

                                    {/* Image — centre column */}
                                    <div className="relative flex-1 flex items-center justify-center overflow-hidden p-1 sm:p-3">
                                        {selectedCard.isShiny && (
                                            <div className="shiny-card absolute inset-0 pointer-events-none" />
                                        )}
                                        {selectedCard.isAutographed && (
                                            <div className="autographed-card absolute inset-0 pointer-events-none" />
                                        )}
                                        <img
                                            src={selectedCard.card.imageUrl}
                                            alt={selectedCard.card.displayName}
                                            className="object-contain max-w-full max-h-full"
                                        />
                                    </div>

                                    {/* Next card button — right column */}
                                    <button
                                        type="button"
                                        onClick={() => navigate(0, 1)}
                                        disabled={!canNextCard}
                                        aria-label="Next card"
                                        className="w-8 shrink-0 flex items-center justify-center border-l border-slate-700/50 text-2xl font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                                    >
                                        ›
                                    </button>
                                </div>

                                {/* Next pack button — bottom row */}
                                <button
                                    type="button"
                                    onClick={() => navigate(1, 0)}
                                    disabled={!canNextPack}
                                    aria-label="Next pack"
                                    className="h-7 shrink-0 flex items-center justify-center border-t border-slate-700/50 text-base sm:text-lg font-bold text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                                >
                                    ↓
                                </button>
                            </div>

                            {/* Metadata panel */}
                            <div className="flex-[2] min-h-0 sm:flex-none sm:w-2/5 border-t sm:border-t-0 sm:border-l border-slate-700/60 flex flex-col overflow-y-auto">
                                <div className="p-3 sm:p-5 flex flex-col gap-2.5 sm:gap-4 flex-1">
                                    {/* Eyebrow */}
                                    <div>
                                        <p className={eyebrow}>
                                            Pack {selectedCard.packIndex + 1} of {visiblePacks.length}
                                            {' · '}
                                            Card {selectedCard.cardIndex + 1} of {currentPack?.length ?? 0}
                                        </p>
                                        <h2 id="modal-title" className="text-xl sm:text-2xl font-bold text-slate-50 mt-1 mb-0 leading-tight">
                                            {selectedCard.card.displayName}
                                        </h2>
                                        <p className="text-slate-500 text-sm mt-1 mb-0 break-words">
                                            {selectedCard.card.fileName}.png
                                        </p>
                                    </div>

                                    {/* Tags */}
                                    <div className="flex flex-wrap gap-2">
                                        {selectedCard.isShiny && <span className={shinyTag}>✦ Shiny</span>}
                                        {selectedCard.isAutographed && <span className={autographedTag}>✍ Autographed</span>}
                                        <span className="px-3 py-1 rounded-lg text-sm text-slate-300 bg-white/5 border border-slate-700/50">
                                            {selectedCard.card.school}
                                        </span>
                                        <span className="px-3 py-1 rounded-lg text-sm text-slate-300 bg-white/5 border border-slate-700/50">
                                            Level {selectedCard.card.level}
                                        </span>
                                        <span className={`px-3 py-1 rounded-lg text-sm border ${getRarityTagClass(selectedCard.card.rarity)}`}>
                                            {formatRarity(selectedCard.card.rarity)}
                                        </span>
                                    </div>

                                    {/* Pack context */}
                                    <div className="grid gap-1 rounded-xl p-3 bg-white/5 border border-slate-700/50">
                                        <p className={`${secTitle} mb-1`}>Pack context</p>
                                        {currentPack && (() => {
                                            const conjCount = currentPack.filter((e) => e.pool === 'conjuration').length;
                                            return (
                                                <div className="grid grid-cols-2 gap-1">
                                                    {[
                                                        ['Pack', `${selectedCard.packIndex + 1} of ${visiblePacks.length}`],
                                                        ['Card in pack', `${selectedCard.cardIndex + 1} of ${currentPack.length}`],
                                                        ['Conjuration', conjCount],
                                                        ['Staple', currentPack.length - conjCount],
                                                    ].map(([label, value]) => (
                                                        <div key={String(label)} className="grid gap-0.5 p-1 rounded-lg bg-white/4 text-xs">
                                                            <span className="text-slate-400 leading-none">{label}</span>
                                                            <strong className="text-slate-200 leading-tight">{value}</strong>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* Card navigation buttons */}
                                    <div className="hidden sm:grid grid-cols-2 gap-2 mt-auto pt-2">
                                        <button
                                            type="button"
                                            onClick={() => navigate(0, -1)}
                                            disabled={!canPrevCard}
                                            className="rounded-xl py-2.5 bg-white/8 border border-slate-700/50 text-slate-200 text-sm font-medium hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            ‹ Prev card
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => navigate(0, 1)}
                                            disabled={!canNextCard}
                                            className="rounded-xl py-2.5 bg-white/8 border border-slate-700/50 text-slate-200 text-sm font-medium hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            Next card ›
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ══ SPELL ODDS MODAL ═══════════════════════════════════ */}
            {showStatsModal && (
                <div
                    className="fixed inset-0 bg-slate-950/92 backdrop-blur-md flex items-start justify-center p-4 z-30 overflow-y-auto"
                    onClick={() => { setShowStatsModal(false); setOddsSearch(''); }}
                    role="presentation"
                >
                    <div
                        className={`${panel} relative w-full max-w-5xl my-8 flex flex-col`}
                        style={{ maxHeight: 'calc(100dvh - 4rem)' }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="odds-modal-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-700/60 shrink-0">
                            <div>
                                <h2 id="odds-modal-title" className="text-lg font-bold text-slate-50 m-0">Spell Odds</h2>
                                <p className="text-xs text-slate-400 mt-0.5 m-0">Per-card-draw probability using current settings</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setShowStatsModal(false); setOddsSearch(''); }}
                                aria-label="Close"
                                className="w-8 h-8 shrink-0 rounded-xl grid place-items-center bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60 text-lg p-0 transition-all hover:bg-slate-700/60 cursor-pointer"
                            >
                                ×
                            </button>
                        </div>
                        {/* Search */}
                        <div className="px-4 py-2.5 border-b border-slate-700/60 shrink-0">
                            <input
                                type="search"
                                placeholder="Filter by name, school, or rarity…"
                                value={oddsSearch}
                                onChange={(e) => setOddsSearch(e.target.value)}
                                className={inp + ' text-sm'}
                                aria-label="Filter spells"
                            />
                        </div>
                        {/* Table */}
                        <div className="overflow-y-auto flex-1 min-h-0">
                            <table className="w-full text-sm border-collapse">
                                <thead className="sticky top-0 bg-slate-900 z-10">
                                    <tr>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Spell</th>
                                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Chance / draw</th>
                                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Exp. packs</th>
                                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Gold</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {spellOdds.filter(({ spell }) => {
                                        const q = oddsSearch.trim().toLowerCase();
                                        if (!q) return true;
                                        return (
                                            spell.displayName.toLowerCase().includes(q) ||
                                            spell.school.toLowerCase().includes(q) ||
                                            spell.rarity.replace('_', ' ').toLowerCase().includes(q)
                                        );
                                    }).map(({ spell, pDraw, expectedPacks, goldNeeded }) => (
                                        <tr key={spell.id} className="border-b border-slate-700/30 hover:bg-white/4 transition-colors">
                                            <td className="px-4 py-2">
                                                <div className="flex items-center gap-2 flex-nowrap">
                                                    <span className="text-slate-100 font-medium whitespace-nowrap">{spell.displayName}</span>
                                                    <span className={`px-1.5 py-0.5 rounded-full text-xs border ${getRarityTagClass(spell.rarity)}`}>{formatRarity(spell.rarity)}</span>
                                                    <span className={tag}>{spell.school}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-right text-slate-300 font-mono text-xs">
                                                {pDraw > 0 ? (pDraw * 100).toFixed(3) + '%' : '—'}
                                            </td>
                                            <td className="px-4 py-2 text-right text-slate-300 font-mono text-xs">
                                                {Number.isFinite(expectedPacks) ? Math.ceil(expectedPacks).toLocaleString() : '—'}
                                            </td>
                                            <td className="px-4 py-2 text-right text-slate-300 font-mono text-xs">
                                                {Number.isFinite(goldNeeded) ? goldNeeded.toLocaleString() + ' gp' : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ══ ECONOMY MODAL ══════════════════════════════════════ */}
            {showEconomyModal && (
                <div
                    className="fixed inset-0 bg-slate-950/92 backdrop-blur-md flex items-start justify-center p-4 z-30 overflow-y-auto"
                    onClick={() => setShowEconomyModal(false)}
                    role="presentation"
                >
                    <div
                        className={`${panel} relative w-full max-w-6xl my-8 flex flex-col`}
                        style={{ maxHeight: 'calc(100dvh - 4rem)' }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="economy-modal-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-700/60 shrink-0">
                            <div>
                                <h2 id="economy-modal-title" className="text-lg font-bold text-slate-50 m-0">📈 Marketplace</h2>
                                <p className="text-xs text-slate-400 mt-0.5 m-0">Simulated market prices based on pack pull odds · refreshes each open</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowEconomyModal(false)}
                                aria-label="Close"
                                className="w-8 h-8 shrink-0 rounded-xl grid place-items-center bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60 text-lg p-0 transition-all hover:bg-slate-700/60 cursor-pointer"
                            >
                                ×
                            </button>
                        </div>

                        {marketData === null ? (
                            /* Loading */
                            <div className="flex flex-col items-center justify-center py-24 gap-3">
                                <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-indigo-400 animate-spin" />
                                <p className="text-slate-400 text-sm">Computing market prices…</p>
                            </div>
                        ) : (
                            <>
                                {/* Search + sort controls */}
                                <div className="px-4 py-2.5 border-b border-slate-700/60 shrink-0 flex flex-wrap gap-2 items-center">
                                    <input
                                        type="search"
                                        placeholder="Filter by name, school, or rarity…"
                                        value={marketSearch}
                                        onChange={(e) => setMarketSearch(e.target.value)}
                                        className={inp + ' flex-1 min-w-40'}
                                        aria-label="Filter market"
                                    />
                                    <span className="text-xs text-slate-500 shrink-0">Sort:</span>
                                    {(['name', 'price', 'change'] as const).map((key) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => {
                                                if (marketSortKey === key) setMarketSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                                                else { setMarketSortKey(key); setMarketSortDir('desc'); }
                                            }}
                                            className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium border transition-all ${marketSortKey === key ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/5 text-slate-400 border-slate-700/50 hover:bg-white/10'}`}
                                        >
                                            {key === 'name' ? 'Name' : key === 'price' ? 'Price' : 'Change'}
                                            {marketSortKey === key ? (marketSortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                                        </button>
                                    ))}
                                </div>

                                {/* Table */}
                                <div className="overflow-y-auto flex-1 min-h-0">
                                    <table className="w-full text-sm border-collapse">
                                        <thead className="sticky top-0 bg-slate-900 z-10">
                                            <tr>
                                                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Spell</th>
                                                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">Price</th>
                                                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">✦ Shiny</th>
                                                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">✍ Autograph</th>
                                                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">24h</th>
                                                <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">14-day</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[...marketData]
                                                .filter(({ spell }) => {
                                                    const q = marketSearch.trim().toLowerCase();
                                                    if (!q) return true;
                                                    return (
                                                        spell.displayName.toLowerCase().includes(q) ||
                                                        spell.school.toLowerCase().includes(q) ||
                                                        spell.rarity.replace('_', ' ').toLowerCase().includes(q)
                                                    );
                                                })
                                                .sort((a, b) => {
                                                    const dir = marketSortDir === 'asc' ? 1 : -1;
                                                    if (marketSortKey === 'name') return dir * a.spell.displayName.localeCompare(b.spell.displayName);
                                                    if (marketSortKey === 'price') return dir * (a.currentPrice - b.currentPrice);
                                                    return dir * (a.changePct - b.changePct);
                                                })
                                                .map(({ spell, currentPrice, change, changePct, history, shinyPrice, autographPrice }) => (
                                                    <tr key={spell.id} className="border-b border-slate-700/30 hover:bg-white/4 transition-colors">
                                                        <td className="px-4 py-2">
                                                            <div className="flex items-center gap-2 flex-nowrap">
                                                                <span className="text-slate-100 font-medium whitespace-nowrap">{spell.displayName}</span>
                                                                <span className={`px-1.5 py-0.5 rounded-full text-xs border ${getRarityTagClass(spell.rarity)}`}>{formatRarity(spell.rarity)}</span>
                                                                <span className={tag}>{spell.school}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-100 font-semibold whitespace-nowrap">
                                                            {currentPrice.toLocaleString()} gp
                                                        </td>
                                                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-300 whitespace-nowrap">
                                                            {shinyPrice.toLocaleString()} gp
                                                        </td>
                                                        <td className="px-4 py-2 text-right font-mono text-xs whitespace-nowrap">
                                                            {autographPrice != null
                                                                ? <span className="text-amber-300">{autographPrice.toLocaleString()} gp</span>
                                                                : <span className="text-slate-600">—</span>
                                                            }
                                                        </td>
                                                        <td className={`px-4 py-2 text-right font-mono text-xs whitespace-nowrap ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            <div>{change >= 0 ? '+' : ''}{change.toLocaleString()} gp</div>
                                                            <div className="opacity-70">{change >= 0 ? '+' : ''}{changePct.toFixed(1)}%</div>
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <Sparkline prices={history} up={change >= 0} />
                                                        </td>
                                                    </tr>
                                                ))
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}
