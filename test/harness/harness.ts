/**
 * Browser test harness reproducing the parts of Obsidian's Canvas that matter
 * for every touch bug we hit, using the SAME gesture module the plugin ships
 * (src/ui/gesture-tap). Playwright drives it as a Galaxy-Tab-like touch device.
 *
 * Cards:
 *   A — whole-card masked (mask overlay is pointer-events:none; a card-level tap
 *       toggles reveal, a drag moves it).
 *   B — plain, unmasked (drag baseline).
 *   C — inline-masked text (small span is pointer-events:auto with tap-vs-drag).
 *
 * Modelled Obsidian behaviours:
 *   - Native card drag via pointer; movement updates transform.
 *   - Empty-canvas pointerdown starts a box-select; cards intersecting the box
 *     get selected. A pointerdown on a card (even over a mask) is a card gesture,
 *     never a box-select — this is what a pointer-events:none mask guarantees.
 *   - An EXTERNAL re-render (Obsidian rebuilding a card) drops our mask overlay;
 *     the maintenance sweep must restore it (mask must not vanish).
 *   - A card rebuild during an active drag cancels the drag UNLESS suppression
 *     skips it while a touch is in progress (the production fix).
 */

import { attachTapVsDrag } from "../../src/ui/gesture-tap";

const GESTURE_IDLE = 260;

interface CardState {
	id: string;
	x: number;
	y: number;
	kind: "whole" | "plain" | "inline";
	revealed: boolean;
	inlineRevealed: boolean;
	dragCancelled: boolean;
}

interface DragCtx {
	id: string;
	startX: number;
	startY: number;
	originX: number;
	originY: number;
	/** True once the pointer actually moved past the drag threshold. */
	moved: boolean;
}

interface HarnessConfig {
	suppressDuringTouch: boolean;
}

const wrapper = document.getElementById("canvas-wrapper") as HTMLElement;
const cards = new Map<string, { el: HTMLElement; state: CardState }>();

let interacting = false;
let idleTimer: number | null = null;
let activeDrag: DragCtx | null = null;
let boxSelecting = false;
let boxStartX = 0;
let boxStartY = 0;
let lastGesture: "none" | "card" | "box" = "none";
let selectedByBox: string[] = [];
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

function hasMaskVisible(id: string): boolean {
	const entry = cards.get(id);
	if (!entry) return false;
	return entry.el.querySelector(".mindvas-mask-tape, .mindvas-inline-mask-wrap") != null;
}

/** Build (or rebuild) a card's content. `withMask=false` mimics an external
 * Obsidian re-render that drops our overlay. */
function renderContent(entry: { el: HTMLElement; state: CardState }, withMask: boolean): void {
	const s = entry.state;
	const content = document.createElement("div");
	content.className = "canvas-node-content";

	if (s.kind === "whole") {
		content.textContent = `Card ${s.id}`;
		if (withMask) {
			const tape = document.createElement("div");
			tape.className = "mindvas-mask-tape mindvas-mask-ui";
			tape.textContent = s.revealed ? "가리기" : "";
			content.appendChild(tape);
		}
	} else if (s.kind === "inline") {
		content.append(document.createTextNode("secret: "));
		if (withMask) {
			const span = document.createElement("span");
			span.className = "mindvas-inline-mask-wrap mindvas-mask-ui";
			span.textContent = s.inlineRevealed ? "answer" : "▮▮▮▮";
			// Inline masks catch touches but use tap-vs-drag so drags fall through.
			attachTapVsDrag(span, {
				onTap: () => {
					s.inlineRevealed = !s.inlineRevealed;
					rebuild(s.id, /*withMask*/ true);
				},
			});
			content.appendChild(span);
		} else {
			content.append(document.createTextNode("▮▮▮▮"));
		}
	} else {
		content.textContent = `Card ${s.id}`;
	}

	const existing = entry.el.querySelector(".canvas-node-content");
	if (existing) existing.replaceWith(content);
	else entry.el.appendChild(content);
}

/** Rebuild content (replaces the content element). A rebuild during an ACTIVE
 * MOVING drag loses the pointer stream and cancels the drag — regardless of
 * whether the rebuild re-adds the mask. A stationary tap (moved=false) does not
 * count as a drag, so tapping to reveal never self-cancels. */
function rebuild(id: string, withMask: boolean): void {
	const entry = cards.get(id);
	if (!entry) return;
	const cancels = activeDrag?.id === id && activeDrag.moved;
	renderContent(entry, withMask);
	if (cancels) {
		entry.state.dragCancelled = true;
		activeDrag = null;
	}
}

/** Drop the mask overlay only, WITHOUT rebuilding the content element — mimics
 * Obsidian clearing our overlay while a drag keeps running. */
function dropMask(id: string): void {
	const entry = cards.get(id);
	if (!entry) return;
	entry.el.querySelectorAll(".mindvas-mask-tape, .mindvas-inline-mask-wrap").forEach((e) => e.remove());
}

