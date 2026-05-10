import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { RefreshCw } from 'lucide-react';

import { cardsPerPack, conjurationChance, currencyPerPack, levelWeights as defaultLevelWeights, spellCards, spellLevels, type SpellLevel } from './utils/spells';
import { generatePack, countBy, hasCard, type GeneratedResult, type SelectedCard } from './utils/pack';
import { computeSpellOdds } from './utils/odds';
import { computeMarketData, type MarketEntry } from './utils/pricing';
import { schoolOrder, formatRarity, fmtStat, fmtGold } from './utils/format';
import { panel, field, row, tag, shinyTag, autographedTag, inp, eyebrow, secTitle, statLabel, muted, getRarityTagClass } from './components/tokens';

const LEVEL_LABELS: Record<number, string> = {
    0: 'Cantrip', 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4',
    5: 'Level 5', 6: 'Level 6', 7: 'Level 7', 8: 'Level 8', 9: 'Level 9',
};
import OddsModal from './components/OddsModal';
import MarketModal from './components/MarketModal';

// ── Types ────────────────────────────────────────────────
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

// ── Lazy-render thresholds ─────────────────────────────────
const INITIAL_PACK_RENDER = 30;
const PACK_LOAD_INCREMENT = 20;

// ── Helpers ──────────────────────────────────────────────
function toLevelWeightInputs(weights: Record<SpellLevel, number>) {
    return Object.fromEntries(
        spellLevels.map((lvl) => [lvl, String(weights[lvl])]),
    ) as Record<SpellLevel, string>;
}
function toPackSettingInputs(values: Record<PackSettingKey, number>) {
    return Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value)]),
    ) as Record<PackSettingKey, string>;
}

