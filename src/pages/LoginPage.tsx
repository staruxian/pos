import { useState } from "react";
import { Lock, Shirt } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-full bg-foreground text-background">
              <Shirt className="size-5" />
            </div>
            <h1 className="text-xl font-bold tracking-[-0.04em]">Shaxzoda Premium</h1>
            <p className="mt-1 text-sm text-muted-foreground">Введите пароль магазина</p>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" disabled={busy || !password}>
              <Lock /> {busy ? "Входим…" : "Войти"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
