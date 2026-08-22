import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(currentDir, "../../api-zod/src/index.ts");
const current = await readFile(indexPath, "utf8");
const next = current.replace(/\nexport \* from ['"]\.\/generated\/types['"];\s*/, "\n");

if (next !== current) {
  await writeFile(indexPath, next);
}