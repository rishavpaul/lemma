"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dimLabel } from "@/lib/format";

const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }, cursor: { fill: "var(--muted)", opacity: 0.4 } };

export function DimensionChart({ scores }: { scores: Record<string, { score: number }> }) {
  const data = Object.entries(scores).map(([k, v]) => ({ name: dimLabel(k), score: v.score }));
  return (
    <ResponsiveContainer width="100%" height={data.length * 30 + 30}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" domain={[1, 4]} ticks={[1, 2, 3, 4]} tick={tick} stroke="var(--border)" />
        <YAxis type="category" dataKey="name" width={150} tick={tick} stroke="var(--border)" interval={0} />
        <Tooltip {...tip} />
        <ReferenceLine x={3} stroke="var(--mint)" strokeDasharray="4 4" label={{ value: "staff", fill: "var(--mint)", fontSize: 11, position: "top" }} />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((d) => <Cell key={d.name} fill={d.score >= 3 ? "var(--mint)" : d.score >= 2 ? "var(--signal)" : "var(--coral)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TimeChart({ rows }: { rows: { name: string; used: number; budget: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="name" tick={tick} stroke="var(--border)" interval={0} angle={-30} textAnchor="end" height={96} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)} />
        <YAxis tick={tick} stroke="var(--border)" width={40} />
        <Tooltip {...tip} formatter={(v) => `${v}s`} />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" height={24} />
        <Bar dataKey="budget" name="Budget" fill="var(--border)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="used" name="Used" fill="var(--signal)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
