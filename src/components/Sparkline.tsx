type SparklineProps = {
    prices: number[];
    up: boolean;
};

export default function Sparkline({ prices, up }: SparklineProps) {
    if (prices.length < 2) return <span className="inline-block w-12 sm:w-20 h-6 sm:h-7" />;
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
        <svg viewBox={`0 0 ${W} ${H}`} className="w-12 sm:w-20 h-6 sm:h-7 shrink-0 overflow-visible">
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
