/**
 * ThemedChart — Recharts wrappers themed with Nuoma design tokens.
 *
 * The palette is read from the live `--color-*` CSS variables so charts adapt
 * to the active theme (void-flow / aurora / ocean). `recharts` lives in
 * `apps/web` only — `@nuoma/ui` stays dependency-free.
 */
import { useTheme } from "@nuoma/ui";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

const VAR_NAMES = {
  teal: "--color-brand-teal",
  blue: "--color-brand-blue",
  green: "--color-brand-green",
  danger: "--color-semantic-danger",
  success: "--color-semantic-success",
  warning: "--color-semantic-warning",
  text: "--color-fg-primary",
  muted: "--color-fg-dim",
  grid: "--color-border-subtle",
  surface: "--color-bg-elevated",
} as const;

const FALLBACK = {
  teal: "rgb(91 91 246)",
  blue: "rgb(91 91 246)",
  green: "rgb(43 184 126)",
  danger: "rgb(242 86 106)",
  success: "rgb(43 184 126)",
  warning: "rgb(224 163 58)",
  text: "rgb(244 244 248)",
  muted: "rgb(162 162 178)",
  grid: "rgb(48 48 62)",
  surface: "rgb(18 18 25)",
} as const;

export type ChartPalette = Record<keyof typeof VAR_NAMES, string> & { series: string[] };

/** Reads token colours from the DOM; re-reads when the theme changes. */
export function useChartPalette(): ChartPalette {
  const { resolved } = useTheme();
  return useMemo(() => {
    const read = (cssVar: string, fallback: string): string => {
      if (typeof window === "undefined") return fallback;
      const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      return raw ? `rgb(${raw})` : fallback;
    };
    const colors = Object.fromEntries(
      Object.entries(VAR_NAMES).map(([key, cssVar]) => [
        key,
        read(cssVar, FALLBACK[key as keyof typeof FALLBACK]),
      ]),
    ) as Record<keyof typeof VAR_NAMES, string>;
    return {
      ...colors,
      series: [colors.teal, colors.green, colors.warning, colors.danger, colors.blue],
    };
  }, [resolved]);
}

function useTooltipStyle(palette: ChartPalette) {
  return {
    contentStyle: {
      background: palette.surface,
      border: `1px solid ${palette.grid}`,
      borderRadius: 10,
      boxShadow: "0 8px 32px rgba(0,0,0,.4)",
      fontFamily: "'Inter Variable', system-ui, sans-serif",
      fontSize: 12,
    },
    labelStyle: { color: palette.text, fontWeight: 600 },
    itemStyle: { color: palette.muted },
  } as const;
}

const AXIS_TICK = { fontSize: 11, fontFamily: "'Geist Mono Variable', monospace" };

interface SeriesDef {
  key: string;
  label?: string;
}

export interface LineAreaChartProps {
  data: Array<Record<string, number | string>>;
  xKey: string;
  series: SeriesDef[];
  height?: number;
}