function createCard(s: CardState): void {
	const el = document.createElement("div");
	el.className = "canvas-node";
	el.dataset.id = s.id;
	el.style.width = "180px";
	el.style.height = "120px";
	applyTransform(el, s);

	el.addEventListener("pointerdown", (e) => {
		markInteracting();
		lastGesture = "card";
		activeDrag = { id: s.id, startX: e.clientX, startY: e.clientY, originX: s.x, originY: s.y, moved: false };
		el.setPointerCapture?.(e.pointerId);
	});
	el.addEventListener("pointermove", (e) => {
		markInteracting();
		if (!activeDrag || activeDrag.id !== s.id) return;
		if (Math.hypot(e.clientX - activeDrag.startX, e.clientY - activeDrag.startY) > 8) activeDrag.moved = true;
		s.x = activeDrag.originX + (e.clientX - activeDrag.startX);
		s.y = activeDrag.originY + (e.clientY - activeDrag.startY);
		applyTransform(el, s);
	});
	el.addEventListener("pointerup", () => {
		markInteracting();
		if (activeDrag && activeDrag.id === s.id) activeDrag = null;
	});
	el.addEventListener("pointercancel", () => {
		if (activeDrag && activeDrag.id === s.id) activeDrag = null;
	});

	// Whole-card reveal: card-level stationary tap (shared production handler).
	if (s.kind === "whole") {
		attachTapVsDrag(el, {
			swallowTap: false,
			shouldTap: () => true,
			onTap: () => {
				s.revealed = !s.revealed;
				rebuild(s.id, /*withMask*/ true);
			},
		});
	}

	wrapper.appendChild(el);
	const entry = { el, state: s };
	cards.set(s.id, entry);
	renderContent(entry, /*withMask*/ true);
}

function intersects(s: CardState, x0: number, y0: number, x1: number, y1: number): boolean {
	const minX = Math.min(x0, x1);
	const maxX = Math.max(x0, x1);
	const minY = Math.min(y0, y1);
	const maxY = Math.max(y0, y1);
	const cardRight = s.x + 180;
	const cardBottom = s.y + 120;
	return s.x < maxX && cardRight > minX && s.y < maxY && cardBottom > minY;
}

function initBoxSelect(): void {
	wrapper.addEventListener("pointerdown", (e) => {
		markInteracting();
		// A pointerdown that lands on a card (target is the wrapper only for empty
		// space) is a card gesture, never a box-select.
		if (e.target !== wrapper) return;
		boxSelecting = true;
		boxStartX = e.clientX;
		boxStartY = e.clientY;
		lastGesture = "box";
		selectedByBox = [];
	});
	wrapper.addEventListener("pointermove", (e) => {
		if (!boxSelecting) return;
		selectedByBox = [];
		for (const { state } of cards.values()) {
			if (intersects(state, boxStartX, boxStartY, e.clientX, e.clientY)) selectedByBox.push(state.id);
		}
	});
	wrapper.addEventListener("pointerup", () => {
		boxSelecting = false;
	});
}

interface HarnessApi {
	reset: (cfg: Partial<HarnessConfig>) => void;
	getState: (id: string) => (CardState & { maskVisible: boolean }) | null;
	isInteracting: () => boolean;
	runMaintenanceSweep: () => void;
	externalReRender: (id: string) => void;
	getLastGesture: () => string;
	getSelection: () => string[];
}

/** Idle maintenance: restore a mask overlay that went missing (self-heal), and
 * skip while a touch is in progress if suppression is on. */
function runMaintenanceSweep(): void {
	if (config.suppressDuringTouch && interacting) return;
	for (const entry of cards.values()) {
		const s = entry.state;
		const needsMask = s.kind === "whole" || s.kind === "inline";
		if (needsMask && !hasMaskVisible(s.id)) rebuild(s.id, /*withMask*/ true);
	}
}

function reset(cfg: Partial<HarnessConfig>): void {
	config = { suppressDuringTouch: true, ...cfg };
	interacting = false;
	activeDrag = null;
	boxSelecting = false;
	lastGesture = "none";
	selectedByBox = [];
	if (idleTimer !== null) {
		window.clearTimeout(idleTimer);
		idleTimer = null;
	}
	wrapper.innerHTML = "";
	cards.clear();
	createCard({ id: "A", x: 60, y: 60, kind: "whole", revealed: false, inlineRevealed: false, dragCancelled: false });
	createCard({ id: "B", x: 340, y: 60, kind: "plain", revealed: false, inlineRevealed: false, dragCancelled: false });
	createCard({ id: "C", x: 60, y: 320, kind: "inline", revealed: false, inlineRevealed: false, dragCancelled: false });
}

initBoxSelect();

const api: HarnessApi = {
	reset,
	getState: (id) => {
		const entry = cards.get(id);
		if (!entry) return null;
		return { ...entry.state, maskVisible: hasMaskVisible(id) };
	},
	isInteracting: () => interacting,
	runMaintenanceSweep,
	externalReRender: (id) => dropMask(id),
	getLastGesture: () => lastGesture,
	getSelection: () => selectedByBox.slice(),
};

(window as unknown as { harness: HarnessApi }).harness = api;
reset({});
