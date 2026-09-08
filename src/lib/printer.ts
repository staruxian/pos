// Печать идёт не через браузер, а через локальный мост к принтеру Xprinter:
// он слушает на компьютере кассы и сам отправляет этикетку на устройство.
const PRINT_URL = import.meta.env.VITE_PRINT_URL || "http://localhost:5000/print";

export type PrintLabel = {
  /** Номер штрихкода — то, что кодируется в Code 128. */
  data: string;
  /** Подпись на этикетке, обычно название товара. */
  text: string;
};

/**
 * Мост обычно подставляет подпись в шаблон команд принтера (TSPL/ESC-POS), поэтому
 * управляющие символы и перевод строки из названия товара могли бы дописать в этот
 * шаблон свои команды. Вырезаем их здесь и ограничиваем длину строки.
 */
function sanitizeText(value: string) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}

export async function printLabel(label: PrintLabel): Promise<void> {
  if (!/^\d{1,64}$/.test(label.data)) {
    throw new Error("Штрихкод должен состоять только из цифр");
  }
  const payload: PrintLabel = { data: label.data, text: sanitizeText(label.text) };

  let res: Response;
  try {
    res = await fetch(PRINT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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
