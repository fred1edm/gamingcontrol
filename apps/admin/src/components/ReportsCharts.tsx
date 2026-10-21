import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Period = "daily" | "weekly" | "monthly";
type RevenuePoint = { day: string; amountCents: number };
type WeeklyRevenuePoint = { weekStart: string; amountCents: number };
const currency = (cents: number) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    cents / 100,
  );

export function RevenueTrendChart({
  period,
  totalsByDay,
  totalsByWeek,
}: {
  period: Period;
  totalsByDay: RevenuePoint[];
  totalsByWeek: WeeklyRevenuePoint[];
}) {
  const data =
    period === "monthly"
      ? totalsByWeek.map((row) => ({
          label: `Sem. ${new Date(`${row.weekStart}T12:00:00Z`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", timeZone: "America/Lima" })}`,
          amount: row.amountCents,
        }))
      : totalsByDay.map((row) => ({
          label: new Date(`${row.day}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: period === "weekly" ? "short" : undefined, day: "2-digit", month: "short", timeZone: "America/Lima" }),
          amount: row.amountCents,
        }));
  return (
    <div className="panel chart-panel report-trend-panel">
      <h2>
        {period === "daily"
          ? "Ingresos del día"
          : period === "weekly"
            ? "Ingresos por día"
            : "Ingresos por semana"}
      </h2>
      <p>
        {period === "daily"
          ? "Cobros registrados en la fecha seleccionada."
          : period === "weekly"
            ? "Comparación de lunes a domingo."
            : "Comparación de las semanas del mes seleccionado."}
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid stroke="#2c3537" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8a999a", fontSize: 10 }} />
          <YAxis
            tick={{ fill: "#8a999a", fontSize: 10 }}
            tickFormatter={(value) => `S/${(value / 100).toFixed(0)}`}
          />
          <Tooltip cursor={false} formatter={(value) => currency(Number(value))} />
          <Bar dataKey="amount" name="Ingresos" fill="#91edbb" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DemandChart({ demandByHour }: { demandByHour: { hour: number; count: number }[] }) {
  const data = demandByHour.map((row) => ({
    ...row,
    label: `${String(row.hour).padStart(2, "0")}:00`,
  }));
  return (
    <div className="panel chart-panel report-demand-panel">
      <h2>Demanda por hora</h2>
      <p>Sesiones iniciadas según la hora local.</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid stroke="#2c3537" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8a999a", fontSize: 10 }} />
          <YAxis allowDecimals={false} tick={{ fill: "#8a999a", fontSize: 10 }} />
          <Tooltip cursor={false} />
          <Bar dataKey="count" name="Sesiones" fill="#8fc3fa" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
