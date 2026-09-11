import { useMemo, useState } from "react";
import { Barcode, Pencil, Plus, Search, Shirt, Trash2 } from "lucide-react";
import { api, type Product } from "@/lib/api";
import { printLabel } from "@/lib/printer";
import { cn, fromMinor, money, toMinor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

type Form = { name: string; price: string; cost: string; stock: string; sku: string; category: string; size: string; color: string };

const empty: Form = { name: "", price: "", cost: "", stock: "", sku: "", category: "Верх", size: "", color: "" };
const categories = ["Верх", "Низ", "Платья", "Верхняя одежда", "Обувь", "Аксессуары"];

export function ProductsPage({
  products,
  onChange,
}: {
  products: Product[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? products.filter((p) =>
          [p.name, p.category, p.size, p.color, p.sku].some((value) =>
            value.toLowerCase().includes(q),
          ),
        )
      : products;
  }, [products, query]);

  function startCreate() {
    setEditing(null);
    setForm(empty);
    setError(null);
    setOpen(true);
  }

  function startEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      price: fromMinor(p.price),
      cost: fromMinor(p.cost_price),
      stock: String(p.stock),
      sku: p.sku,
      category: p.category,
      size: p.size,
      color: p.color,
    });
    setError(null);
    setOpen(true);
  }

  async function save() {
    setError(null);
    const price = toMinor(form.price);
    const cost = toMinor(form.cost.trim() || "0");
    const stock = Number(form.stock);
    if (!form.name.trim()) return setError("Укажите название");
    if (price === null) return setError("Укажите корректную цену продажи");
    if (cost === null) return setError("Укажите корректную закупочную цену");
    if (!Number.isInteger(stock) || stock < 0) return setError("Количество должно быть целым числом");
    try {
      if (editing) {
        await api.updateProduct(editing.id, {
          name: form.name.trim(),
          price,
          cost_price: cost,
          stock,
          sku: form.sku.trim() || editing.sku,
          category: form.category.trim() || "Без категории",
          size: form.size.trim(),
          color: form.color.trim(),
        });
      } else {
        await api.createProduct({
          name: form.name.trim(),
          price,
          cost_price: cost,
          stock,
          sku: form.sku.trim() || undefined,
          category: form.category.trim() || "Без категории",
          size: form.size.trim(),
          color: form.color.trim(),
        });
      }
      setOpen(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить товар");
    }
  }

  async function sendToPrinter(p: Product) {
    setPrinting(true);
    setPrintResult(null);
    try {
      await printLabel({ data: p.sku, text: p.name });
      setPrintResult({ ok: true, message: "Этикетка отправлена на принтер" });
    } catch (err) {
      setPrintResult({
        ok: false,
        message: err instanceof Error ? err.message : "Не удалось напечатать этикетку",
      });
    } finally {
      setPrinting(false);
    }
  }

  async function remove(p: Product) {
    if (!confirm(`Удалить товар «${p.name}»?`)) return;
    try {
      await api.deleteProduct(p.id);
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Не удалось удалить товар");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Товары</p>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">Весь ассортимент.</h2>
          <p className="mt-3 text-muted-foreground">Модели, размеры, цвета, остатки и ценники.</p>
        </div>
        <Button onClick={startCreate} size="lg">
          <Plus /> Добавить товар
        </Button>
      </div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по товару или штрихкоду" className="h-12 bg-card pl-11" />
      </div>
      <div className="overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Товар</TableHead>
              <TableHead>Вариант</TableHead>
              <TableHead>Штрихкод</TableHead>
              <TableHead className="text-right">Закупка</TableHead>
              <TableHead className="text-right">Продажа</TableHead>
              <TableHead className="text-right">Остаток</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-muted"><Shirt className="size-4" /></div>
                    <div><div className="font-semibold">{p.name}</div><div className="text-xs text-muted-foreground">{p.category}</div></div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {p.size && <Badge variant="secondary" className="rounded-full">{p.size}</Badge>}
                    {p.color && <Badge variant="secondary" className="rounded-full">{p.color}</Badge>}
                    {!p.size && !p.color && <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                <TableCell className="text-right text-muted-foreground">{money(p.cost_price)}</TableCell>
                <TableCell className="text-right">
                  {money(p.price)}
                  {p.cost_price > 0 && (
                    <div className="text-xs text-muted-foreground">
                      +{money(p.price - p.cost_price)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={p.stock <= 5 ? "destructive" : "secondary"}>{p.stock}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => setBarcodeProduct(p)} title="Штрихкод" aria-label={`Штрихкод товара ${p.name}`}>
                    <Barcode />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(p)} title="Редактировать" aria-label={`Редактировать товар ${p.name}`}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p)} title="Удалить" aria-label={`Удалить товар ${p.name}`}>
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  {query ? "По вашему запросу ничего не найдено." : "Товаров пока нет."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать товар" : "Новый товар"}</DialogTitle>
            <DialogDescription>Для каждого размера и цвета создавайте отдельную позицию.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Название</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="category">Категория</Label>
                <select
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="h-10 rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
                >
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="size">Размер</Label>
                <Input id="size" value={form.size} placeholder="M / 38" onChange={(e) => setForm({ ...form, size: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="color">Цвет</Label>
                <Input id="color" value={form.color} placeholder="Чёрный" onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cost">Закупочная цена</Label>
                <Input
                  id="cost"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="price">Цена продажи</Label>
                <Input
                  id="price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stock">Количество</Label>
                <Input
                  id="stock"
                  type="number"
                  min={0}
                  step={1}
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sku">Номер штрихкода (необязательно)</Label>
              <Input
                id="sku"
                value={form.sku}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Любое количество цифр или оставьте пустым"
                onChange={(e) => setForm({ ...form, sku: e.target.value.replace(/\D/g, "") })}
              />
              <p className="text-xs text-muted-foreground">Ограничений по длине нет. Если поле пустое, номер создастся автоматически.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={save}>Сохранить</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!barcodeProduct}
        onOpenChange={(v) => {
          if (!v) {
            setBarcodeProduct(null);
            setPrintResult(null);
          }
        }}
      >
        <DialogContent>
          {barcodeProduct && (
            <>
              <DialogHeader>
                <DialogTitle>{barcodeProduct.name}</DialogTitle>
                <DialogDescription>{[barcodeProduct.category, barcodeProduct.size, barcodeProduct.color].filter(Boolean).join(" · ")} · формат Code 128</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-sm rounded-2xl border bg-white p-4">
                  <img
                    src={`/api/products/${barcodeProduct.id}/barcode`}
                    alt={`Штрихкод товара ${barcodeProduct.name}`}
                    className="h-auto w-full"
                  />
                </div>
                <p className="font-mono text-sm">{barcodeProduct.sku}</p>
                <Button variant="outline" disabled={printing} onClick={() => void sendToPrinter(barcodeProduct)}>
                  {printing ? "Печать…" : "Печать"}
                </Button>
                {printResult && (
                  <p className={cn("text-sm", printResult.ok ? "text-muted-foreground" : "text-destructive")}>
                    {printResult.message}
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
