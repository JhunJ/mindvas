import type { CanvasNode } from "../types/canvas-internal";

/**
 * Get CodeMirror editor elements from a canvas node's iframe.
 * Used by manual resize to measure content height via .cm-content.
 */
export function getEditorElements(node: CanvasNode): {
	iframe: HTMLIFrameElement | null;
	scroller: HTMLElement | null;
	cmContent: HTMLElement | null;
} {
	const iframe = node.contentEl?.querySelector<HTMLIFrameElement>("iframe");
	if (!iframe?.contentDocument) return { iframe: null, scroller: null, cmContent: null };

	const scroller = iframe.contentDocument.querySelector<HTMLElement>(".cm-scroller");
	const cmContent = iframe.contentDocument.querySelector<HTMLElement>(".cm-content");
	return { iframe, scroller, cmContent };
}
