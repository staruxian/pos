import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Minus, Plus, ScanBarcode, Shirt, ShoppingBag, Trash2 } from "lucide-react";
import { api, type Product } from "@/lib/api";
import { money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Line = { product: Product; qty: number };

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
  const [category, setCategory] = useState("Все");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function addProduct(product: Product, qty = 1) {
    setMessage(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      const nextQty = (existing?.qty ?? 0) + qty;
      if (nextQty > product.stock) {
        setMessage(`Для товара «${product.name}» доступно только ${product.stock} шт.`);
        return prev;
      }
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, qty: nextQty } : l,
        );
      }
      return [...prev, { product, qty }];
    });
  }

  async function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sku = scan.trim();
    if (!sku) return;
    setScan("");
    try {
      const product =
        products.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) ??
        (await api.productByBarcode(sku));
      addProduct(product, 1);
    } catch {
      setMessage(`Товар со штрихкодом ${sku} не найден`);
    }
    inputRef.current?.focus();
  }

  function setQty(id: number, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.product.id !== id) return l;
          const next = Math.max(1, Math.min(qty, l.product.stock));
          return { ...l, qty: next };
        })
        .filter((l) => l.qty > 0),
    );
  }

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.product.price * l.qty, 0),
    [cart],
  );
  const categories = useMemo(
    () => ["Все", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))],
    [products],
  );
  const visibleProducts = category === "Все" ? products : products.filter((product) => product.category === category);

  async function checkout() {
    if (!cart.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const sale = await api.checkout(
        cart.map((l) => ({ product_id: l.product.id, qty: l.qty })),
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

  return (
    <div>
      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Новая продажа</p>
        <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.05em] sm:text-5xl">Быстрая и удобная касса.</h2>
        <p className="mt-3 text-muted-foreground">Отсканируйте этикетку или выберите товар из каталога.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_390px]">
      <div className="space-y-5">
        <form onSubmit={onScanSubmit} className="relative rounded-[var(--radius)] bg-card shadow-sm">
          <ScanBarcode className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-primary" />
          <Input
            ref={inputRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Сканируйте штрихкод товара"
            aria-label="Штрихкод товара"
            className="h-16 rounded-[var(--radius)] border-0 bg-card pl-14 pr-24 text-lg shadow-none focus-visible:ring-4"
            autoComplete="off"
          />
          <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">ВВОД</span>
        </form>
        {message && (
          <p className="rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground">{message}</p>
        )}
        <div className="flex gap-2 overflow-x-auto pb-1 pt-2">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${category === item ? "bg-primary text-primary-foreground shadow-sm" : "border bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold">Каталог</h3><span className="text-sm text-muted-foreground">Товаров: {visibleProducts.length}</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visibleProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addProduct(p)}
              disabled={p.stock < 1}
              className="group min-h-44 overflow-hidden rounded-[var(--radius)] border bg-card text-left shadow-xs transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md disabled:opacity-40"
            >
              <div className="grid h-20 place-items-center bg-gradient-to-br from-muted to-card"><Shirt className="size-7 text-muted-foreground transition-transform group-hover:scale-110" /></div>
              <div className="p-4">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{p.category}</span>{p.size && <><span>·</span><span>{p.size}</span></>}{p.color && <><span>·</span><span>{p.color}</span></>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2"><span className="text-lg font-semibold tracking-tight">{money(p.price)}</span><Badge variant={p.stock <= 5 ? "destructive" : "secondary"} className="rounded-full">{p.stock}</Badge></div>
              </div>
            </button>
          ))}
          {!products.length && (
            <p className="col-span-full text-sm text-muted-foreground">
              Сначала добавьте товары, затем сканируйте их штрихкоды на кассе.
            </p>
          )}
        </div>
      </div>

      <Card className="h-fit lg:sticky lg:top-24">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><ShoppingBag className="size-4" /> Текущая продажа</div>
            <span className="text-sm text-muted-foreground">Позиций: {cart.reduce((n, line) => n + line.qty, 0)}</span>
          </div>
          {!cart.length && (
            <div className="rounded-2xl border border-dashed p-8 text-center"><ShoppingBag className="mx-auto mb-3 size-6 text-muted-foreground" /><p className="text-sm font-medium">Корзина пуста</p><p className="mt-1 text-xs text-muted-foreground">Отсканируйте или выберите товар.</p></div>
          )}
          <div className="space-y-3">
            {cart.map((line) => (
              <div key={line.product.id} className="rounded-2xl bg-muted/65 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{line.product.name}</div>
                    <div className="text-xs text-muted-foreground">{[line.product.size, line.product.color].filter(Boolean).join(" · ") || line.product.category}</div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Убрать товар ${line.product.name}`}
                    onClick={() =>
                      setCart((prev) => prev.filter((l) => l.product.id !== line.product.id))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={`Уменьшить количество товара ${line.product.name}`}
                      onClick={() => setQty(line.product.id, line.qty - 1)}
                    >
                      <Minus />
                    </Button>
                    <Input
                      className="h-9 w-16 text-center"
                      type="number"
                      min={1}
                      max={line.product.stock}
                      value={line.qty}
                      onChange={(e) => setQty(line.product.id, Number(e.target.value))}
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={`Увеличить количество товара ${line.product.name}`}
                      onClick={() => setQty(line.product.id, line.qty + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <div className="font-medium">{money(line.product.price * line.qty)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-end justify-between border-t pt-4">
            <span>Итого</span>
            <span className="text-3xl font-semibold tracking-[-0.04em]">{money(total)}</span>
          </div>
          <Button className="w-full" size="lg" disabled={!cart.length || busy} onClick={checkout}>
            {busy ? "Оформляем…" : "Оформить продажу"} <ArrowRight />
          </Button>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
