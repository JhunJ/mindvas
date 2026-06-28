import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { wrapCanvasSelection } from "./mask-canvas";
import { refreshCanvasMaskUI, toggleNodeMask } from "./mask-canvas";
import { coverAll } from "./mask-reveal";
import { getLastMaskColor, setLastMaskColor } from "./mask-colors";
import type { MaskColor } from "./mask-core";
import { isMaskableCanvasNode } from "./mask-canvas-node";

export function applyMaskToNode(
	canvas: Canvas,
	node: CanvasNode,
	canvasPath: string,
	app: App,
	color: MaskColor = getLastMaskColor()
): boolean {
	if (!isMaskableCanvasNode(node)) {
		new Notice("텍스트/노트 카드만 가릴 수 있습니다");
		return false;
	}

	setLastMaskColor(color);

	if (node.isEditing) {
		if (wrapCanvasSelection(node, color)) {
			node.blur();
			canvas.requestSave();
			refreshCanvasMaskUI(canvas, canvasPath, app);
			canvas.requestFrame();
			new Notice("선택한 글 가림");
			return true;
		}
		new Notice("가릴 글자를 선택하세요");
		return false;
	}

	const masked = toggleNodeMask(canvas, node.id, color);
	canvas.requestSave();
	coverAll();
	refreshCanvasMaskUI(canvas, canvasPath, app);
	canvas.requestFrame();
	new Notice(masked ? "가림" : "가림 해제");
	return true;
}
