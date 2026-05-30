import { spawnSync } from "node:child_process";
import { rm, cp, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";

const tscResult = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.json"], {
  stdio: "inherit",
  shell: true,
});
if (tscResult.status !== 0) process.exit(tscResult.status ?? 1);

await rm("dist/ui", { recursive: true, force: true });
await cp("src/ui", "dist/ui", { recursive: true });

if (existsSync("dist/cli.js") && process.platform !== "win32") {
  await chmod("dist/cli.js", 0o755);
}

console.log("Build complete: dist/");
