import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Minus,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { api, type Balance, type BalanceEntry } from "@/lib/api";
import { money, toMinor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function operationTime(value: string) {
  return new Date(value.replace(" ", "T")).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BalancePage() {
  const [data, setData] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [expenseDialog, setExpenseDialog] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [removing, setRemoving] = useState<BalanceEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.balance());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить баланс");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startExpense() {
    setAmount("");
    setNote("");
    setFormError(null);
    setExpenseDialog(true);
  }

  async function saveExpense(event: React.FormEvent) {
    event.preventDefault();
    const value = toMinor(amount);
    if (value === null || value <= 0) return setFormError("Введите сумму больше нуля");
    if (!note.trim()) return setFormError("Напишите, на что потрачены деньги");
    setBusy(true);
    setFormError(null);
    try {
      await api.createExpense({ amount: value, note: note.trim() });
      setExpenseDialog(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось записать расход");
    } finally {
      setBusy(false);
    }
  }

  async function removeExpense() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await api.deleteExpense(removing.id);
      setRemoving(null);
      await load();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Не удалось удалить расход");
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Касса магазина"
        title="Баланс"
        description="Продажи пополняют кассу, расходы её уменьшают."
      >
        <Button size="lg" onClick={startExpense}>
          <Minus /> Записать расход
        </Button>
      </PageHeader>

      {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Баланс кассы"
              value={money(data.balance)}
              hint="Приход минус расход"
              icon={Wallet}
              tone={data.balance < 0 ? "debt" : "default"}
            />
            <StatCard label="Приход с продаж" value={money(data.income)} icon={Banknote} tone="profit" />
            <StatCard label="Расходы" value={money(data.spent)} icon={ArrowUpRight} tone="debt" />
          </div>

          <div className="overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <span className="font-semibold">Движение денег</span>
              <span className="text-xs text-muted-foreground">Последние 50 операций</span>
            </div>

            {!data.entries.length ? (
              <div className="px-5 py-14 text-center">
                <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Wallet className="size-5" />
                </div>
                <p className="font-medium">Движений пока нет</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Оформите продажу на Кассе или запишите первый расход.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {data.entries.map((entry) => {
                  const income = entry.kind === "sale";
                  return (
                    <div key={`${entry.kind}-${entry.id}`} className="flex items-center gap-3 px-5 py-3.5">
                      <div
                        className={`grid size-9 shrink-0 place-items-center rounded-full ${
                          income ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {income ? `Продажа №${entry.id}` : entry.note}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {income ? "Приход в кассу" : "Расход"} · {operationTime(entry.created_at)}
                        </p>
                      </div>
                      <p
                        className={`font-semibold tabular-nums ${
                          income ? "text-emerald-600" : "text-destructive"
                        }`}
                      >
                        {income ? "+" : "−"}
                        {money(entry.amount)}
                      </p>
                      {income ? (
                        // Продажа правится и отменяется в Отчётах, здесь она только видна.
                        <span className="w-9" />
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Удалить расход"
                          aria-label={`Удалить расход ${entry.note}`}
                          onClick={() => {
                            setRemoveError(null);
                            setRemoving(entry);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={expenseDialog} onOpenChange={setExpenseDialog}>
        <DialogContent className="max-w-sm">
          <form onSubmit={saveExpense} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Записать расход</DialogTitle>
              <DialogDescription>
                Сумма уйдёт из баланса кассы. Комментарий обязателен — по нему потом видно,
                куда ушли деньги.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="expense-amount">Сумма</Label>
              <Input
                id="expense-amount"
                type="number"
                min="0.01"
                step="0.01"
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="expense-note">На что потрачено</Label>
              <Input
                id="expense-note"
                value={note}
                placeholder="Например, аренда за сентябрь"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setExpenseDialog(false)}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy ? "Сохраняем…" : "Записать"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title="Удалить расход?"
        description={`«${removing?.note ?? ""}» на ${money(removing?.amount ?? 0)} исчезнет, и сумма вернётся в баланс.`}
        confirmLabel="Удалить расход"
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void removeExpense()}
      />
    </div>
  );
}
