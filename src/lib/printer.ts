// Печать идёт не через браузер, а через локальный мост к принтеру Xprinter:
// он слушает на компьютере кассы и сам отправляет этикетку на устройство.
const PRINT_URL = import.meta.env.VITE_PRINT_URL || "http://localhost:5000/print";

export type PrintLabel = {
  /** Номер штрихкода — то, что кодируется в Code 128. */
  data: string;
  /** Подпись на этикетке, обычно название товара. */
  text: string;
};

export async function printLabel(label: PrintLabel): Promise<void> {
  let res: Response;
  try {
    res = await fetch(PRINT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(label),
    });
  } catch {
    // Мост не запущен, занят другим адресом или заблокирован браузером.
    throw new Error("Принтер недоступен. Проверьте, что программа печати запущена");
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail || `Принтер вернул ошибку (${res.status})`);
  }
}
