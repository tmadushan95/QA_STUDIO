/**
 * Dashboard charts, drawn with Recharts. Every chart has a text alternative (`aria-label` on its figure) that states
 * the same numbers, and colours come from the design tokens' chart and status palette, so status is never colour alone:
 * legends and tooltips name every series.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './DashboardPage.module.css';

/** Token values as Recharts needs them (it draws SVG attributes, which cannot read CSS variables in every browser). */
export const COLORS = {
  passed: '#0f7b47',
  failed: '#d92d20',
  blocked: '#b54708',
  notRun: '#94a3b8',
  primary: '#3b4fe4',
  series: ['#3b4fe4', '#0f9d76', '#e8590c', '#8b5cf6', '#0891b2', '#d6336c'],
  grid: '#e2e8f2',
  text: '#5f6b82',
};

const axis = { fontSize: 11, fill: COLORS.text };

/** One slice of a donut. */
export interface Slice {
  name: string;
  value: number;
  color: string;
}

/** A donut with its total in the middle and a legend beside it. */
export function Donut({
  data,
  total,
  caption,
  label,
}: {
  data: Slice[];
  total: string;
  caption: string;
  label: string;
}) {
  const shown = data.filter((d) => d.value > 0);
  return (
    <figure
      className={styles.donut}
      aria-label={`${label}: ${data.map((d) => `${d.value} ${d.name}`).join(', ')}`}
      role="img"
    >
      <div className={styles.donutChart}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown.length > 0 ? shown : [{ name: 'None', value: 1, color: COLORS.grid }]}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={shown.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {(shown.length > 0 ? shown : [{ name: 'None', value: 1, color: COLORS.grid }]).map(
                (d) => (
                  <Cell key={d.name} fill={d.color} />
                ),
              )}
            </Pie>
            {shown.length > 0 && <Tooltip />}
          </PieChart>
        </ResponsiveContainer>
        <span className={styles.donutCenter}>
          <strong>{total}</strong>
          <span>{caption}</span>
        </span>
      </div>
      <ul className={styles.donutLegend} aria-hidden="true">
        {data.map((d) => (
          <li key={d.name}>
            <span className={styles.swatch} style={{ background: d.color }} />
            <span>{d.name}</span>
            <strong>{d.value}</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** One finished run on the trend. */
export interface TrendPoint {
  label: string;
  passed: number;
  failed: number;
  blocked: number;
  passRate: number | null;
}

/** Stacked results per run with the pass-rate line on a second axis. */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const last = data.at(-1);
  return (
    <figure
      className={styles.chart}
      role="img"
      aria-label={`Results of the last ${data.length} finished runs${last ? `; latest pass rate ${last.passRate === null ? 'not available' : `${Math.round(last.passRate * 100)}%`}` : ''}.`}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={data.map((d) => ({
            ...d,
            rate: d.passRate === null ? null : Math.round(d.passRate * 100),
          }))}
        >
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="n"
            allowDecimals={false}
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <YAxis
            yAxisId="r"
            orientation="right"
            domain={[0, 100]}
            unit="%"
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar
            yAxisId="n"
            dataKey="passed"
            name="Passed"
            stackId="r"
            fill={COLORS.passed}
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="n"
            dataKey="failed"
            name="Failed"
            stackId="r"
            fill={COLORS.failed}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="n"
            dataKey="blocked"
            name="Blocked"
            stackId="r"
            fill={COLORS.blocked}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId="r"
            dataKey="rate"
            name="Pass rate"
            stroke={COLORS.primary}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Horizontal bars for a short labelled list (projects, versions, priorities). */
export function BarList({
  data,
  label,
  color = COLORS.primary,
}: {
  data: { label: string; count: number }[];
  label: string;
  color?: string | undefined;
}) {
  const rows = data.slice(0, 8);
  return (
    <figure
      className={styles.chart}
      role="img"
      aria-label={`${label}: ${rows.map((r) => `${r.label} ${r.count}`).join(', ')}`}
    >
      <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 34)}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke={COLORS.grid} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={axis}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={120}
            tick={axis}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip />
          <Bar
            dataKey="count"
            name="Test cases"
            fill={color}
            radius={[0, 4, 4, 0]}
            barSize={16}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Test cases added per day. */
export function AddedChart({ data }: { data: { day: string; count: number }[] }) {
  const total = data.reduce((n, d) => n + d.count, 0);
  return (
    <figure
      className={styles.chart}
      role="img"
      aria-label={`${total} test cases added over the last ${data.length} days.`}
    >
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="day"
            tick={axis}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={28} />
          <Tooltip />
          <Bar
            dataKey="count"
            name="Added"
            fill={COLORS.series[1]}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
