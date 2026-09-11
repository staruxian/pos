import { useEffect, useState } from "react";
import { Banknote, Boxes, ReceiptText, TrendingUp } from "lucide-react";
import { api, type Report } from "@/lib/api";
import { cn, money } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayStart(date: string) {
  return `${date} 00:00:00`;
}

/** Диапазон полуоткрытый: сравнение строк идёт до начала следующего дня. */
function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${isoDate(d)} 00:00:00`;
}

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

const presets = [
  { label: "Сегодня", days: 0 },
  { label: "7 дней", days: 6 },
  { label: "30 дней", days: 29 },
];

export function ReportsPage() {
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(nextFrom = from, nextTo = to) {
    setError(null);
    try {
      setData(await api.reports(dayStart(nextFrom), nextDay(nextTo)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить отчёт");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(days: number) {
    const start = daysAgo(days);
    setFrom(start);
    setTo(today);
    void load(start, today);
  }

  const activePreset = presets.find((p) => to === today && from === daysAgo(p.days))?.label;
  const margin =
    data && data.summary.revenue > 0
      ? Math.round((data.summary.profit / data.summary.revenue) * 100)
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Аналитика"
        title="Отчёты"
        description="Выручка, прибыль и остатки за выбранный период."
      />

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--radius)] border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset.days)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                activePreset === preset.label
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="from" className="px-1 text-xs text-muted-foreground">С</Label>
            <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="to" className="px-1 text-xs text-muted-foreground">По</Label>
            <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <Button onClick={() => load()}>Показать</Button>
        </div>
      </div>

      {error && (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Выручка" value={money(data.summary.revenue)} icon={Banknote} />
            <StatCard
              label="Прибыль"
              value={money(data.summary.profit)}
              hint={margin === null ? "Закупка: 0,00" : `Закупка: ${money(data.summary.cost)} · ${margin}%`}
              icon={TrendingUp}
              tone={data.summary.profit < 0 ? "debt" : "profit"}
            />
            <StatCard label="Продаж" value={data.summary.sales_count} icon={ReceiptText} />
            <StatCard label="Продано товаров" value={data.summary.units} icon={Boxes} />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="h-fit overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm lg:col-span-7">
              <div className="border-b px-5 py-4 font-semibold">Популярные товары</div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Товар</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead className="text-right">Выручка</TableHead>
                    <TableHead className="pr-5 text-right">Прибыль</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProduct.map((row) => (
                    <TableRow key={row.product_id}>
                      <TableCell className="pl-5">
                        <div className="font-medium">{row.product_name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.revenue)}</TableCell>
                      <TableCell
                        className={cn(
                          "pr-5 text-right font-medium tabular-nums",
                          row.profit < 0 ? "text-destructive" : "text-emerald-600",
                        )}
                      >
                        {money(row.profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!data.byProduct.length && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                        За выбранный период продаж нет.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-6 lg:col-span-5">
              <div className="overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
                <div className="border-b px-5 py-4 font-semibold">Последние продажи</div>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">№</TableHead>
                      <TableHead>Время</TableHead>
                      <TableHead className="pr-5 text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-5 tabular-nums text-muted-foreground">{s.id}</TableCell>
                        <TableCell className="tabular-nums">{s.created_at.replace("T", " ").slice(0, 16)}</TableCell>
                        <TableCell className="pr-5 text-right font-medium tabular-nums">{money(s.total)}</TableCell>
                      </TableRow>
                    ))}
                    {!data.recent.length && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                          Продаж пока нет.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-[var(--radius)] border bg-card p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-semibold">Заканчиваются</span>
                  <span className="text-xs text-muted-foreground">Остаток 5 и меньше</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.lowStock.map((p) => (
                    <Badge key={p.id} variant={p.stock === 0 ? "destructive" : "secondary"} className="rounded-full">
                      {p.name}: {p.stock}
                    </Badge>
                  ))}
                  {!data.lowStock.length && (
                    <p className="text-sm text-muted-foreground">У всех товаров остаток больше 5 штук.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
