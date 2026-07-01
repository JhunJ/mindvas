/**
 * Touch tap-vs-drag detection, shared by production mask handlers and the test
 * harness so both exercise identical logic.
 *
 * The contract: pointerdown/pointermove are PASSIVE and never stop propagation,
 * so the underlying canvas still receives them and can drag / long-press / box-
 * select the card. Only a stationary tap (movement under `slop` px) fires
 * `onTap` on pointerup; a drag is ignored so the card moves natively.
 *
 * This module must stay free of Obsidian imports so it can be bundled for the
 * browser test harness.
 */

export const DEFAULT_TAP_SLOP = 8;

export interface TapVsDragOptions {
	/** Max pointer travel (px) still considered a tap. */
	slop?: number;
	/** Called on a stationary tap. */
	onTap: () => void;
	/** Optional guard; if it returns false the tap is ignored (no toggle). */
	shouldTap?: () => boolean;
	/** Swallow the pointerup (preventDefault + stopPropagation) when a tap fires. */
	swallowTap?: boolean;
}

interface PointerLike {
	clientX: number;
	clientY: number;
	preventDefault?: () => void;
	stopPropagation?: () => void;
}

function travel(ax: number, ay: number, bx: number, by: number): number {
	return Math.hypot(ax - bx, ay - by);
}

/** Attach tap-vs-drag handling to a single element. Returns a disposer. */
export function attachTapVsDrag(el: HTMLElement, opts: TapVsDragOptions): () => void {
	const slop = opts.slop ?? DEFAULT_TAP_SLOP;
	let startX = 0;
	let startY = 0;
	let moved = false;

	const onDown = (e: Event) => {
		const p = e as unknown as PointerLike;
		startX = p.clientX;
		startY = p.clientY;
		moved = false;
	};
	const onMove = (e: Event) => {
		const p = e as unknown as PointerLike;
		if (travel(p.clientX, p.clientY, startX, startY) > slop) moved = true;
	};
	const onUp = (e: Event) => {
		if (moved) return;
		if (opts.shouldTap && !opts.shouldTap()) return;
		if (opts.swallowTap !== false) {
			const p = e as unknown as PointerLike;
			p.preventDefault?.();
			p.stopPropagation?.();
		}
		opts.onTap();
	};

	el.addEventListener("pointerdown", onDown, { passive: true });
	el.addEventListener("pointermove", onMove, { passive: true });
	el.addEventListener("pointerup", onUp, { capture: true });

	return () => {
		el.removeEventListener("pointerdown", onDown);
		el.removeEventListener("pointermove", onMove);
		el.removeEventListener("pointerup", onUp, { capture: true } as EventListenerOptions);
	};
}

/**
 * Document-delegated tap-vs-drag: use when the tappable target is matched by a
 * selector at pointerup time (e.g. dynamically re-created mask tapes). Resolves
 * the element from the event target via `match`.
 */
export interface DelegatedTapOptions {
	slop?: number;
	/** Resolve the tappable element from a pointer event target, or null. */
	match: (target: HTMLElement) => HTMLElement | null;
	/** Called with the resolved element on a stationary tap. */
	onTap: (el: HTMLElement) => void;
}

export function createDelegatedTapHandlers(opts: DelegatedTapOptions): {
	onPointerDown: (e: Event) => void;
	onPointerMove: (e: Event) => void;
	onPointerUp: (e: Event) => void;
} {
	const slop = opts.slop ?? DEFAULT_TAP_SLOP;
	let downEl: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let moved = false;

	return {
		onPointerDown: (e: Event) => {
			const p = e as unknown as PointerLike;
			const target = (e.target as HTMLElement) ?? null;
			downEl = target ? opts.match(target) : null;
			startX = p.clientX;
			startY = p.clientY;
			moved = false;
		},
		onPointerMove: (e: Event) => {
			if (!downEl) return;
			const p = e as unknown as PointerLike;
			if (travel(p.clientX, p.clientY, startX, startY) > slop) moved = true;
		},
		onPointerUp: (e: Event) => {
			const target = (e.target as HTMLElement) ?? null;
			const el = target ? opts.match(target) : null;
			const wasMoved = moved;
			downEl = null;
			if (!el || wasMoved) return;
			const p = e as unknown as PointerLike;
			p.preventDefault?.();
			p.stopPropagation?.();
			opts.onTap(el);
		},
	};
}
