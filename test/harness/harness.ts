/**
 * Browser test harness that reproduces the parts of Obsidian's Canvas that
 * matter for the drag-vs-mask conflict, using the SAME gesture module the
 * plugin ships (src/ui/gesture-tap). It lets Playwright verify, without a real
 * Galaxy Tab, that:
 *   1. a stationary tap on a masked card toggles reveal,
 *   2. a drag moves the card and never toggles reveal,
 *   3. a card re-render triggered mid-drag does NOT cancel the drag while a
 *      touch is in progress (the production "suppress sync during touch" fix),
 *      and DOES cancel it when suppression is disabled (control case).
 *
 * Model of Obsidian behaviour used here:
 *   - A card is dragged by pointer; movement updates its transform.
 *   - Re-rendering a card replaces its content element. If that happens while a
 *     drag is in progress on that card, the pointer stream is lost and the drag
 *     is cancelled (mirrors real Obsidian, where a mid-drag DOM rebuild kills a
 *     touch drag).
 *   - The plugin sets an `interacting` flag on any pointer activity and skips
 *     re-render while it is set (GESTURE_IDLE window), which is what keeps the
 *     drag alive.
 */

import { attachTapVsDrag } from "../../src/ui/gesture-tap";

const GESTURE_IDLE = 260;

interface CardState {
	id: string;
	x: number;
	y: number;
	masked: boolean;
	revealed: boolean;
	/** Set true if a re-render cancelled an in-progress drag on this card. */
	dragCancelled: boolean;
}

interface DragCtx {
	id: string;
	pointerId: number;
	startX: number;
	startY: number;
	originX: number;
	originY: number;
}

interface HarnessConfig {
	/** Reproduce the production fix: skip re-render while a touch is active. */
	suppressDuringTouch: boolean;
}

const wrapper = document.getElementById("canvas-wrapper") as HTMLElement;
const cards = new Map<string, { el: HTMLElement; content: HTMLElement; state: CardState }>();

let interacting = false;
let idleTimer: number | null = null;
let activeDrag: DragCtx | null = null;
let config: HarnessConfig = { suppressDuringTouch: true };

function markInteracting(): void {
	interacting = true;
	if (idleTimer !== null) window.clearTimeout(idleTimer);
	idleTimer = window.setTimeout(() => {
		interacting = false;
		idleTimer = null;
	}, GESTURE_IDLE);
}

function applyTransform(el: HTMLElement, s: CardState): void {
	el.style.transform = `translate(${s.x}px, ${s.y}px)`;
}

function buildContent(s: CardState): HTMLElement {
	const content = document.createElement("div");
	content.className = "canvas-node-content";
	content.textContent = `Card ${s.id}`;

	if (s.masked) {
		// Whole-card mask overlay: pointer-events:none (never catches gestures).
		const tape = document.createElement("div");
		tape.className = "mindvas-mask-tape mindvas-mask-ui";
		tape.textContent = s.revealed ? "가리기" : "";
		tape.dataset.revealed = String(s.revealed);
		content.appendChild(tape);
	}
	return content;
}

function createCard(s: CardState): void {
	const el = document.createElement("div");
	el.className = "canvas-node";
	el.dataset.id = s.id;
	el.style.left = "0px";
	el.style.top = "0px";
	el.style.width = "180px";
	el.style.height = "120px";
	applyTransform(el, s);

	const content = buildContent(s);
	el.appendChild(content);

	// --- Simulated Obsidian native drag on the card element ---
	el.addEventListener("pointerdown", (e) => {
		markInteracting();
		activeDrag = {
			id: s.id,
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			originX: s.x,
			originY: s.y,
		};
		el.setPointerCapture?.(e.pointerId);
	});
	el.addEventListener("pointermove", (e) => {
		markInteracting();
		if (!activeDrag || activeDrag.id !== s.id) return;
		s.x = activeDrag.originX + (e.clientX - activeDrag.startX);
		s.y = activeDrag.originY + (e.clientY - activeDrag.startY);
		applyTransform(el, s);
	});
	const endDrag = () => {
		if (activeDrag && activeDrag.id === s.id) activeDrag = null;
	};
	el.addEventListener("pointerup", () => {
		markInteracting();
		endDrag();
	});
	el.addEventListener("pointercancel", endDrag);

	// --- Shared production tap-vs-drag: stationary tap toggles reveal ---
	attachTapVsDrag(el, {
		swallowTap: false,
		shouldTap: () => s.masked,
		onTap: () => {
			s.revealed = !s.revealed;
			reRenderCard(s.id, /*force*/ true);
		},
	});

	wrapper.appendChild(el);
	cards.set(s.id, { el, content, state: s });
}

/**
 * Re-render a card by replacing its content element (mirrors Obsidian). If a
 * drag is in progress on this card and suppression is on, we skip — which is
 * exactly what keeps the drag alive in production. If suppression is off (or a
 * forced reveal toggle), we replace and, if a drag was active on it, mark it
 * cancelled.
 */
function reRenderCard(id: string, force: boolean): void {
	const entry = cards.get(id);
	if (!entry) return;

	const draggingThis = activeDrag?.id === id;
	if (!force && config.suppressDuringTouch && interacting) return;

	const newContent = buildContent(entry.state);
	entry.content.replaceWith(newContent);
	entry.content = newContent;

	// A content rebuild during an active drag loses the pointer stream.
	if (draggingThis && !force) {
		entry.state.dragCancelled = true;
		activeDrag = null;
	}
}

/** Periodic-maintenance analogue: try to re-render every masked card. */
function runMaintenanceSweep(): void {
	for (const { state } of cards.values()) {
		if (state.masked) reRenderCard(state.id, /*force*/ false);
	}
}

interface HarnessApi {
	reset: (cfg: Partial<HarnessConfig>) => void;
	getState: (id: string) => CardState | null;
	isInteracting: () => boolean;
	runMaintenanceSweep: () => void;
}

function reset(cfg: Partial<HarnessConfig>): void {
	config = { suppressDuringTouch: true, ...cfg };
	interacting = false;
	activeDrag = null;
	if (idleTimer !== null) {
		window.clearTimeout(idleTimer);
		idleTimer = null;
	}
	wrapper.innerHTML = "";
	cards.clear();
	createCard({ id: "A", x: 40, y: 40, masked: true, revealed: false, dragCancelled: false });
	createCard({ id: "B", x: 300, y: 40, masked: false, revealed: false, dragCancelled: false });
}

const api: HarnessApi = {
	reset,
	getState: (id) => cards.get(id)?.state ?? null,
	isInteracting: () => interacting,
	runMaintenanceSweep,
};

(window as unknown as { harness: HarnessApi }).harness = api;
reset({});