/** Line + area chart. The first series is rendered as a filled area. */
export function LineAreaChart({ data, xKey, series, height = 280 }: LineAreaChartProps) {
  const palette = useChartPalette();
  const tip = useTooltipStyle(palette);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <defs>
          <linearGradient id="nuoma-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.teal} stopOpacity={0.24} />
            <stop offset="100%" stopColor={palette.teal} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={palette.grid} strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey={xKey} stroke={palette.muted} tick={AXIS_TICK} tickLine={false} />
        <YAxis stroke={palette.muted} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <Tooltip {...tip} cursor={{ stroke: palette.grid }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: palette.muted }} />
        {series.map((def, index) =>
          index === 0 ? (
            <Area
              key={def.key}
              type="monotone"
              dataKey={def.key}
              name={def.label ?? def.key}
              stroke={palette.series[0]}
              strokeWidth={2.4}
              fill="url(#nuoma-area)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : (
            <Area
              key={def.key}
              type="monotone"
              dataKey={def.key}
              name={def.label ?? def.key}
              stroke={palette.series[index % palette.series.length]}
              strokeWidth={1.8}
              strokeDasharray="5 4"
              fill="transparent"
              dot={false}
            />
          ),
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface GroupedBarChartProps {
  data: Array<Record<string, number | string>>;
  xKey: string;
  series: SeriesDef[];
  height?: number;
}

/** Vertical grouped bar chart. */
export function GroupedBarChart({ data, xKey, series, height = 280 }: GroupedBarChartProps) {
  const palette = useChartPalette();
  const tip = useTooltipStyle(palette);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid stroke={palette.grid} strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey={xKey} stroke={palette.muted} tick={AXIS_TICK} tickLine={false} />
        <YAxis stroke={palette.muted} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <Tooltip {...tip} cursor={{ fill: palette.grid, fillOpacity: 0.16 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: palette.muted }} />
        {series.map((def, index) => (
          <Bar
            key={def.key}
            dataKey={def.key}
            name={def.label ?? def.key}
            fill={palette.series[index % palette.series.length]}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface HorizontalBarChartProps {
  data: Array<{ name: string; value: number }>;
  height?: number;
}

/** Horizontal bar chart — rankings. Bar colour shifts with the value tier. */
export function HorizontalBarChart({ data, height = 280 }: HorizontalBarChartProps) {
  const palette = useChartPalette();
  const tip = useTooltipStyle(palette);
  const colorFor = (value: number) =>
    value >= 85 ? palette.teal : value >= 70 ? palette.blue : palette.warning;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 12 }}>
        <CartesianGrid stroke={palette.grid} strokeOpacity={0.4} horizontal={false} />
        <XAxis type="number" stroke={palette.muted} tick={AXIS_TICK} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          stroke={palette.muted}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={84}
        />
        <Tooltip {...tip} cursor={{ fill: palette.grid, fillOpacity: 0.16 }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={14}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={colorFor(entry.value)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface DonutChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  height?: number;
}

/** Donut chart — status distribution. */
export function DonutChart({ data, height = 280 }: DonutChartProps) {
  const palette = useChartPalette();
  const tip = useTooltipStyle(palette);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Tooltip {...tip} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: palette.muted }} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="52%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="transparent"
        >
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={entry.color ?? palette.series[index % palette.series.length]}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export interface GaugeChartProps {
  value: number;
  max?: number;
  label?: string;
  height?: number;
}

/** Gauge — single composite score, 0–max. */
export function GaugeChart({ value, max = 100, label, height = 280 }: GaugeChartProps) {
  const palette = useChartPalette();
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="68%"
          outerRadius="100%"
          data={[{ name: label ?? "score", value }]}
          startAngle={210}
          endAngle={-30}
        >
          <defs>
            <linearGradient id="nuoma-gauge" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={palette.blue} />
              <stop offset="100%" stopColor={palette.teal} />
            </linearGradient>
          </defs>
          <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={9}
            fill="url(#nuoma-gauge)"
            background={{ fill: palette.surface }}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="botforge-display text-4xl tabular-nums">{value}</span>
        {label && (
          <span className="mt-1 font-mono text-[0.7rem] uppercase tracking-wider text-fg-dim">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export interface ScatterPlotProps {
  data: Array<{ x: number; y: number; z?: number }>;
  xLabel?: string;
  yLabel?: string;
  height?: number;
}

/** Scatter plot — bubble size encodes the optional `z` value. */
export function ScatterPlot({ data, xLabel, yLabel, height = 280 }: ScatterPlotProps) {
  const palette = useChartPalette();
  const tip = useTooltipStyle(palette);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 12, left: -8 }}>
        <CartesianGrid stroke={palette.grid} strokeOpacity={0.4} />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel ?? "x"}
          stroke={palette.muted}
          tick={AXIS_TICK}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel ?? "y"}
          stroke={palette.muted}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <ZAxis type="number" dataKey="z" range={[40, 420]} />
        <Tooltip {...tip} cursor={{ strokeDasharray: "4 4", stroke: palette.grid }} />
        <Scatter data={data} fill={palette.teal} fillOpacity={0.62} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
