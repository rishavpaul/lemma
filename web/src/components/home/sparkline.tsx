export function Sparkline({ values, min = 1, max = 4, w = 160, h = 44, staffBar = 3 }: { values: number[]; min?: number; max?: number; w?: number; h?: number; staffBar?: number }) {
  if (values.length < 2) return null;
  const x = (i: number) => 3 + (i / (values.length - 1)) * (w - 6);
  const y = (v: number) => h - 3 - ((v - min) / (max - min)) * (h - 6);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Scores over your last ${values.length} sessions`} className="overflow-visible">
      <line x1="0" x2={w} y1={y(staffBar)} y2={y(staffBar)} stroke="var(--mint)" strokeWidth="1.5" strokeOpacity=".45" />
      <polyline points={pts} fill="none" stroke="var(--signal)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill="var(--signal)" />
    </svg>
  );
}
