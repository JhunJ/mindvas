import type { Plugin } from "obsidian";
import { toggleRevealed } from "./mask-reveal";
import { isMobileApp } from "../ui/mobile-utils";
import { shouldBypassMindvasGesture } from "../ui/gesture-bypass";

type MaskRefreshFn = () => void;

let refreshCanvasMasks: MaskRefreshFn | null = null;

export function setMaskCanvasRefresh(fn: MaskRefreshFn | null): void {
	refreshCanvasMasks = fn;
}

export function getMaskCanvasRefresh(): MaskRefreshFn | null {
	return refreshCanvasMasks;
}

/** Whole-card tape toggle (inline tapes use per-wrap pointerup handlers). */
export function registerMaskClickDelegation(plugin: Plugin): void {
	const mobile = isMobileApp();

	// On touch a whole-card tape covers the card, so we must tell a tap (toggle
	// reveal) apart from a drag (move the card). pointerdown/move are passive and
	// never stop propagation, so the canvas still receives them and drags/box-
	// selects the card; only a stationary tap toggles the mask on pointerup.
	let downTape: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let moved = false;
	const DRAG_SLOP = 8;

	if (mobile) {
		plugin.registerDomEvent(
			document,
			"pointerdown",
			(e) => {
				if (shouldBypassMindvasGesture(e.target)) return;
				const target = e.target as HTMLElement | null;
				downTape = target?.closest<HTMLElement>(".mindvas-mask-tape") ?? null;
				if (downTape && target?.closest(".mindvas-inline-mask-wrap")) downTape = null;
				startX = e.clientX;
				startY = e.clientY;
				moved = false;
			},
			{ capture: true, passive: true }
		);
		plugin.registerDomEvent(
			document,
			"pointermove",
			(e) => {
				if (!downTape) return;
				if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_SLOP) moved = true;
			},
			{ capture: true, passive: true }
		);
	}

	plugin.registerDomEvent(
		document,
		"pointerup",
		(e) => {
			if (shouldBypassMindvasGesture(e.target)) return;
			const target = e.target as HTMLElement | null;
			if (!target) {
				downTape = null;
				return;
			}
			if (target.closest(".mindvas-inline-mask-wrap")) {
				downTape = null;
				return;
			}

			const tape = target.closest<HTMLElement>(".mindvas-mask-tape");
			if (!tape) {
				downTape = null;
				return;
			}

			// A drag on the tape (card move) must not toggle the mask.
			if (mobile && moved) {
				downTape = null;
				return;
			}

			const key = tape.dataset.mindvasKey;
			if (!key) return;

			e.preventDefault();
			e.stopPropagation();
			toggleRevealed(key);
			refreshCanvasMasks?.();
			downTape = null;
		},
		{ capture: true }
	);
}
