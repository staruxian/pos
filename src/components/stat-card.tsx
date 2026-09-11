import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Плитка с одним показателем — общая для Товаров, Клиентов и Отчётов. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "debt" | "profit";
}) {
  return (
    <div className="rounded-[var(--radius)] border bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
      </div>
      <p
        className={cn(
          "mt-3 text-2xl font-semibold tabular-nums tracking-[-0.04em]",
          tone === "debt" && "text-destructive",
          tone === "profit" && "text-emerald-600",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
