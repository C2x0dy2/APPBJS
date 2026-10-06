import { copyFileSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "./sites-env.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error("Node.js 22.13 ou supérieur est requis. Version actuelle : " + process.versions.node);
  process.exit(1);
}

const wranglerCli = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
if (!existsSync(wranglerCli)) {
  console.error("Installez les dépendances avec npm ci, puis relancez npm run setup:local.");
  process.exit(1);
}

const envPath = path.join(projectRoot, ".env");
if (!existsSync(envPath)) {
  copyFileSync(path.join(projectRoot, ".env.example"), envPath, constants.COPYFILE_EXCL);
  console.log("Configuration locale créée dans .env.");
} else {
  console.log("Configuration .env existante conservée.");
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Compilation de l’application…");
run(path.join(projectRoot, "scripts", "run-framework.mjs"), ["build"]);

// Reuse the built database identity, so migrations and the app share one local DB.
// This config is ignored by Git and used only with --local.
const builtConfig = JSON.parse(readFileSync(path.join(projectRoot, "dist", "server", "wrangler.json"), "utf8"));
const hosting = JSON.parse(readFileSync(path.join(projectRoot, ".openai", "hosting.json"), "utf8"));
const binding = builtConfig.d1_databases?.find((db) => db.binding === hosting.d1);
if (!binding) throw new Error("La compilation ne contient pas la base D1 attendue.");
const localConfigPath = path.join(projectRoot, ".sites-runtime", "local-migrations.json");
mkdirSync(path.dirname(localConfigPath), { recursive: true });
writeFileSync(localConfigPath, JSON.stringify({
  name: "billetterie-local",
  compatibility_date: builtConfig.compatibility_date,
  d1_databases: [{ ...binding, migrations_dir: "../drizzle" }],
}, null, 2) + "\n");

console.log("Application des migrations sur la base locale…");
run(wranglerCli, [
  "d1", "migrations", "apply", binding.binding,
  "--local", "--config", localConfigPath,
  "--persist-to", path.join(projectRoot, ".wrangler", "state"),
]);

console.log("Préparation terminée. Lancez npm run dev, puis ouvrez http://127.0.0.1:5173.");
