import { useCallback, useEffect, useState } from "react";
import { BarChart3, LogOut, ScanBarcode, Shirt, Users } from "lucide-react";
import { Link, NavLink, Outlet, useOutletContext } from "react-router-dom";
import { api, UNAUTHORIZED_EVENT, UnauthorizedError, type Product } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SellPage } from "@/pages/SellPage";
import { ProductsPage } from "@/pages/ProductsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { LoginPage } from "@/pages/LoginPage";

const tabs: { path: string; label: string; icon: typeof ScanBarcode; end?: boolean }[] = [
  { path: "/", label: "Касса", icon: ScanBarcode, end: true },
  { path: "/products", label: "Товары", icon: Shirt },
  { path: "/clients", label: "Клиенты", icon: Users },
  { path: "/reports", label: "Отчёты", icon: BarChart3 },
];

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reportKey, setReportKey] = useState(0);
  // null — сессию ещё проверяем и рисовать нечего.
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  // Вход по паролю включается на сервере наличием POS_PASSWORD.
  const [authRequired, setAuthRequired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProducts(await api.products());
      setLoadError(null);
    } catch (err) {
      // Об истёкшей сессии сообщит экран входа, а не плашка с ошибкой.
      if (err instanceof UnauthorizedError) return;
      setLoadError(err instanceof Error ? err.message : "Сервер недоступен");
    }
  }, []);

  useEffect(() => {
    api.session()
      .then((s) => {
        setAuthRequired(s.authRequired);
        setAuthenticated(s.authenticated);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  // Любой запрос, вернувший 401, роняет приложение обратно на экран входа.
  useEffect(() => {
    const onUnauthorized = () => setAuthenticated(false);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated, refresh]);

  async function logout() {
    try {
      await api.logout();
    } finally {
      setAuthenticated(false);
      setProducts([]);
    }
  }

  if (authenticated === null) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Загрузка…</div>;
  }

  if (!authenticated) {
    return <LoginPage onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen pb-24 sm:pb-8">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3" aria-label="Перейти на кассу">
            <div className="grid size-10 place-items-center rounded-full bg-foreground text-background shadow-lg shadow-black/10">
              <Shirt className="size-[18px]" />
            </div>
            <div>
              <h1 className="text-[17px] font-bold tracking-[-0.04em]">Shaxzoda Premium</h1>
              <p className="text-xs text-muted-foreground">Магазин одежды</p>
            </div>
          </Link>
          <nav className="fixed inset-x-4 bottom-4 z-50 flex justify-center gap-1 rounded-2xl border bg-card/90 p-1.5 shadow-xl backdrop-blur-2xl sm:static sm:rounded-xl sm:bg-muted/80 sm:shadow-none">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <NavLink
                  key={t.path}
                  to={t.path}
                  end={t.end}
                  preventScrollReset
                  viewTransition
                  className={({ isActive }) => cn(
                      "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 py-2 text-xs font-medium transition-all sm:flex-none sm:gap-2 sm:px-4 sm:text-sm",
                      isActive ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                  <Icon className="size-4" />
                  {t.label}
                </NavLink>
              );
            })}
          </nav>
          {authRequired && (
          <button
            type="button"
            onClick={() => void logout()}
            title="Выйти"
            aria-label="Выйти"
            className="shrink-0 rounded-xl p-2 text-muted-foreground transition hover:text-foreground"
          >
            <LogOut className="size-4" />
          </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {loadError && (
          <p className="mb-6 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            {loadError}.
            {import.meta.env.DEV && <> Запустите локальный сервер командой <code>bun run dev:server</code>.</>}
          </p>
        )}
        <Outlet
          context={{
            products,
            refreshProducts: refresh,
            reportKey,
            markSale: () => {
              void refresh();
              setReportKey((key) => key + 1);
            },
          } satisfies AppOutletContext}
        />
      </main>
    </div>
  );
}

type AppOutletContext = {
  products: Product[];
  refreshProducts: () => Promise<void>;
  reportKey: number;
  markSale: () => void;
};

function useAppOutlet() {
  return useOutletContext<AppOutletContext>();
}

export function SellRoute() {
  const { products, markSale } = useAppOutlet();
  return <SellPage products={products} onSold={markSale} />;
}

export function ProductsRoute() {
  const { products, refreshProducts } = useAppOutlet();
  return <ProductsPage products={products} onChange={() => void refreshProducts()} />;
}

export function ReportsRoute() {
  const { reportKey } = useAppOutlet();
  return <ReportsPage key={reportKey} />;
}

export function ClientsRoute() {
  return <ClientsPage />;
}
