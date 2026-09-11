import { useEffect, useState } from "react";
import { Banknote, Boxes, ReceiptText, TrendingUp } from "lucide-react";
import { api, type Report } from "@/lib/api";
import { money } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function dayStart(isoDate: string) {
  return `${isoDate} 00:00:00`;
}

function nextDay(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} 00:00:00`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReportsPage() {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Аналитика</p>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">Продажи и остатки.</h2>
          <p className="mt-3 text-muted-foreground">Главные показатели магазина за выбранный период.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 rounded-[var(--radius)] border bg-card p-3 shadow-xs sm:w-auto sm:grid-cols-[150px_150px_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="from" className="px-1 text-xs text-muted-foreground">С</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="to" className="px-1 text-xs text-muted-foreground">По</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button className="col-span-2 self-end sm:col-span-1" onClick={() => load()}>Применить</Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm text-muted-foreground">Выручка <Banknote className="size-4 text-primary" /></CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold tracking-[-0.04em]">
                {money(data.summary.revenue)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm text-muted-foreground">Продажи <ReceiptText className="size-4 text-primary" /></CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold tracking-[-0.04em]">
                {data.summary.sales_count}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm text-muted-foreground">Продано товаров <Boxes className="size-4 text-primary" /></CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold tracking-[-0.04em]">{data.summary.units}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm text-muted-foreground">Прибыль <TrendingUp className="size-4 text-primary" /></CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tracking-[-0.04em]">{money(data.summary.profit)}</div>
                <p className="mt-1 text-xs text-muted-foreground">Закупка: {money(data.summary.cost)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm lg:col-span-7">
              <div className="border-b px-5 py-4 font-semibold">Популярные товары</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Товар</TableHead>
                    <TableHead className="text-right">Количество</TableHead>
                    <TableHead className="text-right">Выручка</TableHead>
                    <TableHead className="text-right">Прибыль</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProduct.map((row) => (
                    <TableRow key={row.product_id}>
                      <TableCell>{row.product_name}</TableCell>
                      <TableCell className="text-right">{row.qty}</TableCell>
                      <TableCell className="text-right">{money(row.revenue)}</TableCell>
                      <TableCell className="text-right">{money(row.profit)}</TableCell>
                    </TableRow>
                  ))}
                  {!data.byProduct.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
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
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Время</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.id}</TableCell>
                        <TableCell>{s.created_at.replace("T", " ").slice(0, 19)}</TableCell>
                        <TableCell className="text-right">{money(s.total)}</TableCell>
                      </TableRow>
                    ))}
                    {!data.recent.length && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                          Продаж пока нет.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-[var(--radius)] border bg-card p-5 shadow-sm">
                <div className="mb-3 font-semibold">Заканчиваются</div>
                <div className="flex flex-wrap gap-2">
                  {data.lowStock.map((p) => (
                    <Badge key={p.id} variant={p.stock === 0 ? "destructive" : "secondary"}>
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