// ── Component ────────────────────────────────────────────
export default function App() {
    const [gold, setGold] = useState(10000); 
    const [packPrice, setPackPrice] = useState(currencyPerPack);
    const [cardsInPack, setCardsInPack] = useState(cardsPerPack);
    const [conjurationRate, setConjurationRate] = useState(Math.round(conjurationChance * 100));
    const [packSettingInputs, setPackSettingInputs] = useState<Record<PackSettingKey, string>>(() => toPackSettingInputs({
        gold: 10000,
        packPrice: currencyPerPack,
        cardsInPack: cardsPerPack,
        conjurationRate: Math.round(conjurationChance * 100),
    }));
    const [levelWeights, setLevelWeights] = useState<Record<SpellLevel, number>>(defaultLevelWeights);
    const [levelWeightInputs, setLevelWeightInputs] = useState<Record<SpellLevel, string>>(() => toLevelWeightInputs(defaultLevelWeights));
    const [packs, setPacks] = useState<GeneratedResult[][]>([]);
    const [lastOpenedAt, setLastOpenedAt] = useState<string | null>(null);
    const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
    const [showMobileSettings, setShowMobileSettings] = useState(false);
    const [showMobileStats, setShowMobileStats] = useState(false);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [showEconomyModal, setShowEconomyModal] = useState(false);
    const [marketData, setMarketData] = useState<MarketEntry[] | null>(null);
    const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const mobileSettingsRef = useRef<HTMLDivElement | null>(null);
    const mobileSentinelRef = useRef<HTMLDivElement>(null);
    const xlSentinelRef = useRef<HTMLDivElement>(null);
    const [renderedPackCount, setRenderedPackCount] = useState(INITIAL_PACK_RENDER);

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

    const toggleFlip = useCallback((packIndex: number, cardIndex: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const key = `${packIndex}-${cardIndex}`;
        setFlippedCards((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

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
            if (e.key === 'Escape') { setSelectedCard(null); setShowStatsModal(false); setShowEconomyModal(false); return; }
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

    // Lazy-render: load more packs into the DOM as user scrolls
    useEffect(() => {
        const sentinels = [mobileSentinelRef.current, xlSentinelRef.current].filter(
            (el): el is HTMLDivElement => el !== null,
        );
        if (sentinels.length === 0 || renderedPackCount >= visiblePacks.length) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setRenderedPackCount((cur) => cur + PACK_LOAD_INCREMENT);
                }
            },
            { rootMargin: '400px' },
        );
        sentinels.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, [visiblePacks.length, renderedPackCount]);

    const spellOdds = useMemo(
        () => computeSpellOdds({ conjurationRate: conjurationRate, levelWeights, cardsInPack, packPrice }),
        [conjurationRate, levelWeights, cardsInPack, packPrice],
    );

    const levelDrawPcts = useMemo(() => {
        const totals: Record<number, number> = {};
        for (const { spell, pDraw } of spellOdds) {
            totals[spell.level] = (totals[spell.level] ?? 0) + pDraw;
        }
        return totals;
    }, [spellOdds]);

    useEffect(() => {
        setMarketData(null);
        const timer = setTimeout(() => {
            setMarketData(computeMarketData(spellOdds, { packPrice, cardsInPack }));
        }, 400);
        return () => clearTimeout(timer);
    }, [spellOdds, packPrice, cardsInPack]);

    const marketMap = useMemo(
        () => new Map(marketData?.map((e) => [e.spell.id, e]) ?? []),
        [marketData],
    );

    const packCount = packPrice > 0 ? Math.min(100_000, Math.max(0, Math.floor(gold / packPrice))) : 0;
    const totalCards = packCount * cardsInPack;

    const stats = useMemo(() => {
        const all = visiblePacks.flat();
        const goldSpent = visiblePacks.length * packPrice;
        const totalValue = all.reduce((sum, e) => {
            const entry = marketMap.get(e.card.id);
            if (!entry) return sum;
            if (e.isAutographed && entry.autographPrice != null) return sum + entry.autographPrice;
            if (e.isShiny) return sum + entry.shinyPrice;
            return sum + entry.currentPrice;
        }, 0);
        return {
            totalOpened: all.length,
            averageLevel: all.length ? (all.reduce((s, e) => s + e.card.level, 0) / all.length).toFixed(1) : '0.0',
            shiny: all.filter((e) => e.isShiny).length,
            autographed: all.filter((e) => e.isAutographed).length,
            rarity: countBy(all.map((e) => e.card.rarity)),
            pool: countBy(all.map((e) => e.pool)),
            schools: countBy(all.map((e) => e.card.school)),
            goldSpent,
            totalValue,
            profit: totalValue - goldSpent,
        };
    }, [visiblePacks, packPrice, marketMap]);

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

    const levelWeightSum = Object.values(levelWeights).reduce((a, b) => a + b, 0);

    function setLevelWeight(lvl: SpellLevel, value: number) {
        const nextValue = Math.max(0, value);
        setLevelWeights((cur) => ({ ...cur, [lvl]: nextValue }));
        setLevelWeightInputs((cur) => ({ ...cur, [lvl]: String(nextValue) }));
    }
    function handleLevelWeightInputChange(lvl: SpellLevel, value: string) {
        setLevelWeightInputs((cur) => ({ ...cur, [lvl]: value }));
        if (value === '') return;

        const nextValue = Number(value);
        if (Number.isNaN(nextValue)) return;

        setLevelWeights((cur) => ({ ...cur, [lvl]: Math.max(0, nextValue) }));
    }
    function handleLevelWeightInputBlur(lvl: SpellLevel) {
        const currentValue = levelWeightInputs[lvl].trim();
        setLevelWeight(lvl, currentValue === '' ? 0 : Number(currentValue));
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
            generatePack(cardsInPack, conjurationRate / 100, levelWeights)));
        setLastOpenedAt(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' at ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
        setSelectedCard(null);
        setFlippedCards({});
        setRenderedPackCount(INITIAL_PACK_RENDER);
        setShowMobileSettings(false);
    }
    function clearResults() {
        setPacks([]);
        setLastOpenedAt(null);
        setSelectedCard(null);
        setFlippedCards({});
        setRenderedPackCount(INITIAL_PACK_RENDER);
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
                    <p className={secTitle}>Level weights</p>
                    {Math.abs(levelWeightSum - 100) > 0.5 && <span className="text-yellow-400/80 text-[10px] font-medium">Sum ≠ 100 (now {levelWeightSum.toFixed(1)})</span>}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    {spellLevels.map((lvl) => (
                        <label key={lvl} className="grid gap-0.5 p-1.5 rounded-xl bg-white/5 border border-slate-700/50">
                            <span className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-medium leading-tight">{LEVEL_LABELS[lvl]}</span>
                            <input type="number" inputMode="decimal" min={0} step={0.1} value={levelWeightInputs[lvl as SpellLevel]}
                                onChange={(e) => handleLevelWeightInputChange(lvl as SpellLevel, e.target.value)} onBlur={() => handleLevelWeightInputBlur(lvl as SpellLevel)} className={inp} />
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
                    {visiblePacks.slice(0, renderedPackCount).map((pack, packIndex) => {
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
                                            className={`relative overflow-hidden p-2.5 rounded-xl bg-white/4 border border-slate-700/40 hover:bg-white/8 transition-colors cursor-zoom-in${entry.isShiny ? ' shiny-card' : ''}${entry.isAutographed ? ' autographed-card' : ''}`}
                                        >
                                            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 items-center sm:grid-cols-[6rem_minmax(0,1fr)]">
                                                <div className="relative overflow-hidden w-20 h-28 sm:w-24 sm:h-32 shrink-0 group">
                                                    <img
                                                        src={flippedCards[`${packIndex}-${cardIndex}`] && entry.card.backImageUrl
                                                            ? entry.card.backImageUrl
                                                            : entry.card.imageUrl}
                                                        alt={entry.card.fileName}
                                                        loading="lazy"
                                                        className="w-full h-full object-contain rounded-lg border border-slate-700/40 bg-slate-950/80"
                                                    />
                                                    {entry.card.backImageUrl && (
                                                        <button
                                                            type="button"
                                                            aria-label={flippedCards[`${packIndex}-${cardIndex}`] ? 'Show front' : 'Show back'}
                                                            onClick={(e) => toggleFlip(packIndex, cardIndex, e)}
                                                            className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center rounded-full bg-black/60 hover:bg-indigo-600 text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer z-10 shadow-lg"
                                                        >
                                                            <RefreshCw size={14} strokeWidth={2.5} />
                                                        </button>
                                                    )}
                                                </div>
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
                                                    {(() => {
                                                        const mEntry = marketMap.get(entry.card.id);
                                                        if (!mEntry) return null;
                                                        const price = entry.isShiny ? mEntry.shinyPrice
                                                            : entry.isAutographed ? (mEntry.autographPrice ?? mEntry.currentPrice)
                                                            : mEntry.currentPrice;
                                                        return (
                                                            <div className="flex items-center justify-start gap-1.5 mt-1.5">
                                                                <span className="text-xs font-semibold text-amber-400">{price} gp</span>
                                                                <span className={`text-xs font-medium ${mEntry.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                                    {mEntry.changePct >= 0 ? '+' : ''}{mEntry.changePct.toFixed(1)}%
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </article>
                        );
                    })}
                    {renderedPackCount < visiblePacks.length && (
                        <p className="text-center text-slate-500 text-xs py-2">
                            Showing {Math.min(renderedPackCount, visiblePacks.length)} of {visiblePacks.length} packs — scroll for more
                        </p>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <main className="flex flex-col h-dvh xl:block xl:overflow-hidden">

            {/* ══ MOBILE TOP BAR (compact, non-scrolling) ══════════════ */}
            <div className="xl:hidden shrink-0 border-b border-slate-700/40 bg-slate-950/95 px-2 pt-2 pb-2 z-10">
                <div className={`${panel} px-3 py-2 grid gap-1.5`}>
                    {/* Row 1: title + Open + Clear */}
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
                    </div>
                    {/* Row 2: Settings / Spell Odds / Economy */}
                    <div className="grid grid-cols-3 gap-1.5">
                        <button
                            type="button"
                            onClick={handleMobileSettingsClick}
                            aria-label="Toggle controls"
                            aria-controls="mobile-settings-panel"
                            aria-expanded={showMobileSettings}
                            className={`rounded-xl px-2 py-1.5 text-xs font-medium transition-all border ${showMobileSettings ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12'}`}
                        >
                            ⚙ Settings
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowStatsModal(true)}
                            aria-label="Spell odds"
                            className="rounded-xl px-2 py-1.5 text-xs font-medium transition-all border bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12"
                        >
                            📊 Odds
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowEconomyModal(true)}
                            aria-label="Economy"
                            className="rounded-xl px-2 py-1.5 text-xs font-medium transition-all border bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12"
                        >
                            💰 Market
                        </button>
                    </div>
                    {lastOpenedAt && <p className="text-xs text-slate-500 mb-0 leading-none">Last: {lastOpenedAt}</p>}
                </div>
            </div>

            {/* ══ MOBILE SCROLLABLE ZONE ═══════════════════════════════ */}
            <div className="xl:hidden flex-1 min-h-0 overflow-y-auto px-2 py-3 pb-28">
                {showMobileSettings && <div className="mb-3">{mobileSettingsPanel}</div>}
                {cardGrid}
                <div ref={mobileSentinelRef} className="h-1" />
            </div>

            {/* ══ XL THREE-COLUMN LAYOUT ═══════════════════════════════ */}
            <section className="hidden xl:grid xl:h-full max-w-screen-3xl mx-auto gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_16rem] xl:px-1 xl:py-0">

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
                                <p className={secTitle}>Level weights</p>
                                {Math.abs(levelWeightSum - 100) > 0.5 && <span className="text-yellow-400/80 text-xs font-medium">Sum ≠ 100 (now {levelWeightSum.toFixed(1)})</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {spellLevels.map((lvl) => (
                                    <label key={lvl} className={field}>
                                        <span className="text-xs uppercase tracking-wider text-indigo-300/80 font-medium">{LEVEL_LABELS[lvl]}</span>
                                        <input type="number" inputMode="decimal" min={0} step={0.1} value={levelWeightInputs[lvl as SpellLevel]}
                                            onChange={(e) => handleLevelWeightInputChange(lvl as SpellLevel, e.target.value)} onBlur={() => handleLevelWeightInputBlur(lvl as SpellLevel)} className={inp} />
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
                    <div ref={xlSentinelRef} className="h-1" />
                </section>

                {/* ── RIGHT RAIL ── */}
                <aside className="min-w-0 grid gap-3 grid-cols-1 overflow-y-auto py-4 content-start">

                    <section className={`${panel} p-4`}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-3">Session stats</h2>
                        <div className="grid gap-2">
                            {sessionStats.map(({ label, value }) => (
                                <div key={label} className="flex justify-between items-baseline gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-slate-700/50">
                                    <span className={statLabel + ' shrink-0'}>{label}</span>
                                    <strong className="text-sm font-bold text-slate-100 text-right leading-none">{fmtStat(value as number)}</strong>
                                </div>
                            ))}
                            {marketData != null && stats.totalOpened > 0 && (
                                <div className="flex justify-between items-baseline gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-slate-700/50">
                                    <span className={statLabel + ' shrink-0'}>Gold profit</span>
                                    <strong className={`text-sm font-bold text-right leading-none ${stats.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {stats.profit >= 0 ? '+' : ''}{fmtGold(Math.abs(stats.profit))}
                                    </strong>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className={`${panel} p-4`}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-2.5">By Level</h2>
                        <ul className="list-none p-0 m-0 grid gap-1.5">
                            {spellLevels.map((lvl) => {
                                const levelCount = visiblePacks.flat().filter((e) => e.card.level === lvl).length;
                                return (
                                    <li key={lvl} className={row}>
                                        <span className="text-slate-300">{LEVEL_LABELS[lvl]}</span>
                                        <strong className="text-slate-100">{fmtStat(levelCount)}</strong>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>

                    <section className={`${panel} p-4`}>
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-2.5">Schools</h2>
                        <ul className="list-none p-0 m-0 grid gap-1.5">
                            {schoolOrder.map((school) => (
                                <li key={school} className={row}>
                                    <span className="text-slate-300">{school}</span>
                                    <strong className="text-slate-100">{fmtStat(stats.schools[school] ?? 0)}</strong>
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
                                        <strong className="text-slate-100">{fmtStat(value as number)}</strong>
                                    </div>
                                ))}
                                {marketData != null && stats.totalOpened > 0 && (
                                    <div className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                                        <span className="text-slate-300">Gold profit</span>
                                        <strong className={stats.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                            {stats.profit >= 0 ? '+' : ''}{fmtGold(Math.abs(stats.profit))}
                                        </strong>
                                    </div>
                                )}
                            </section>
                            <section className="grid gap-2">
                                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">By Level</h2>
                                {spellLevels.map((lvl) => {
                                    const levelCount = visiblePacks.flat().filter((e) => e.card.level === lvl).length;
                                    return (
                                        <div key={lvl} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                                            <span className="text-slate-300">{LEVEL_LABELS[lvl]}</span>
                                            <strong className="text-slate-100">{fmtStat(levelCount)}</strong>
                                        </div>
                                    );
                                })}
                            </section>
                            <section className="grid gap-2">
                                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0 mb-0">Schools</h2>
                                {schoolOrder.map((school) => (
                                    <div key={school} className="flex justify-between gap-2 text-xs rounded-lg bg-white/5 border border-slate-700/50 px-3 py-2">
                                        <span className="text-slate-300">{school}</span>
                                        <strong className="text-slate-100">{fmtStat(stats.schools[school] ?? 0)}</strong>
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
                                    <div className="text-sm font-semibold text-slate-50">{fmtStat(value)}</div>
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
                                            src={flippedCards[`${selectedCard.packIndex}-${selectedCard.cardIndex}`] && selectedCard.card.backImageUrl
                                                ? selectedCard.card.backImageUrl
                                                : selectedCard.card.imageUrl}
                                            alt={selectedCard.card.displayName}
                                            className="object-contain max-w-full max-h-full"
                                        />
                                        {selectedCard.card.backImageUrl && (
                                            <button
                                                type="button"
                                                aria-label={flippedCards[`${selectedCard.packIndex}-${selectedCard.cardIndex}`] ? 'Show front' : 'Show back'}
                                                onClick={(e) => toggleFlip(selectedCard.packIndex, selectedCard.cardIndex, e)}
                                                className="absolute top-2 right-2 w-10 h-10 flex items-center justify-center rounded-full bg-black/60 hover:bg-indigo-600 text-white opacity-50 hover:opacity-100 transition-all cursor-pointer z-10 shadow-lg"
                                            >
                                                <RefreshCw size={20} strokeWidth={2} />
                                            </button>
                                        )}
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

                                    {/* Market price */}
                                    {(() => {
                                        const mEntry = marketMap.get(selectedCard.card.id);
                                        if (!mEntry) return null;
                                        const price = selectedCard.isShiny ? mEntry.shinyPrice
                                            : selectedCard.isAutographed ? (mEntry.autographPrice ?? mEntry.currentPrice)
                                            : mEntry.currentPrice;
                                        return (
                                            <div className="rounded-xl p-3 bg-white/5 border border-slate-700/50">
                                                <p className={`${secTitle} mb-1.5`}>Market price</p>
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-lg font-bold text-slate-100">{price} gp</span>
                                                    <span className={`text-sm font-medium ${mEntry.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {mEntry.changePct >= 0 ? '+' : ''}{mEntry.changePct.toFixed(1)}%
                                                    </span>
                                                    <span className="text-xs text-slate-500 ml-auto">vs yesterday</span>
                                                </div>
                                            </div>
                                        );
                                    })()}

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
                                        {/* Pack navigation buttons */}
                                        <button
                                            type="button"
                                            onClick={() => navigate(-1, 0)}
                                            disabled={!canPrevPack}
                                            className="rounded-xl py-2.5 bg-white/5 border border-slate-700/40 text-slate-400 text-sm font-medium hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            ↑ Prev pack
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => navigate(1, 0)}
                                            disabled={!canNextPack}
                                            className="rounded-xl py-2.5 bg-white/5 border border-slate-700/40 text-slate-400 text-sm font-medium hover:bg-white/10 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            Next pack ↓
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
                <OddsModal onClose={() => setShowStatsModal(false)} spellOdds={spellOdds} cardsInPack={cardsInPack} packPrice={packPrice} conjurationRate={conjurationRate} levelWeights={levelWeights} />
            )}

            {/* ══ ECONOMY MODAL ══════════════════════════════════════ */}
            {showEconomyModal && (
                <MarketModal onClose={() => setShowEconomyModal(false)} marketData={marketData} packPrice={packPrice} cardsInPack={cardsInPack} conjurationRate={conjurationRate} levelDrawPcts={levelDrawPcts} />
            )}
        </main>
    );
}
