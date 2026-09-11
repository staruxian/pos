import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Banknote,
  CreditCard,
  HandCoins,
  Minus,
  Pencil,
  Plus,
  ScanBarcode,
  Search,
  ShoppingBag,
  Trash2,
  UserRound,
} from "lucide-react";
import { api, type Client, type PaymentMethod, type Product } from "@/lib/api";
import { cn, fromMinor, money, toMinor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Один товар может попасть в корзину несколько раз по разной цене, поэтому у строки
// свой ключ, а не id товара.
type Line = { key: number; product: Product; qty: number; unitPrice: number };

type PriceDialog = {
  mode: "add" | "edit";
  key?: number;
  product: Product;
  qty: string;
  price: string;
};

export function SellPage({
  products,
  onSold,
}: {
  products: Product[];
  onSold: () => void;
}) {
  const [scan, setScan] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<PriceDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Оплата: продажа оформляется только после выбора способа.
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", number: "" });
  const [payError, setPayError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Сканер вводит только цифры. Если кассир набирает буквы — это поиск по названию,
  // и подсказки заменяют каталог: список короткий и появляется только по запросу.
  const query = scan.trim();
  const isBarcode = /^\d+$/.test(query);
  const suggestions = useMemo(() => {
    if (!query || isBarcode) return [];
    const value = query.toLowerCase();
    return products
      .filter((p) =>
        [p.name, p.category, p.size, p.color].some((field) => field.toLowerCase().includes(value)),
      )
      .slice(0, 6);
  }, [products, query, isBarcode]);

  /** Сколько ещё можно взять со склада с учётом других строк того же товара. */
  function available(lines: Line[], product: Product, exceptKey?: number) {
    const taken = lines
      .filter((l) => l.product.id === product.id && l.key !== exceptKey)
      .reduce((n, l) => n + l.qty, 0);
    return product.stock - taken;
  }

  function addLine(product: Product, qty: number, unitPrice: number) {
    setMessage(null);
    setCart((prev) => {
      if (qty > available(prev, product)) {
        setMessage(`Для товара «${product.name}» доступно только ${product.stock} шт.`);
        return prev;
      }
      const same = prev.find((l) => l.product.id === product.id && l.unitPrice === unitPrice);
      if (same) {
        return prev.map((l) => (l.key === same.key ? { ...l, qty: l.qty + qty } : l));
      }
      return [...prev, { key: (nextKey.current += 1), product, qty, unitPrice }];
    });
  }

  async function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query) return;
    if (!isBarcode) {
      // Enter по текстовому запросу открывает диалог для первого совпадения.
      const first = suggestions[0];
      if (!first) return setMessage(`Товар «${query}» не найден`);
      return pick(first);
    }
    setScan("");
    try {
      const product =
        products.find((p) => p.sku === query) ?? (await api.productByBarcode(query));
      // Сканирование не тормозим диалогом: товар уходит в корзину по цене продажи,
      // а цену строки можно поправить прямо в корзине.
      addLine(product, 1, product.price);
    } catch {
      setMessage(`Товар со штрихкодом ${query} не найден`);
    }
    inputRef.current?.focus();
  }

  function pick(product: Product) {
    setScan("");
    openAdd(product);
  }

  function openAdd(product: Product) {
    setMessage(null);
    setDialogError(null);
    setDialog({ mode: "add", product, qty: "1", price: fromMinor(product.price) });
  }

  function openEdit(line: Line) {
    setDialogError(null);
    setDialog({
      mode: "edit",
      key: line.key,
      product: line.product,
      qty: String(line.qty),
      price: fromMinor(line.unitPrice),
    });
  }

  function submitDialog(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    const qty = Number(dialog.qty);
    const unitPrice = toMinor(dialog.price);
    if (!Number.isInteger(qty) || qty < 1) return setDialogError("Укажите количество от 1");
    if (unitPrice === null) return setDialogError("Укажите корректную цену");
    const left = available(cart, dialog.product, dialog.key);
    if (qty > left) return setDialogError(`Доступно только ${Math.max(left, 0)} шт.`);

    if (dialog.mode === "add") {
      addLine(dialog.product, qty, unitPrice);
    } else {
      setCart((prev) => prev.map((l) => (l.key === dialog.key ? { ...l, qty, unitPrice } : l)));
    }
    setDialog(null);
    inputRef.current?.focus();
  }

  function setQty(key: number, qty: number) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        return { ...l, qty: Math.max(1, Math.min(qty, available(prev, l.product, key))) };
      }),
    );
  }

  const total = useMemo(() => cart.reduce((sum, l) => sum + l.unitPrice * l.qty, 0), [cart]);
  const units = cart.reduce((n, line) => n + line.qty, 0);

  function openPayment() {
    if (!cart.length) return;
    setMethod("cash");
    setClientId(null);
    setClientQuery("");
    setCreating(false);
    setNewClient({ name: "", number: "" });
    setPayError(null);
    setPayOpen(true);
    if (clients === null) void api.clients().then(setClients).catch(() => setClients([]));
  }

  async function addClient() {
    const name = newClient.name.trim();
    const number = newClient.number.trim();
    if (!name) return setPayError("Укажите имя клиента");
    if (!number) return setPayError("Укажите номер клиента");
    setBusy(true);
    setPayError(null);
    try {
      const client = await api.createClient({ name, number });
      setClients((prev) => [...(prev ?? []), client]);
      setClientId(client.id);
      setCreating(false);
      setNewClient({ name: "", number: "" });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Не удалось добавить клиента");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (!cart.length) return;
    if (method === "debt" && clientId === null) return setPayError("Выберите клиента");
    setBusy(true);
    setPayError(null);
    try {
      const sale = await api.checkout({
        items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: l.unitPrice })),
        payment_method: method,
        client_id: method === "debt" ? clientId! : undefined,
      });
      setCart([]);
      setPayOpen(false);
      setMessage(
        `Продажа №${sale.id} на ${money(sale.total)} · ${
          method === "cash" ? "наличные" : method === "card" ? "карта" : "в долг"
        }`,
      );
      onSold();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Не удалось оформить продажу");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const matchingClients = useMemo(() => {
    const value = clientQuery.trim().toLowerCase();
    const all = clients ?? [];
    return (value
      ? all.filter((c) => c.name.toLowerCase().includes(value) || c.number.toLowerCase().includes(value))
      : all
    ).slice(0, 20);
  }, [clients, clientQuery]);

  const dialogPrice = dialog ? toMinor(dialog.price) : null;
  const dialogQty = dialog ? Number(dialog.qty) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Касса"
        title="Новая продажа"
        description="Отсканируйте этикетку товара или найдите его по названию."
      />

      <div className="relative">
        <form onSubmit={onScanSubmit}>
          <ScanBarcode className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-primary" />
          <Input
            ref={inputRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            placeholder="Штрихкод или название товара"
            aria-label="Штрихкод или название товара"
            className="h-16 rounded-[var(--radius)] border-0 bg-card pl-14 pr-24 text-lg shadow-sm focus-visible:ring-4"
            autoComplete="off"
          />
          <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
            ВВОД
          </span>
        </form>

        {!!suggestions.length && (
          <div className="absolute inset-x-0 top-[4.5rem] z-30 overflow-hidden rounded-[var(--radius)] border bg-popover p-2 shadow-lg">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                disabled={p.stock < 1}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-muted/70 disabled:opacity-40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.category, p.size, p.color].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="tabular-nums font-semibold">{money(p.price)}</span>
                <Badge variant={p.stock <= 5 ? "destructive" : "secondary"} className="rounded-full">
                  {p.stock}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {!!query && !isBarcode && !suggestions.length && (
          <div className="absolute inset-x-0 top-[4.5rem] z-30 rounded-[var(--radius)] border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-lg">
            Ничего не найдено.
          </div>
        )}
      </div>

      {message && (
        <p className="rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground">
          {message}
        </p>
      )}

      <div className="overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <ShoppingBag className="size-4 text-primary" /> Текущая продажа
          </div>
          <span className="text-sm text-muted-foreground">Товаров: {units}</span>
        </div>

        {!cart.length ? (
          <div className="px-5 py-14 text-center">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <ScanBarcode className="size-5" />
            </div>
            <p className="font-medium">Корзина пуста</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              Отсканируйте этикетку — товар добавится сразу. Название можно набрать вручную.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {cart.map((line) => (
              <div key={line.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                <div className="min-w-[8rem] flex-1">
                  <p className="font-medium">{line.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[line.product.size, line.product.color].filter(Boolean).join(" · ") ||
                      line.product.category}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => openEdit(line)}
                  className="w-36 rounded-lg px-2 py-1 text-right text-sm text-muted-foreground transition hover:bg-muted"
                  aria-label={`Изменить цену товара ${line.product.name}`}
                >
                  <span className="flex items-center justify-end gap-1.5 tabular-nums">
                    <Pencil className="size-3" />
                    {money(line.unitPrice)}
                  </span>
                  {line.unitPrice !== line.product.price && (
                    <span className="block text-[11px] text-primary">
                      {line.unitPrice < line.product.price ? "скидка" : "наценка"}{" "}
                      {money(Math.abs(line.unitPrice - line.product.price))}
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Уменьшить количество товара ${line.product.name}`}
                    onClick={() => setQty(line.key, line.qty - 1)}
                  >
                    <Minus />
                  </Button>
                  <Input
                    className="h-9 w-14 text-center tabular-nums"
                    type="number"
                    min={1}
                    max={line.product.stock}
                    value={line.qty}
                    onChange={(e) => setQty(line.key, Number(e.target.value))}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Увеличить количество товара ${line.product.name}`}
                    onClick={() => setQty(line.key, line.qty + 1)}
                  >
                    <Plus />
                  </Button>
                </div>

                <div className="w-24 text-right font-semibold tabular-nums">
                  {money(line.unitPrice * line.qty)}
                </div>

                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Убрать товар ${line.product.name}`}
                  onClick={() => setCart((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t bg-muted/40 px-5 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Итого</p>
            <p className="text-3xl font-semibold tabular-nums tracking-[-0.04em]">{money(total)}</p>
          </div>
          <Button size="lg" disabled={!cart.length} onClick={openPayment}>
            Оформить продажу <ArrowRight />
          </Button>
        </div>
      </div>

      <Dialog open={payOpen} onOpenChange={(open) => { if (!open) setPayOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Как платит покупатель?</DialogTitle>
            <DialogDescription>
              К оплате {money(total)} за {units} шт. Продажа оформится после выбора.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2">
            {([
              { value: "cash", label: "Наличные", icon: Banknote },
              { value: "card", label: "Карта", icon: CreditCard },
              { value: "debt", label: "В долг", icon: HandCoins },
            ] as const).map((option) => {
              const Icon = option.icon;
              const active = method === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setMethod(option.value);
                    setPayError(null);
                  }}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border p-4 text-sm font-semibold transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary bg-primary/5 text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-5", active && "text-primary")} />
                  {option.label}
                </button>
              );
            })}
          </div>

          {method === "debt" && (
            <div className="grid gap-2 rounded-2xl bg-muted/50 p-3">
              {creating ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="new-client-name">Имя клиента</Label>
                    <Input
                      id="new-client-name"
                      value={newClient.name}
                      autoFocus
                      placeholder="Например, Анна"
                      onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="new-client-number">Номер клиента</Label>
                    <Input
                      id="new-client-number"
                      type="tel"
                      value={newClient.number}
                      placeholder="+998 90 123 45 67"
                      onChange={(e) => setNewClient({ ...newClient, number: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setCreating(false)}>
                      Назад к списку
                    </Button>
                    <Button type="button" className="flex-1" disabled={busy} onClick={() => void addClient()}>
                      Добавить клиента
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={clientQuery}
                      onChange={(e) => setClientQuery(e.target.value)}
                      placeholder="Имя или номер клиента"
                      className="pl-10"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {clients === null && <p className="p-3 text-sm text-muted-foreground">Загружаем клиентов…</p>}
                    {clients?.length === 0 && (
                      <p className="p-3 text-sm text-muted-foreground">Клиентов пока нет — добавьте первого.</p>
                    )}
                    {matchingClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => {
                          setClientId(client.id);
                          setPayError(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition",
                          clientId === client.id ? "bg-card shadow-xs" : "hover:bg-card/70",
                        )}
                      >
                        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                          <UserRound className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{client.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{client.number}</p>
                        </div>
                        {client.balance > 0 && (
                          <span className="text-xs tabular-nums text-destructive">
                            долг {money(client.balance)}
                          </span>
                        )}
                      </button>
                    ))}
                    {!!clients?.length && !matchingClients.length && (
                      <p className="p-3 text-sm text-muted-foreground">Никого не нашли.</p>
                    )}
                  </div>
                  <Button type="button" variant="outline" onClick={() => { setCreating(true); setPayError(null); }}>
                    <Plus /> Новый клиент
                  </Button>
                </>
              )}
            </div>
          )}

          {payError && <p className="text-sm text-destructive">{payError}</p>}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setPayOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={busy || creating || (method === "debt" && clientId === null)}
              onClick={() => void checkout()}
            >
              {busy ? "Оформляем…" : method === "debt" ? "Записать в долг" : "Продать"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="max-w-sm">
          {dialog && (
            <form onSubmit={submitDialog} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{dialog.product.name}</DialogTitle>
                <DialogDescription>
                  {[dialog.product.category, dialog.product.size, dialog.product.color]
                    .filter(Boolean)
                    .join(" · ")}
                  {" · "}Цена продажи {money(dialog.product.price)}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="sell-qty">Количество</Label>
                  <Input
                    id="sell-qty"
                    type="number"
                    min={1}
                    step={1}
                    value={dialog.qty}
                    onChange={(e) => setDialog({ ...dialog, qty: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sell-price">Цена за штуку</Label>
                  <Input
                    id="sell-price"
                    type="number"
                    min={0}
                    step="0.01"
                    autoFocus
                    value={dialog.price}
                    onChange={(e) => setDialog({ ...dialog, price: e.target.value })}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/65 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {dialogPrice !== null && dialogPrice !== dialog.product.price
                    ? `${dialogPrice < dialog.product.price ? "Скидка" : "Наценка"} ${money(Math.abs(dialogPrice - dialog.product.price))}`
                    : "Цена по прайсу"}
                </span>
                <span className="font-semibold tabular-nums">
                  {money(dialogPrice !== null && dialogQty > 0 ? dialogPrice * dialogQty : 0)}
                </span>
              </div>
              {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setDialog(null)}>
                  Отмена
                </Button>
                <Button type="submit" className="flex-1">
                  {dialog.mode === "add" ? "В корзину" : "Сохранить"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
