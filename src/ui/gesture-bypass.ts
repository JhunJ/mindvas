/**
 * Targets where Mindvas must not track gestures or rewrite DOM — Obsidian owns
 * tap-to-expand / tap-to-dismiss for canvas images and media popovers.
 */

import { isMindvasEnabled } from "../plugin-enabled";

export function shouldBypassMindvasGesture(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.closest(".popover, .modal, .menu, .prompt, .suggestion-container")) return true;
	const inCanvas = target.closest(".canvas-wrapper");
	if (!inCanvas) return false;
	return !!target.closest(
		"img, .image-embed, .image-embed-image, .canvas-node-image, video, audio, .pdf-embed, .canvas-node-content img"
	);
}

/** Obsidian CSS fullscreen pattern: .image-embed:active { position: fixed; z-index: 200 } */
export function findExpandedCanvasImageEmbed(): HTMLElement | null {
	const wrapper = document.querySelector(".canvas-wrapper");
	if (!wrapper) return null;
	for (const el of Array.from(wrapper.querySelectorAll<HTMLElement>(".image-embed"))) {
		const style = getComputedStyle(el);
		if (style.position === "fixed" || Number(style.zIndex) >= 200) return el;
	}
	return null;
}

/** Blur / defocus so :active fullscreen image embeds dismiss on mobile. */
export function dismissExpandedCanvasImage(): boolean {
	const expanded = findExpandedCanvasImageEmbed();
	if (!expanded) return false;
	(document.activeElement as HTMLElement | null)?.blur();
	expanded.blur();
	const wrapper = expanded.closest(".canvas-wrapper") as HTMLElement | null;
	wrapper?.focus({ preventScroll: true });
	return true;
}

/** Tap-to-dismiss when Obsidian's native :active toggle gets stuck (2nd+ open). */
export function registerMobileCanvasImageDismiss(plugin: import("obsidian").Plugin): void {
	plugin.registerDomEvent(
		document,
		"pointerup",
		(e) => {
			if (!isMindvasEnabled()) return;
			const expanded = findExpandedCanvasImageEmbed();
			if (!expanded) return;
			const target = e.target as HTMLElement;
			if (!target.closest(".canvas-wrapper")) return;
			// Tap on the expanded image, or the canvas backdrop while it is open.
			const onExpanded =
				target.closest(".image-embed") === expanded ||
				expanded.contains(target) ||
				target.tagName === "IMG";
			const onBackdrop =
				target.classList.contains("canvas-wrapper") ||
				target.closest(".canvas-node") === null;
			if (!onExpanded && !onBackdrop) return;
			requestAnimationFrame(() => {
				if (findExpandedCanvasImageEmbed()) dismissExpandedCanvasImage();
			});
		},
		{ passive: true }
	);
}
