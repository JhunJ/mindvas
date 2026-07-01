/**
 * Temporary on-screen touch diagnostics HUD (mobile/tablet). It shows, in real
 * time, what happens on each pointerdown and whether Mindvas sync runs during a
 * gesture — so we can pin down why a second long-press after moving a card falls
 * through to a canvas pan instead of grabbing the card.
 *
 * Toggled by a command; off by default. Purely observational (no listeners that
 * could affect gestures) — it only reads values pushed to it via `hudSet`.
 */

const FLAG = "__mindvasTouchHud";

interface Win {
	[FLAG]?: boolean;
}

let hudEl: HTMLElement | null = null;
const data: Record<string, string | number> = {};
const order = ["down", "tgt", "dragTgt", "int", "ph", "isDrag", "sinceSync", "syncN", "up"];

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

export function hudSet(key: string, value: string | number): void {
	if (!hudEnabled()) return;
	data[key] = value;
	ensureHud();
	render();
}

function render(): void {
	if (!hudEl) return;
	const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))];
	hudEl.textContent = keys.map((k) => `${k}=${data[k]}`).join("  ");
}
