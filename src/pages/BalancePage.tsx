import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CreditCard,
  HandCoins,
  Minus,
  Trash2,
  Wallet,
} from "lucide-react";
import { api, type Account, type Balance, type Expense } from "@/lib/api";
import { cn, money, toMinor } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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

type Kind = "expense" | "withdrawal";

const accountLabel: Record<Account, string> = { cash: "Наличные", card: "Карта" };

function operationTime(value: string) {
  return new Date(value.replace(" ", "T")).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Список списаний: расходы и изъятия устроены одинаково, отличаются только текстами. */
function OutflowCard({
  title,
  items,
  emptyTitle,
  emptyHint,
  fallbackNote,
  onRemove,
}: {
  title: string;
  items: Expense[];
  emptyTitle: string;
  emptyHint: string;
  fallbackNote: string;
  onRemove: (item: Expense) => void;
}) {
  return (
    <div className="h-fit overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">Последние 50</span>
      </div>
      {!items.length ? (
        <div className="px-5 py-12 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <ArrowUpRight className="size-5" />
          </div>
          <p className="font-medium">{emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>
        </div>
      ) : (
        <div className="divide-y">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                <ArrowUpRight className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.note || fallbackNote}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {accountLabel[item.account]} · {operationTime(item.created_at)}
                </p>
              </div>
              <p className="font-semibold tabular-nums text-destructive">−{money(item.amount)}</p>
              <Button
                size="icon"
                variant="ghost"
                title="Удалить"
                aria-label={`Удалить ${item.note || fallbackNote}`}
                onClick={() => onRemove(item)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BalancePage() {
  const [data, setData] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<Kind | null>(null);
  const [account, setAccount] = useState<Account>("cash");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [removing, setRemoving] = useState<Expense | null>(null);
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

  function startDialog(kind: Kind) {
    setAccount("cash");
    setAmount("");
    setNote("");
    setFormError(null);
    setDialog(kind);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    const value = toMinor(amount);
    if (value === null || value <= 0) return setFormError("Введите сумму больше нуля");
    if (dialog === "expense" && !note.trim()) {
      return setFormError("Напишите, на что потрачены деньги");
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.createExpense({ amount: value, note: note.trim(), kind: dialog, account });
      setDialog(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось сохранить запись");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await api.deleteExpense(removing.id);
      setRemoving(null);
      await load();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Не удалось удалить запись");
    } finally {
      setRemoveBusy(false);
    }
  }

  function askRemove(item: Expense) {
    setRemoveError(null);
    setRemoving(item);
  }

  const isExpense = dialog === "expense";
  const removingIsExpense = removing?.kind === "expense";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Касса магазина"
        title="Баланс"
        description="Наличные и карта считаются отдельно. Долг деньгами не приходит, пока клиент не заплатит."
      >
        <Button variant="outline" size="lg" onClick={() => startDialog("withdrawal")}>
          <HandCoins /> Забрать деньги
        </Button>
        <Button size="lg" onClick={() => startDialog("expense")}>
          <Minus /> Записать расход
        </Button>
      </PageHeader>

      {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Наличные"
              value={money(data.cash.balance)}
              hint="Продажи за нал и оплаты долгов минус списания"
              icon={Wallet}
              tone={data.cash.balance < 0 ? "debt" : "default"}
            />
            <StatCard
              label="На карте"
              value={money(data.card.balance)}
              hint="Онлайн-оплаты минус списания с карты"
              icon={CreditCard}
              tone={data.card.balance < 0 ? "debt" : "default"}
            />
            <StatCard label="Расходы" value={money(data.spent)} icon={ArrowUpRight} tone="debt" />
            <StatCard
              label="В долгах у клиентов"
              value={money(data.debt)}
              hint="Отдано в долг, деньги ещё не пришли"
              icon={HandCoins}
              tone={data.debt > 0 ? "debt" : "default"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-fit overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <span className="font-semibold">Продажи</span>
                <span className="text-xs text-muted-foreground">Последние 50</span>
              </div>
              {!data.sales.length ? (
                <div className="px-5 py-12 text-center">
                  <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <ArrowDownLeft className="size-5" />
                  </div>
                  <p className="font-medium">Продаж пока нет</p>
                  <p className="mt-1 text-sm text-muted-foreground">Оформите первую продажу на Кассе.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {data.sales.map((sale) => (
                    <div key={sale.id} className="flex items-center gap-3 px-5 py-3.5">
                      <div
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full",
                          sale.payment_method === "debt"
                            ? "bg-muted text-muted-foreground"
                            : "bg-emerald-500/10 text-emerald-600",
                        )}
                      >
                        {sale.payment_method === "card" ? (
                          <CreditCard className="size-4" />
                        ) : sale.payment_method === "debt" ? (
                          <HandCoins className="size-4" />
                        ) : (
                          <ArrowDownLeft className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium">
                          Продажа №{sale.id}
                          {sale.payment_method === "debt" && (
                            <Badge variant="secondary" className="rounded-full">в долг</Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {sale.payment_method === "card"
                            ? "Карта"
                            : sale.payment_method === "debt"
                              ? "Деньги ещё не пришли"
                              : "Наличные"}{" "}
                          · {operationTime(sale.created_at)}
                        </p>
                      </div>
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          sale.payment_method === "debt" ? "text-muted-foreground" : "text-emerald-600",
                        )}
                      >
                        {sale.payment_method === "debt" ? "" : "+"}
                        {money(sale.total)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <OutflowCard
              title="Расходы"
              items={data.expenses}
              emptyTitle="Расходов пока нет"
              emptyHint="Трата уменьшает и кассу, и прибыль."
              fallbackNote="Расход"
              onRemove={askRemove}
            />

            <OutflowCard
              title="Забрали из кассы"
              items={data.withdrawals}
              emptyTitle="Денег не забирали"
              emptyHint="Изъятие уменьшает кассу, но не прибыль."
              fallbackNote="Изъятие из кассы"
              onRemove={askRemove}
            />
          </div>
        </>
      )}

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="max-w-sm">
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{isExpense ? "Записать расход" : "Забрать деньги"}</DialogTitle>
              <DialogDescription>
                {isExpense
                  ? "Трата магазина: уменьшает и баланс кассы, и прибыль. Комментарий обязателен — по нему потом видно, куда ушли деньги."
                  : "Деньги вынули из кассы. Баланс уменьшится, прибыль останется прежней: это уже заработанные деньги, а не затрата магазина."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label>Откуда списать</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["cash", "card"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAccount(value)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-semibold transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      account === value
                        ? "border-primary bg-primary/5 text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value === "cash" ? <Banknote className="size-4" /> : <CreditCard className="size-4" />}
                    {accountLabel[value]}
                  </button>
                ))}
              </div>
            </div>
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
              <Label htmlFor="expense-note">
                {isExpense ? "На что потрачено" : "Комментарий (необязательно)"}
              </Label>
              <Input
                id="expense-note"
                value={note}
                placeholder={isExpense ? "Например, аренда за сентябрь" : "Например, забрал домой"}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setDialog(null)}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy ? "Сохраняем…" : isExpense ? "Записать" : "Забрать"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={removingIsExpense ? "Удалить расход?" : "Удалить изъятие?"}
        description={`«${removing?.note || (removingIsExpense ? "Расход" : "Изъятие из кассы")}» на ${money(removing?.amount ?? 0)} исчезнет, и сумма вернётся в баланс.`}
        confirmLabel="Удалить"
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void removeEntry()}
      />
    </div>
  );
}
