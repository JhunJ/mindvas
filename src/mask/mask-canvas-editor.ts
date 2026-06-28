import type { App, Editor } from "obsidian";
import { TFile } from "obsidian";
import type { CanvasNode } from "../types/canvas-internal";
import { normalizeMaskSyntax, wrapInlineMask, type MaskColor } from "./mask-core";
import { refreshAllCanvasMasks } from "./mask-canvas";
import { resolveCanvasFilePath, persistCanvasFileNodeContent } from "./mask-canvas";

function getEditorDom(editor: Editor): HTMLElement | null {
	const cm = editor as unknown as {
		cm?: { dom?: HTMLElement; cm?: { dom?: HTMLElement } };
	};
	return cm.cm?.cm?.dom ?? cm.cm?.dom ?? null;
}

function findCanvasNodeFromDom(app: App, el: HTMLElement | null): CanvasNode | null {
	if (!el) return null;

	let nodeEl = el.closest(".canvas-node");
	if (!nodeEl) {
		const frame = el.ownerDocument?.defaultView?.frameElement as HTMLIFrameElement | undefined;
		nodeEl = frame?.closest(".canvas-node") ?? null;
	}
	if (!nodeEl) return null;

	for (const leaf of app.workspace.getLeavesOfType("canvas")) {
		const canvas = (leaf.view as { canvas?: { nodes: Map<string, CanvasNode> } }).canvas;
		if (!canvas) continue;
		for (const node of canvas.nodes.values()) {
			if (node.nodeEl === nodeEl) return node;
		}
	}
	return null;
}

/** Editor inside a canvas card (text or file node). */
export function findCanvasNodeForEditor(app: App, editor: Editor): CanvasNode | null {
	return findCanvasNodeFromDom(app, getEditorDom(editor));
}

export function applyMaskInCanvasEditor(
	app: App,
	editor: Editor,
	canvasNode: CanvasNode | null,
	color: MaskColor,
	selection: string
): void {
	editor.replaceSelection(wrapInlineMask(color, selection));
	if (!canvasNode) return;

	const next = normalizeMaskSyntax(editor.getValue());
	if (canvasNode.type === "file") {
		void persistCanvasFileNodeContent(app, canvasNode, next);
	} else {
		canvasNode.setText(next);
	}
	canvasNode.canvas.requestSave();
	refreshAllCanvasMasks(app);
}

export function unwrapMaskInCanvasEditor(app: App, editor: Editor, canvasNode: CanvasNode | null): void {
	if (!canvasNode) return;
	const next = normalizeMaskSyntax(editor.getValue());
	if (canvasNode.type === "file") {
		void persistCanvasFileNodeContent(app, canvasNode, next);
	} else {
		canvasNode.setText(next);
	}
	canvasNode.canvas.requestSave();
	refreshAllCanvasMasks(app);
}
