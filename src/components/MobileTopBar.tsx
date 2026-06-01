import { panel, eyebrow } from './tokens';

type Props = {
    packCount: number;
    totalCards: number;
    cardsInPack: number;
    lastOpenedAt: string | null;
    showSettings: boolean;
    onToggleSettings: () => void;
    onOpenPacks: () => void;
    onClear: () => void;
    onShowOdds: () => void;
    onShowMarket: () => void;
};

export default function MobileTopBar({
    packCount, totalCards, cardsInPack, lastOpenedAt,
    showSettings, onToggleSettings,
    onOpenPacks, onClear, onShowOdds, onShowMarket,
}: Props) {
    return (
        <div className="xl:hidden shrink-0 border-b border-slate-700/40 bg-slate-950/95 px-2 pt-2 pb-2 z-10">
            <div className={`${panel} px-3 py-2 grid gap-1.5`}>
                <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                        <p className={eyebrow}>5e Scroll Pack Opener</p>
                        <p className="text-xs text-slate-400 mt-0.5 mb-0 leading-none">{packCount} pack{packCount !== 1 ? 's' : ''} ready · {totalCards} cards</p>
                    </div>
                    <button
                        type="button"
                        onClick={onOpenPacks}
                        disabled={packCount === 0 || cardsInPack <= 0}
                        className="shrink-0 rounded-xl px-3 py-2 bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold shadow disabled:opacity-40 disabled:cursor-not-allowed border-0 transition-all"
                    >
                        Open {packCount}
                    </button>
                    <button
                        type="button"
                        onClick={onClear}
                        className="shrink-0 rounded-xl px-2.5 py-2 bg-white/8 text-slate-200 text-sm font-medium border border-slate-700/50 transition-all hover:bg-white/12"
                    >
                        Clear
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    <button
                        type="button"
                        onClick={onToggleSettings}
                        aria-label="Toggle controls"
                        aria-controls="mobile-settings-panel"
                        aria-expanded={showSettings}
                        className={`rounded-xl px-2 py-1.5 text-xs font-medium transition-all border ${showSettings ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12'}`}
                    >
                        ⚙ Settings
                    </button>
                    <button
                        type="button"
                        onClick={onShowOdds}
                        aria-label="Spell odds"
                        className="rounded-xl px-2 py-1.5 text-xs font-medium transition-all border bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12"
                    >
                        📊 Odds
                    </button>
                    <button
                        type="button"
                        onClick={onShowMarket}
                        aria-label="Economy"
                        className="rounded-xl px-2 py-1.5 text-xs font-medium transition-all border bg-white/8 text-slate-200 border-slate-700/50 hover:bg-white/12"
                    >
                        💰 Market
                    </button>
                </div>
                {lastOpenedAt && <p className="text-xs text-slate-500 mb-0 leading-none">Last: {lastOpenedAt}</p>}
            </div>
        </div>
    );
}
