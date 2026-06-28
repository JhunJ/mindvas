#!/usr/bin/env node
/**
 * Copy built plugin files into a vault's .obsidian/plugins/mindvas folder.
 *
 * Usage:
 *   npm run install-to-vault
 *   VAULT=/other/vault npm run install-to-vault
 */
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const DEFAULT_VAULT = join(homedir(), "Documents", "Obsidian Vault");
const vaultInput = process.env.VAULT ?? DEFAULT_VAULT;
const vault = resolve(vaultInput.replace(/^~(?=\/|$)/, homedir()));

const root = resolve(import.meta.dirname, "..");
const target = join(vault, ".obsidian", "plugins", "mindvas");

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	const src = join(root, file);
	if (!existsSync(src)) {
		console.error(`Missing ${file}. Run npm run build first.`);
		process.exit(1);
	}
}

if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`Not an Obsidian vault (no .obsidian folder):\n  ${vault}`);
	process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
	cpSync(join(root, file), join(target, file));
}

const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
if (manifest.isDesktopOnly === true) {
	console.error("ERROR: manifest.json has isDesktopOnly: true — mobile will reject this plugin.");
	process.exit(1);
}

// Ensure mindvas is in community-plugins.json so sync enables it on mobile too.
const pluginsJsonPath = join(vault, ".obsidian", "community-plugins.json");
if (existsSync(pluginsJsonPath)) {
	const enabled = JSON.parse(readFileSync(pluginsJsonPath, "utf8"));
	if (Array.isArray(enabled) && !enabled.includes("mindvas")) {
		enabled.push("mindvas");
		enabled.sort();
		writeFileSync(pluginsJsonPath, JSON.stringify(enabled, null, 2) + "\n");
		console.log("Added mindvas to community-plugins.json");
	}
}

console.log(`Installed Mindvas ${manifest.version} → ${target}`);
console.log("Sync your vault, then reopen Obsidian on mobile.");
