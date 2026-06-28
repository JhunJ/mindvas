import type { Plugin } from "obsidian";
import { toggleRevealed } from "./mask-reveal";

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
	plugin.registerDomEvent(
		document,
		"pointerup",
		(e) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			if (target.closest(".mindvas-inline-mask-wrap")) return;

			const tape = target.closest<HTMLElement>(".mindvas-mask-tape");
			if (!tape) return;

			const key = tape.dataset.mindvasKey;
			if (!key) return;

			e.preventDefault();
			e.stopPropagation();
			toggleRevealed(key);
			refreshCanvasMasks?.();
		},
		{ capture: true }
	);
}
