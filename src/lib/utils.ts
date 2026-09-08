import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Суммы хранятся и передаются целым числом тийинов (1/100 сума), чтобы не копить
 * ошибку двоичных дробей. Конвертация происходит только на границе с формами.
 */
export function money(minor: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/** Строка из поля ввода → тийины. null, если введено не число или число отрицательное. */
export function toMinor(value: string | number): number | null {
  const amount = typeof value === "number" ? value : Number(value.trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

/** Тийины → значение для поля ввода: 10050 → "100.5". */
export function fromMinor(minor: number) {
  return String(minor / 100);
}
