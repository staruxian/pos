import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Подтверждение необратимого действия своим диалогом, а не window.confirm():
 * браузер разрешает подавить системные диалоги («не показывать больше»), и тогда
 * confirm() молча возвращает false — кнопка выглядит сломанной и ничего не делает.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" variant="destructive" className="flex-1" disabled={busy} onClick={onConfirm}>
            {busy ? "Удаляем…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
