import type { Canvas, CanvasNode } from "../types/canvas-internal";
import type { CanvasAPI } from "../canvas/canvas-api";
import { findNodeFromEvent } from "../canvas/canvas-api";

const lastSelectedId = new WeakMap<Canvas, string>();

export function rememberMaskSelection(canvas: Canvas, node: CanvasNode | null): void {
	if (node?.id) lastSelectedId.set(canvas, node.id);
}

import { isMaskableCanvasNode } from "./mask-canvas-node";

function isMaskableNode(node: CanvasNode): boolean {
	return isMaskableCanvasNode(node);
}

/** Sync from canvas.selection (supports multi-select — uses first maskable node). */
function syncSelectionFromSet(canvas: Canvas): void {
	for (const item of canvas.selection) {
		if ("nodeEl" in item) {
			const node = item as CanvasNode;
			if (isMaskableNode(node)) {
				rememberMaskSelection(canvas, node);
				return;
			}
		}
	}
}

/** Obsidian marks selected cards in the DOM — works with card-note / advanced-canvas. */
function syncSelectionFromDom(canvas: Canvas): void {
	const selectors = [
		".canvas-node.is-selected",
		".canvas-node.is-focused",
		".canvas-node:focus-within",
	];
	for (const sel of selectors) {
		const el = canvas.wrapperEl.querySelector(sel) as HTMLElement | null;
		if (!el) continue;
		for (const node of canvas.nodes.values()) {
			if (node.nodeEl === el || node.nodeEl?.contains(el)) {
				rememberMaskSelection(canvas, node);
				return;
			}
		}
	}
}

export function resolveMaskTargetNode(canvas: Canvas, api: CanvasAPI): CanvasNode | null {
	syncSelectionFromSet(canvas);
	syncSelectionFromDom(canvas);

	const selected = api.getSelectedNode(canvas);
	if (selected && isMaskableNode(selected)) return selected;

	const id = lastSelectedId.get(canvas);
	if (!id) return null;
	const node = canvas.nodes.get(id);
	return node && isMaskableNode(node) ? node : null;
}

export function stashMaskTargetNode(canvas: Canvas, api: CanvasAPI): CanvasNode | null {
	const node = resolveMaskTargetNode(canvas, api);
	if (node) rememberMaskSelection(canvas, node);
	return node;
}

/** Remember selection so toolbar clicks still work after deselect. */
export function trackCanvasSelection(canvas: Canvas): () => void {
	syncSelectionFromSet(canvas);

	const onPointerDown = (e: PointerEvent) => {
		const node = findNodeFromEvent(canvas, e);
		if (node) rememberMaskSelection(canvas, node);
	};

	const onPointerUp = () => {
		syncSelectionFromSet(canvas);
		syncSelectionFromDom(canvas);
	};

	canvas.wrapperEl.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
	canvas.wrapperEl.addEventListener("pointerup", onPointerUp, { passive: true });

	return () => {
		canvas.wrapperEl.removeEventListener("pointerdown", onPointerDown, true);
		canvas.wrapperEl.removeEventListener("pointerup", onPointerUp);
		lastSelectedId.delete(canvas);
	};
}

/** Global: remember last canvas card before toolbar / menu clicks. */
export function registerGlobalCanvasSelectionTracking(
	getCanvas: () => Canvas | null
): () => void {
	const onPointerDown = (e: PointerEvent) => {
		const canvas = getCanvas();
		if (!canvas) return;
		const target = e.target as HTMLElement;
		if (target.closest(".canvas-controls, .view-actions")) return;
		const node = findNodeFromEvent(canvas, e);
		if (node) rememberMaskSelection(canvas, node);
	};

	document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
	return () => document.removeEventListener("pointerdown", onPointerDown, true);
}
