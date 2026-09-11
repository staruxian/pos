import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Minus, Pencil, Plus, ScanBarcode, ShoppingBag, Trash2 } from "lucide-react";
import { api, type Product } from "@/lib/api";
import { fromMinor, money, toMinor } from "@/lib/utils";
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

  async function checkout() {
    if (!cart.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const sale = await api.checkout(
        cart.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: l.unitPrice })),
      );
      setCart([]);
      setMessage(`Продажа №${sale.id} оформлена · ${money(sale.total)}`);
      onSold();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не удалось оформить продажу");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

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
          <Button size="lg" disabled={!cart.length || busy} onClick={checkout}>
            {busy ? "Оформляем…" : "Оформить продажу"} <ArrowRight />
          </Button>
        </div>
      </div>

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
