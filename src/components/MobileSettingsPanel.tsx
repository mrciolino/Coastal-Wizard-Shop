import { forwardRef } from 'react';
import { type PackPreset } from '../utils/presets';
import { panel, secTitle, inp } from './tokens';
import PackPresetPicker from './PackPresetPicker';

type Props = {
    presets: PackPreset[];
    selectedPreset: PackPreset;
    onSelectPreset: (preset: PackPreset) => void;
    goldInputValue: string;
    onGoldChange: (value: string) => void;
    onGoldBlur: () => void;
    libraryInfo: ReadonlyArray<readonly [string, number]>;
};

const MobileSettingsPanel = forwardRef<HTMLDivElement, Props>(function MobileSettingsPanel({
    presets, selectedPreset, onSelectPreset,
    goldInputValue, onGoldChange, onGoldBlur, libraryInfo,
}, ref) {
    return (
        <div
            ref={ref}
            id="mobile-settings-panel"
            tabIndex={-1}
            className={`${panel} overflow-hidden xl:hidden focus:outline-none focus:ring-2 focus:ring-indigo-500/50`}
        >
            <div className="px-3 py-2 border-b border-slate-700/50 grid gap-2">
                <p className={secTitle}>Pack type</p>
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
