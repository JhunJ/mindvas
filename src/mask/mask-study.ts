import type { Canvas } from "../types/canvas-internal";
import {
	getNodeMaskColor,
	hasInlineMasks,
	maskItemKey,
	parseInlineMasks,
	setNodeMaskColor,
} from "./mask-core";
import { coverAll, isRevealed, revealAllKeys, toggleRevealed } from "./mask-reveal";
import { isMaskableCanvasNode } from "./mask-canvas-node";

export function isNodeMasked(canvas: Canvas, nodeId: string): boolean {
	return getNodeMaskColor(canvas, nodeId) !== null;
}

import { getLastMaskColor } from "./mask-colors";
import type { MaskColor } from "./mask-core";

export function toggleNodeMask(
	canvas: Canvas,
	nodeId: string,
	color: MaskColor = getLastMaskColor()
): boolean {
	if (isNodeMasked(canvas, nodeId)) {
		setNodeMaskColor(canvas, nodeId, null);
		return false;
	}
	setNodeMaskColor(canvas, nodeId, color);
	coverAll();
	return true;
}

export function countAllMasks(canvas: Canvas, canvasPath: string): number {
	let n = 0;
	for (const node of canvas.nodes.values()) {
		if (!isMaskableCanvasNode(node)) continue;
		if (isNodeMasked(canvas, node.id)) n++;
		if (node.text && hasInlineMasks(node.text)) {
			n += parseInlineMasks(node.text).filter((s) => s.type === "mask").length;
		}
	}
	return n;
}

export function collectAllMaskKeys(canvas: Canvas, canvasPath: string): string[] {
	const keys: string[] = [];
	for (const node of canvas.nodes.values()) {
		if (!isMaskableCanvasNode(node)) continue;
		if (isNodeMasked(canvas, node.id)) {
			keys.push(maskItemKey(canvasPath, node.id));
		}
		if (node.text && hasInlineMasks(node.text)) {
			for (const seg of parseInlineMasks(node.text)) {
				if (seg.type === "mask" && seg.index !== undefined) {
					keys.push(maskItemKey(canvasPath, node.id, seg.index));
				}
			}
		}
	}
	return keys;
}

export function coverAllMasks(_canvas?: Canvas): void {
	coverAll();
}

export function revealAllMasks(canvas: Canvas, canvasPath: string): void {
	revealAllKeys(collectAllMaskKeys(canvas, canvasPath));
}

export { isRevealed, toggleRevealed, setRevealed, coverAll } from "./mask-reveal";
