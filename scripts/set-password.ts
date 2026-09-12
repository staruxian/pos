// Задаёт пароль магазина: echo 'новый-пароль' | bun run set-password
//
// Пароль читается со стандартного ввода, а не из аргумента: аргумент осел бы
// в истории оболочки и был бы виден в списке процессов.
import { setPassword } from "../server/auth";
import { dbReady } from "../server/db";

const MIN_LENGTH = 8;
const password = (await new Response(Bun.stdin.stream()).text()).trim();

if (!password) {
  console.error("Пароль пустой. Запустите так: echo 'новый-пароль' | bun run set-password");
  process.exit(1);
}
if (password.length < MIN_LENGTH) {
  console.error(`Пароль короче ${MIN_LENGTH} символов — так не пойдёт.`);
  process.exit(1);
}

await dbReady;
await setPassword(password);
console.log("Пароль магазина сохранён в базе. Вход включён.");
process.exit(0);
