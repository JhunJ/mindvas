import type { App } from "obsidian";
import type { Menu } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import {
	refreshCanvasMaskUI,
	wrapCanvasSelection,
	toggleNodeMask,
	isNodeMasked,
} from "./mask-canvas";
import { coverAll } from "./mask-reveal";
import { addUnmaskMenuItem } from "./mask-colors";
import { addMaskSubmenu } from "./mask-picker";

/** Canvas node right-click: mask / unmask. */
export function buildNodeMaskMenu(
	menu: Menu,
	canvas: Canvas,
	node: CanvasNode,
	canvasPath: string,
	app: App,
	onUpdate: () => void
): void {
	const masked = isNodeMasked(canvas, node.id);

	menu.addSeparator();

	if (masked) {
		addUnmaskMenuItem(menu, () => {
			toggleNodeMask(canvas, node.id);
			coverAll();
			canvas.requestSave();
			refreshCanvasMaskUI(canvas, canvasPath, app);
			canvas.requestFrame();
			onUpdate();
		});
	}

	if (node.isEditing) {
		addMaskSubmenu(menu, (color) => {
			if (wrapCanvasSelection(node, color, app)) {
				node.blur();
				canvas.requestSave();
				refreshCanvasMaskUI(canvas, canvasPath, app);
				onUpdate();
			}
		});
	} else if (!masked) {
		addMaskSubmenu(menu, (color) => {
			toggleNodeMask(canvas, node.id, color);
			coverAll();
			canvas.requestSave();
			refreshCanvasMaskUI(canvas, canvasPath, app);
			canvas.requestFrame();
			onUpdate();
		});
	}
}
