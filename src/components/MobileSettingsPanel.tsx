import { forwardRef } from 'react';
import { type PackPreset, getPackRarityBreakdown } from '../utils/presets';
import { invertLevelWeights } from '../utils/pack';
import { formatRarity } from '../utils/format';
import { panel, secTitle, inp, getRarityTagClass } from './tokens';
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
    libraryInfo: ReadonlyArray<readonly [string, number]>;
};

const MobileSettingsPanel = forwardRef<HTMLDivElement, Props>(function MobileSettingsPanel({
    presets, selectedPreset, onSelectPreset,
    isMirrored, onToggleMirror,
    goldInputValue, onGoldChange, onGoldBlur, libraryInfo,
}, ref) {
    const mirroredRarityRows = getPackRarityBreakdown(invertLevelWeights(selectedPreset.levelWeights));

    return (
        <div
            ref={ref}
            id="mobile-settings-panel"
            tabIndex={-1}
            className={`${panel} overflow-hidden xl:hidden focus:outline-none focus:ring-2 focus:ring-indigo-500/50`}
        >
            <div className="px-3 py-2 border-b border-slate-700/50 grid gap-2">
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

            <div className="px-3 py-2 border-b border-slate-700/50 grid gap-2">
                <p className={secTitle}>Pack settings</p>
                <label className="grid gap-0.5 p-1.5 rounded-xl bg-white/5 border border-slate-700/50">
                    <span className="text-[10px] uppercase tracking-wider text-indigo-300/80 font-medium leading-tight">Gold budget</span>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={5}
                        value={goldInputValue}
                        onChange={(e) => onGoldChange(e.target.value)}
                        onBlur={onGoldBlur}
                        className={inp}
                    />
                </label>
            </div>

            <div className="px-3 py-2 grid gap-1.5">
                <p className={secTitle}>Information</p>
                <div className="grid grid-cols-2 gap-1">
                    {libraryInfo.map(([label, val]) => (
                        <div key={label} className="flex justify-between gap-1 px-2 py-1 text-xs rounded-lg bg-white/5 border border-slate-700/50">
                            <span className="text-slate-300 truncate">{label}</span>
                            <strong className="text-slate-100 shrink-0">{val}</strong>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default MobileSettingsPanel;
