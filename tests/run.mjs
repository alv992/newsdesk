// Runs every *.test.mjs in this folder and tallies the result.
//   npm test
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(HERE).filter((f) => f.endsWith(".test.mjs")).sort();

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: "inherit" });
  if (r.status === 2) process.exit(2);   // data files missing — helpers already explained
  if (r.status !== 0) failed++;
}

console.log(`\n${files.length - failed} of ${files.length} suites passed`);
process.exit(failed ? 1 : 0);
