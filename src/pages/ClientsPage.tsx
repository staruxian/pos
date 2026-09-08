import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleCheck,
  HandCoins,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import { api, type Client, type ClientDetails } from "@/lib/api";
import { fromMinor, money, toMinor } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ClientForm = { name: string; number: string };
type Operation = "debt" | "payment";

function operationTime(value: string) {
  return new Date(value.replace(" ", "T")).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientDialog, setClientDialog] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [clientForm, setClientForm] = useState<ClientForm>({ name: "", number: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [operation, setOperation] = useState<Operation | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      const next = await api.clients();
      setClients(next);
      setSelectedId((current) => {
        if (current && next.some((client) => client.id === current)) return current;
        return next[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить клиентов");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async (id: number) => {
    try {
      setDetails(await api.client(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить историю клиента");
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (selectedId) void loadDetails(selectedId);
    else setDetails(null);
  }, [selectedId, loadDetails]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value
      ? clients.filter((client) =>
          client.name.toLowerCase().includes(value) || client.number.toLowerCase().includes(value),
        )
      : clients;
  }, [clients, query]);

  const summary = useMemo(
    () => ({
      total: clients.length,
      debtors: clients.filter((client) => client.balance > 0).length,
      debt: clients.reduce((sum, client) => sum + Math.max(client.balance, 0), 0),
    }),
    [clients],
  );

  function startCreate() {
    setEditing(null);
    setClientForm({ name: "", number: "" });
    setFormError(null);
    setClientDialog(true);
  }

  function startEdit(client: Client) {
    setEditing(client);
    setClientForm({ name: client.name, number: client.number });
    setFormError(null);
    setClientDialog(true);
  }

  async function saveClient() {
    const name = clientForm.name.trim();
    const number = clientForm.number.trim();
    if (!name) return setFormError("Имя клиента обязательно");
    if (!number) return setFormError("Номер клиента обязателен");
    setBusy(true);
    setFormError(null);
    try {
      const saved = editing
        ? await api.updateClient(editing.id, { name, number })
        : await api.createClient({ name, number });
      setClientDialog(false);
      setSelectedId(saved.id);
      await loadClients();
      await loadDetails(saved.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось сохранить клиента");
    } finally {
      setBusy(false);
    }
  }

  async function removeClient(client: Client) {
    if (!confirm(`Удалить клиента «${client.name}»?`)) return;
    try {
      await api.deleteClient(client.id);
      setSelectedId(null);
      setDetails(null);
      await loadClients();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Не удалось удалить клиента");
    }
  }

  function startOperation(kind: Operation) {
    setOperation(kind);
    setAmount(kind === "payment" && details ? fromMinor(details.balance) : "");
    setNote("");
    setOperationError(null);
  }

  async function saveOperation() {
    if (!details || !operation) return;
    const value = toMinor(amount);
    if (value === null || value <= 0) {
      return setOperationError("Введите сумму больше нуля");
    }
    setBusy(true);
    setOperationError(null);
    try {
      if (operation === "debt") {
        await api.addClientDebt(details.id, { amount: value, note: note.trim() });
      } else {
        await api.addClientPayment(details.id, { amount: value, note: note.trim() });
      }
      setOperation(null);
      await Promise.all([loadClients(), loadDetails(details.id)]);
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "Не удалось сохранить операцию");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Долговая тетрадь</p>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">Клиенты и долги.</h2>
          <p className="mt-3 text-muted-foreground">Начисляйте долг, принимайте оплату и сохраняйте историю.</p>
        </div>
        <Button size="lg" onClick={startCreate}><Plus /> Добавить клиента</Button>
      </div>

      {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">Всего клиентов</p><p className="mt-1 text-2xl font-semibold">{summary.total}</p></div><Users className="size-5 text-primary" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">С долгом</p><p className="mt-1 text-2xl font-semibold">{summary.debtors}</p></div><WalletCards className="size-5 text-primary" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">Общий долг</p><p className="mt-1 text-2xl font-semibold">{money(summary.debt)}</p></div><HandCoins className="size-5 text-primary" /></CardContent></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или номер" className="pl-10" />
            </div>
          </div>
          <div className="max-h-[580px] overflow-y-auto p-2">
            {filtered.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => setSelectedId(client.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${selectedId === client.id ? "bg-secondary" : "hover:bg-muted/70"}`}
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="size-4" /></div>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{client.name}</p><p className="truncate text-xs text-muted-foreground">{client.number}</p></div>
                <div className="text-right"><p className={`text-sm font-semibold ${client.balance > 0 ? "text-destructive" : "text-muted-foreground"}`}>{money(client.balance)}</p><p className="text-[11px] text-muted-foreground">долг</p></div>
              </button>
            ))}
            {!loading && !filtered.length && <div className="p-8 text-center text-sm text-muted-foreground">{query ? "Клиенты не найдены" : "Добавьте первого клиента"}</div>}
          </div>
        </Card>

        <Card className="min-h-[460px] overflow-hidden">
          {details ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5 sm:p-6">
                <div><div className="flex items-center gap-2"><h3 className="text-xl font-semibold">{details.name}</h3>{details.balance > 0 && <Badge variant="destructive" className="rounded-full">Есть долг</Badge>}</div><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Phone className="size-3.5" />{details.number}</p></div>
                <div className="flex gap-1"><Button size="icon" variant="ghost" title="Редактировать" aria-label="Редактировать клиента" onClick={() => startEdit(details)}><Pencil /></Button><Button size="icon" variant="ghost" title="Удалить" aria-label="Удалить клиента" onClick={() => void removeClient(details)}><Trash2 /></Button></div>
              </div>
              <div className="grid gap-5 p-5 sm:p-6">
                <div className="flex flex-col gap-4 rounded-[var(--radius)] bg-muted/60 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm text-muted-foreground">Текущий долг</p><p className={`mt-1 text-4xl font-semibold tracking-[-0.04em] ${details.balance > 0 ? "text-destructive" : "text-foreground"}`}>{money(details.balance)}</p></div>
                  <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => startOperation("debt")}><ArrowUpRight /> Записать долг</Button><Button disabled={details.balance <= 0} onClick={() => startOperation("payment")}><ArrowDownLeft /> Принять оплату</Button></div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between"><h4 className="font-semibold">История операций</h4><span className="text-xs text-muted-foreground">Записей: {details.ledger.length}</span></div>
                  <div className="space-y-2">
                    {details.ledger.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 rounded-2xl border p-3.5">
                        <div className={`grid size-9 shrink-0 place-items-center rounded-full ${entry.kind === "debt" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"}`}>{entry.kind === "debt" ? <ArrowUpRight className="size-4" /> : <CircleCheck className="size-4" />}</div>
                        <div className="min-w-0 flex-1"><p className="font-medium">{entry.kind === "debt" ? "Начислен долг" : "Получена оплата"}</p><p className="truncate text-xs text-muted-foreground">{entry.note || "Без комментария"} · {operationTime(entry.created_at)}</p></div>
                        <p className={`font-semibold ${entry.kind === "debt" ? "text-destructive" : "text-emerald-600"}`}>{entry.kind === "debt" ? "+" : "−"}{money(entry.amount)}</p>
                      </div>
                    ))}
                    {!details.ledger.length && <div className="rounded-2xl border border-dashed p-10 text-center"><WalletCards className="mx-auto mb-3 size-6 text-muted-foreground" /><p className="font-medium">История пока пуста</p><p className="mt-1 text-sm text-muted-foreground">Запишите первый долг клиента.</p></div>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="grid min-h-[460px] place-items-center p-8 text-center"><div><UserRound className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-semibold">Выберите клиента</p><p className="mt-1 text-sm text-muted-foreground">Здесь появятся баланс и история операций.</p></div></div>
          )}
        </Card>
      </div>

      <Dialog open={clientDialog} onOpenChange={setClientDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Редактировать клиента" : "Новый клиент"}</DialogTitle><DialogDescription>Имя и номер клиента обязательны.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5"><Label htmlFor="client-name">Имя клиента</Label><Input id="client-name" value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} placeholder="Например, Анна" autoFocus /></div>
            <div className="grid gap-1.5"><Label htmlFor="client-number">Номер клиента</Label><Input id="client-number" type="tel" value={clientForm.number} onChange={(event) => setClientForm({ ...clientForm, number: event.target.value })} placeholder="Например, +998 90 123 45 67" /></div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <Button size="lg" disabled={busy} onClick={() => void saveClient()}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!operation} onOpenChange={(open) => !open && setOperation(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{operation === "debt" ? "Записать долг" : "Принять оплату"}</DialogTitle><DialogDescription>{operation === "debt" ? `Новый долг клиента «${details?.name ?? ""}».` : `Текущий долг: ${money(details?.balance ?? 0)}.`}</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5"><Label htmlFor="operation-amount">Сумма</Label><Input id="operation-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></div>
            <div className="grid gap-1.5"><Label htmlFor="operation-note">Комментарий</Label><Input id="operation-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={operation === "debt" ? "Например, покупка от 31 августа" : "Например, наличными"} /></div>
            {operationError && <p className="text-sm text-destructive">{operationError}</p>}
            <Button size="lg" disabled={busy} onClick={() => void saveOperation()}>{busy ? "Сохраняем…" : operation === "debt" ? "Записать долг" : "Подтвердить оплату"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
