import { type PackPreset, getPackRarityBreakdown } from '../utils/presets';
import { invertLevelWeights } from '../utils/pack';
import { formatRarity } from '../utils/format';
import { panel, eyebrow, secTitle, field, row, inp, muted, getRarityTagClass } from './tokens';
import PackPresetPicker from './PackPresetPicker';

type Props = {
    presets: PackPreset[];
    selectedPreset: PackPreset;
    onSelectPreset: (preset: PackPreset) => void;
    isMirrored: boolean;
    onToggleMirror: () => void;
    goldInputValue: string;
    onGoldChange: (value: string) => void;
    onGoldBlur: () => void;
    packCount: number;
    cardsInPack: number;
    libraryInfo: ReadonlyArray<readonly [string, number]>;
    onOpenPacks: () => void;
    onClear: () => void;
    onShowOdds: () => void;
    onShowMarket: () => void;
};

export default function DesktopLeftRail({
    presets, selectedPreset, onSelectPreset,
    isMirrored, onToggleMirror,
    goldInputValue, onGoldChange, onGoldBlur,
    packCount, cardsInPack, libraryInfo,
    onOpenPacks, onClear, onShowOdds, onShowMarket,
}: Props) {
    const mirroredRarityRows = getPackRarityBreakdown(invertLevelWeights(selectedPreset.levelWeights));

    return (
        <aside className="min-w-0 overflow-y-auto py-4">
            <div className={`${panel} grid gap-0 p-0 overflow-hidden`}>
                <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
                    <p className={eyebrow}>5e Scroll Pack Opener</p>
                    <h1 className="text-xl sm:text-2xl font-bold leading-tight mt-1 mb-1 text-slate-50">Pack controls</h1>
                    <p className={`${muted} leading-snug`}>Configure values, then open a batch on the right.</p>
                </div>

                <div className="px-4 py-2.5 border-b border-slate-700/50 grid gap-1.5">
                    <div className="flex items-center justify-between">
                        <p className={secTitle}>Pack type</p>
                        <div className="relative group/mirror">
                            <button
                                type="button"
                                onClick={onToggleMirror}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all border ${
                                    isMirrored
                                        ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                                        : 'bg-white/5 text-slate-400 border-slate-700/50 hover:bg-white/8'
                                }`}
                            >
                                <span>🪞</span>
                                <span>Mirror</span>
                            </button>
                            <div className="absolute top-full right-0 mt-1 z-50 w-52 rounded-xl bg-slate-900 border border-slate-700/60 shadow-xl p-2.5 opacity-0 group-hover/mirror:opacity-100 transition-opacity pointer-events-none">
                                <p className="text-xs font-semibold text-slate-300 mb-1.5 pb-1 border-b border-slate-700/50">
                                    <span className="block">Mirror Mode</span>
                                    <span className={`block text-[10px] font-normal mt-0.5 ${isMirrored ? 'text-amber-300' : 'text-slate-400'}`}>
                                        {isMirrored ? 'Active' : 'Inactive'}
                                    </span>
                                </p>
                                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 my-1.5">
                                    {mirroredRarityRows.map(({ rarity, pct, levelLabel }) => (
                                        <div key={levelLabel} className="contents">
                                            <span className={`${getRarityTagClass(rarity)} px-1.5 py-0.5 rounded border text-xs capitalize`}>
                                                {formatRarity(rarity)}
                                            </span>
                                            <span className="text-slate-400 text-xs">{levelLabel}</span>
                                            <span className="text-slate-200 text-xs font-medium text-right tabular-nums">{pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct >= 0.1 ? pct.toFixed(2) : pct.toFixed(3)}%</span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-700/50">
                                    L9↔L0, L8↔L1, L7↔L2, etc.
                                </p>
                            </div>
                        </div>
                    </div>
                    <PackPresetPicker presets={presets} selectedId={selectedPreset.id} onSelect={onSelectPreset} />
                </div>

                <div className="px-4 py-2.5 border-b border-slate-700/50 grid gap-1.5">
                    <button
                        type="button"
                        onClick={onOpenPacks}
                        disabled={packCount === 0 || cardsInPack <= 0}
                        className="w-full rounded-xl px-3 py-2 bg-gradient-to-br from-violet-500 to-blue-500 text-white text-sm font-semibold shadow-lg transition-all hover:-translate-y-px hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:brightness-100 border-0"
                    >
                        Open {packCount} {selectedPreset.name}{packCount !== 1 ? 's' : ''}
                    </button>
                    <button
                        type="button"
                        onClick={onClear}
                        className="w-full rounded-xl px-3 py-2 bg-white/8 text-slate-200 text-sm font-medium transition-all hover:-translate-y-px hover:bg-white/12 border border-slate-700/50"
                    >
                        Clear
                    </button>
                    <button
                        type="button"
                        onClick={onShowOdds}
                        className="w-full rounded-xl px-3 py-1.5 bg-white/8 text-slate-200 text-xs font-medium transition-all hover:bg-white/12 border border-slate-700/50"
                    >
                        📊 Odds
                    </button>
                    <button
                        type="button"
                        onClick={onShowMarket}
                        className="w-full rounded-xl px-3 py-1.5 bg-white/8 text-slate-200 text-xs font-medium transition-all hover:bg-white/12 border border-slate-700/50"
                    >
                        💰 Market
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-slate-700/50 grid gap-2.5">
                    <p className={secTitle}>Pack settings</p>
                    <label className={field}>
                        <span className="text-xs uppercase tracking-wider text-indigo-300/80 font-medium">Gold budget</span>
                        <input
                            type="number"
                            min={0}
                            step={5}
                            value={goldInputValue}
                            onChange={(e) => onGoldChange(e.target.value)}
                            onBlur={onGoldBlur}
                            className={inp}
                        />
                    </label>
                </div>

                <div className="px-4 py-3 grid gap-2.5">
                    <p className={secTitle}>Information</p>
                    <ul className="list-none p-0 m-0 grid gap-1.5">
                        {libraryInfo.map(([label, val]) => (
                            <li key={label} className={row}>
                                <span className="text-slate-300">{label}</span>
                                <strong className="text-slate-100">{val}</strong>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </aside>
    );
}
