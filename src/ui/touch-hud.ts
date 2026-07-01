/**
 * Temporary on-screen touch diagnostics HUD (mobile/tablet). Shows, in real
 * time, what happens on each pointerdown/up and whether Mindvas sync / Obsidian
 * drag state changes between gestures — so we can pin down why a second long-
 * press after moving a card only pans instead of grabbing the card.
 *
 * Toggled by a command; off by default. Purely observational.
 */

const FLAG = "__mindvasTouchHud";

interface Win {
	[FLAG]?: boolean;
}

let hudEl: HTMLElement | null = null;
const lines = new Map<string, string>();
const lineOrder = ["DOWN", "UP", "now"];

export function hudEnabled(): boolean {
	return !!(window as unknown as Win)[FLAG];
}

function ensureHud(): void {
	if (hudEl) return;
	hudEl = document.createElement("div");
	hudEl.className = "mindvas-touch-hud";
	document.body.appendChild(hudEl);
	render();
}

function removeHud(): void {
	hudEl?.remove();
	hudEl = null;
}

export function toggleHud(): boolean {
	const w = window as unknown as Win;
	w[FLAG] = !w[FLAG];
	if (w[FLAG]) ensureHud();
	else removeHud();
	return !!w[FLAG];
}

/** Set a named line (e.g. "DOWN", "UP", "now"). */
export function hudLine(id: string, text: string): void {
	if (!hudEnabled()) return;
	lines.set(id, text);
	ensureHud();
	render();
}

function render(): void {
	if (!hudEl) return;
	const ids = [
		...lineOrder.filter((k) => lines.has(k)),
		...[...lines.keys()].filter((k) => !lineOrder.includes(k)),
	];
	hudEl.textContent = ids.map((id) => `${id}: ${lines.get(id)}`).join("\n");
}
