import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { spellCards } from './utils/spells';
import { generatePack, invertLevelWeights, countBy, hasCard, type GeneratedResult, type SelectedCard } from './utils/pack';
import { computeSpellOdds } from './utils/odds';
import { computeMarketData, type MarketEntry } from './utils/pricing';
import { PACK_PRESETS, type PackPreset } from './utils/presets';

import OddsModal from './components/OddsModal';
import MarketModal from './components/MarketModal';
import SpellCardGrid from './components/SpellCardGrid';
import CardLightbox from './components/CardLightbox';
import DesktopLeftRail from './components/DesktopLeftRail';
import MobileTopBar from './components/MobileTopBar';
import MobileBottomBar from './components/MobileBottomBar';
import MobileSettingsPanel from './components/MobileSettingsPanel';
import { SessionStatsPanel, LevelStatsPanel, SchoolStatsPanel } from './components/StatsPanels';

// Lazy-render thresholds
const INITIAL_PACK_RENDER = 30;
const PACK_LOAD_INCREMENT = 20;
let STARTING_GOLD = 1000;

export default function App() {
    // ── Core state ───────────────────────────────────────
    const [gold, setGold] = useState(STARTING_GOLD);
    const [goldInput, setGoldInput] = useState(STARTING_GOLD.toString());
    const [selectedPresetId, setSelectedPresetId] = useState<string>(PACK_PRESETS[0].id);
    const [packs, setPacks] = useState<GeneratedResult[][]>([]);
    const [lastOpenedAt, setLastOpenedAt] = useState<string | null>(null);
    const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
    const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
    const [marketData, setMarketData] = useState<MarketEntry[] | null>(null);
    const [renderedPackCount, setRenderedPackCount] = useState(INITIAL_PACK_RENDER);
    const [isMirrored, setIsMirrored] = useState(false);

    // ── UI state ─────────────────────────────────────────
    const [showMobileSettings, setShowMobileSettings] = useState(false);
    const [showMobileStats, setShowMobileStats] = useState(false);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [showEconomyModal, setShowEconomyModal] = useState(false);

    const mobileSettingsRef = useRef<HTMLDivElement | null>(null);
    const mobileSentinelRef = useRef<HTMLDivElement>(null);
    const xlSentinelRef = useRef<HTMLDivElement>(null);

    const selectedPreset = PACK_PRESETS.find((p) => p.id === selectedPresetId) ?? PACK_PRESETS[0];
    const effectiveLevelWeights = useMemo(
        () => (isMirrored ? invertLevelWeights(selectedPreset.levelWeights) : selectedPreset.levelWeights),
        [isMirrored, selectedPreset.levelWeights],
    );

    // ── Derived values ───────────────────────────────────
    const visiblePacks = useMemo(
        () => packs.map((pack) => pack.filter(hasCard)).filter((pack) => pack.length > 0),
        [packs],
    );
    const visibleCards = useMemo(() => visiblePacks.flat(), [visiblePacks]);

    const packCount = selectedPreset.packPrice > 0
        ? Math.min(100_000, Math.max(0, Math.floor(gold / selectedPreset.packPrice)))
        : 0;
    const totalCards = packCount * selectedPreset.cardsInPack;

    const spellOdds = useMemo(
        () => computeSpellOdds({
            conjurationRate: selectedPreset.conjurationRate,
            levelWeights: selectedPreset.levelWeights,
            cardsInPack: selectedPreset.cardsInPack,
            packPrice: selectedPreset.packPrice,
        }),
        [selectedPreset],
    );

    const levelDrawPcts = useMemo(() => {
        const totals: Record<number, number> = {};
        for (const { spell, pDraw } of spellOdds) {
            totals[spell.level] = (totals[spell.level] ?? 0) + pDraw;
        }
        return totals;
    }, [spellOdds]);

    const marketMap = useMemo(
        () => new Map(marketData?.map((e) => [e.spell.id, e]) ?? []),
        [marketData],
    );

    const stats = useMemo(() => {
        const goldSpent = visiblePacks.length * selectedPreset.packPrice;
        const totalValue = visibleCards.reduce((sum, e) => {
            const entry = marketMap.get(e.card.id);
            if (!entry) return sum;
            if (e.isAutographed && entry.autographPrice != null) return sum + entry.autographPrice;
            if (e.isShiny) return sum + entry.shinyPrice;
            return sum + entry.currentPrice;
        }, 0);
        return {
            totalOpened: visibleCards.length,
            averageLevel: visibleCards.length
                ? (visibleCards.reduce((s, e) => s + e.card.level, 0) / visibleCards.length).toFixed(1)
                : '0.0',
            shiny: visibleCards.filter((e) => e.isShiny).length,
            autographed: visibleCards.filter((e) => e.isAutographed).length,
            pool: countBy(visibleCards.map((e) => e.pool)),
            schools: countBy(visibleCards.map((e) => e.card.school)),
            goldSpent,
            totalValue,
            profit: totalValue - goldSpent,
        };
    }, [visiblePacks.length, visibleCards, selectedPreset.packPrice, marketMap]);

    const libStats = useMemo(() => {
        const c = spellCards.filter((c) => c.pool === 'conjuration').length;
        return { total: spellCards.length, conjuration: c, staple: spellCards.length - c };
    }, []);

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

    const profitOrNull = marketData != null && stats.totalOpened > 0 ? stats.profit : null;

    // ── Effects ──────────────────────────────────────────
    // Market data: debounced recompute on preset/odds change
    useEffect(() => {
        setMarketData(null);
        const timer = setTimeout(() => {
            setMarketData(computeMarketData(spellOdds, {
                packPrice: selectedPreset.packPrice,
                cardsInPack: selectedPreset.cardsInPack,
                baseRate: selectedPreset.baseRate,
                shinyMultiplierAvg: selectedPreset.shinyMultiplierAvg,
                autoMultiplierAvg: selectedPreset.autoMultiplierAvg,
                autoLegMultiplierAvg: selectedPreset.autoLegMultiplierAvg,
            }));
        }, 400);
        return () => clearTimeout(timer);
    }, [spellOdds, selectedPreset]);

    // Modal keyboard navigation
    const navigate = useCallback((dPack: number, dCard: number) => {
        setSelectedCard((cur) => {
            if (!cur) return null;
            const newPackIndex = Math.max(0, Math.min(visiblePacks.length - 1, cur.packIndex + dPack));
            const newPack = visiblePacks[newPackIndex];
            if (!newPack) return null;
            const newCardIndex = Math.max(0, Math.min(newPack.length - 1, cur.cardIndex + dCard));
            const entry = newPack[newCardIndex];
            if (!entry) return null;
            return {
                card: entry.card, pool: entry.pool,
                isShiny: entry.isShiny, isAutographed: entry.isAutographed,
                packIndex: newPackIndex, cardIndex: newCardIndex,
            };
        });
    }, [visiblePacks]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setSelectedCard(null);
                setShowStatsModal(false);
                setShowEconomyModal(false);
                return;
            }
            if (!selectedCard) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(0, -1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); navigate(0, 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); navigate(-1, 0); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); navigate(1, 0); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedCard, navigate]);

    // Focus the mobile settings panel when it opens
    useEffect(() => {
        if (!showMobileSettings) return;
        window.requestAnimationFrame(() => {
            mobileSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            mobileSettingsRef.current?.focus({ preventScroll: true });
        });
    }, [showMobileSettings]);

    // Lazy-render: load more packs as user scrolls
    useEffect(() => {
        const sentinels = [mobileSentinelRef.current, xlSentinelRef.current]
            .filter((el): el is HTMLDivElement => el !== null);
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

    // ── Handlers ─────────────────────────────────────────
    const toggleFlip = useCallback((packIndex: number, cardIndex: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const key = `${packIndex}-${cardIndex}`;
        setFlippedCards((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    function handleGoldChange(value: string) {
        setGoldInput(value);
        if (value === '') return;
        const n = Number(value);
        if (!Number.isNaN(n)) setGold(Math.max(0, Math.trunc(n)));
    }
    function handleGoldBlur() {
        const v = goldInput.trim();
        const n = v === '' ? 0 : Math.max(0, Math.trunc(Number(v)));
        setGold(n);
        setGoldInput(String(n));
    }

    function resetSession() {
        setSelectedCard(null);
        setFlippedCards({});
        setRenderedPackCount(INITIAL_PACK_RENDER);
    }

    function openPacks() {
        setPacks(Array.from({ length: packCount }, () =>
            generatePack(selectedPreset.cardsInPack, selectedPreset.conjurationRate / 100, effectiveLevelWeights, selectedPreset.shinyChance, selectedPreset.autographChance)));
        const now = new Date();
        setLastOpenedAt(
            now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            + ' at '
            + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        );
        resetSession();
        setShowMobileSettings(false);
    }

    function clearResults() {
        setPacks([]);
        setLastOpenedAt(null);
        resetSession();
        setShowMobileStats(false);
    }

    function applyPreset(preset: PackPreset) {
        setSelectedPresetId(preset.id);
        setPacks([]);
        setLastOpenedAt(null);
        resetSession();
    }

    function handleMobileSettingsClick() {
        setShowMobileStats(false);
        setShowMobileSettings((cur) => !cur);
    }

    // ── Modal nav state ──────────────────────────────────
    const currentPack = selectedCard ? visiblePacks[selectedCard.packIndex] : null;
    const canPrevCard = selectedCard != null && selectedCard.cardIndex > 0;
    const canNextCard = selectedCard != null && currentPack != null && selectedCard.cardIndex < currentPack.length - 1;
    const canPrevPack = selectedCard != null && selectedCard.packIndex > 0;
    const canNextPack = selectedCard != null && selectedCard.packIndex < visiblePacks.length - 1;

    const cardGrid = (
        <SpellCardGrid
            packs={visiblePacks}
            renderedCount={renderedPackCount}
            flippedCards={flippedCards}
            marketMap={marketMap}
            onSelectCard={setSelectedCard}
            onToggleFlip={toggleFlip}
        />
    );

    return (
        <main className="flex flex-col h-dvh xl:block xl:overflow-hidden">

            <MobileTopBar
                packCount={packCount}
                totalCards={totalCards}
                cardsInPack={selectedPreset.cardsInPack}
                lastOpenedAt={lastOpenedAt}
                showSettings={showMobileSettings}
                onToggleSettings={handleMobileSettingsClick}
                onOpenPacks={openPacks}
                onClear={clearResults}
                onShowOdds={() => setShowStatsModal(true)}
                onShowMarket={() => setShowEconomyModal(true)}
            />

            {/* MOBILE SCROLL ZONE */}
            <div className="xl:hidden flex-1 min-h-0 overflow-y-auto px-2 py-3 pb-28">
                {showMobileSettings && (
                    <div className="mb-3">
                        <MobileSettingsPanel
                            ref={mobileSettingsRef}
                            presets={PACK_PRESETS}
                            selectedPreset={selectedPreset}
                            onSelectPreset={applyPreset}
                            isMirrored={isMirrored}
                            onToggleMirror={() => setIsMirrored((m) => !m)}
                            goldInputValue={goldInput}
                            onGoldChange={handleGoldChange}
                            onGoldBlur={handleGoldBlur}
                            libraryInfo={libraryInfo}
                        />
                    </div>
                )}
                {cardGrid}
                <div ref={mobileSentinelRef} className="h-1" />
            </div>

            {/* XL THREE-COLUMN LAYOUT */}
            <section className="hidden xl:grid xl:h-full max-w-screen-3xl mx-auto gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_16rem] xl:px-1 xl:py-0">

                <DesktopLeftRail
                    presets={PACK_PRESETS}
                    selectedPreset={selectedPreset}
                    onSelectPreset={applyPreset}
                    isMirrored={isMirrored}
                    onToggleMirror={() => setIsMirrored((m) => !m)}
                    goldInputValue={goldInput}
                    onGoldChange={handleGoldChange}
                    onGoldBlur={handleGoldBlur}
                    packCount={packCount}
                    cardsInPack={selectedPreset.cardsInPack}
                    libraryInfo={libraryInfo}
                    onOpenPacks={openPacks}
                    onClear={clearResults}
                    onShowOdds={() => setShowStatsModal(true)}
                    onShowMarket={() => setShowEconomyModal(true)}
                />

                <section className="min-w-0 overflow-y-auto py-4 px-3">
                    <div className="grid gap-3">{cardGrid}</div>
                    <div ref={xlSentinelRef} className="h-1" />
                </section>

                <aside className="min-w-0 grid gap-3 grid-cols-1 overflow-y-auto py-4 content-start">
                    <SessionStatsPanel variant="desktop" sessionStats={sessionStats} profit={profitOrNull} />
                    <LevelStatsPanel variant="desktop" visibleCards={visibleCards} />
                    <SchoolStatsPanel variant="desktop" schoolCounts={stats.schools} />
                </aside>
            </section>

            <MobileBottomBar
                visiblePacks={visiblePacks}
                visibleCards={visibleCards}
                sessionStats={sessionStats}
                schoolCounts={stats.schools}
                shinyCount={stats.shiny}
                autographedCount={stats.autographed}
                totalOpened={stats.totalOpened}
                profit={profitOrNull}
                showStats={showMobileStats}
                onToggleStats={() => setShowMobileStats((cur) => !cur)}
            />

            {selectedCard && (
                <CardLightbox
                    selected={selectedCard}
                    currentPack={currentPack}
                    totalPacks={visiblePacks.length}
                    flippedCards={flippedCards}
                    marketMap={marketMap}
                    canPrevCard={canPrevCard}
                    canNextCard={canNextCard}
                    canPrevPack={canPrevPack}
                    canNextPack={canNextPack}
                    onClose={() => setSelectedCard(null)}
                    onNavigate={navigate}
                    onToggleFlip={toggleFlip}
                />
            )}

            {showStatsModal && (
                <OddsModal onClose={() => setShowStatsModal(false)} initialPackId={selectedPresetId} />
            )}

            {showEconomyModal && (
                <MarketModal
                    onClose={() => setShowEconomyModal(false)}
                    marketData={marketData}
                    packPrice={selectedPreset.packPrice}
                    cardsInPack={selectedPreset.cardsInPack}
                    conjurationRate={selectedPreset.conjurationRate}
                    levelDrawPcts={levelDrawPcts}
                    presetName={selectedPreset.name}
                />
            )}
        </main>
    );
}
