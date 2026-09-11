import { useEffect, useState } from "react";
import { Banknote, Boxes, Pencil, ReceiptText, Trash2, TrendingUp } from "lucide-react";
import { api, type Report, type SaleDetails } from "@/lib/api";
import { cn, fromMinor, money, toMinor } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** onChange зовём после правки и отмены продажи: меняются и остатки, и отчёт. */
export function ReportsPage({ onChange }: { onChange?: () => void }) {
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SaleDetails | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [saleError, setSaleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function openSale(id: number) {
    setSaleError(null);
    try {
      const sale = await api.sale(id);
      setEditing(sale);
      setPrices(Object.fromEntries(sale.items.map((item) => [item.id, fromMinor(item.unit_price)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть продажу");
    }
  }

  async function saveSale(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const items: { id: number; unit_price: number }[] = [];
    for (const item of editing.items) {
      const unitPrice = toMinor(prices[item.id] ?? "");
      if (unitPrice === null) return setSaleError(`Укажите корректную цену для «${item.product_name}»`);
      items.push({ id: item.id, unit_price: unitPrice });
    }
    setBusy(true);
    setSaleError(null);
    try {
      await api.updateSale(editing.id, items);
      setEditing(null);
      await load();
      onChange?.();
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : "Не удалось сохранить продажу");
    } finally {
      setBusy(false);
    }
  }

  async function removeSale(id: number) {
    if (!confirm(`Отменить продажу №${id}? Товары вернутся на склад.`)) return;
    try {
      await api.deleteSale(id);
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить продажу");
    }
  }

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
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead className="pr-5" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-5 tabular-nums text-muted-foreground">{s.id}</TableCell>
                        <TableCell className="tabular-nums">{s.created_at.replace("T", " ").slice(0, 16)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(s.total)}</TableCell>
                        <TableCell className="pr-5 text-right whitespace-nowrap">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Изменить цену продажи"
                            aria-label={`Изменить цену продажи №${s.id}`}
                            onClick={() => void openSale(s.id)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Отменить продажу"
                            aria-label={`Отменить продажу №${s.id}`}
                            onClick={() => void removeSale(s.id)}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!data.recent.length && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
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

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          {editing && (
            <form onSubmit={saveSale} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Продажа №{editing.id}</DialogTitle>
                <DialogDescription>
                  {editing.created_at.replace("T", " ").slice(0, 16)} · меняется только цена продажи,
                  состав и количество остаются прежними.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-2">
                {editing.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-2xl border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.qty} шт. · закупка {money(item.cost_price)}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-32 text-right tabular-nums"
                      aria-label={`Цена продажи товара ${item.product_name}`}
                      value={prices[item.id] ?? ""}
                      onChange={(e) => setPrices({ ...prices, [item.id]: e.target.value })}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-muted/65 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Новый итог</span>
                <span className="font-semibold tabular-nums">
                  {money(
                    editing.items.reduce(
                      (sum, item) => sum + item.qty * (toMinor(prices[item.id] ?? "") ?? 0),
                      0,
                    ),
                  )}
                </span>
              </div>

              {saleError && <p className="text-sm text-destructive">{saleError}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditing(null)}>
                  Отмена
                </Button>
                <Button type="submit" className="flex-1" disabled={busy}>
                  {busy ? "Сохраняем…" : "Сохранить"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
