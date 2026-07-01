import type { Canvas, CanvasNode, CMContentElement, CMEditorView } from "../types/canvas-internal";
import { isMobileApp } from "../ui/mobile-utils";

export const MASK_DATA_KEY = "mindvasMask";
export const MASK_STATS_KEY = "mindvasMaskStats";

export const MASK_COLORS = {
	yellow: { label: "복습", icon: "highlighter" },
	red: { label: "어려움", icon: "alert-circle" },
	blue: { label: "용어", icon: "bookmark" },
	green: { label: "숙지", icon: "check-circle" },
} as const;

export type MaskColor = keyof typeof MASK_COLORS;

export const DEFAULT_MASK_COLOR: MaskColor = "blue";

export const MASK_CYCLE: (MaskColor | null)[] = [null, "yellow", "red", "blue", "green"];

/** New syntax — single brackets, no Obsidian [[wikilink]] clash */
export const INLINE_MASK_RE = /\[mv\|(yellow|red|blue|green)\]([\s\S]*?)\[\/mv\]/g;

/** Old syntax (still parsed for migration) */
export const LEGACY_INLINE_MASK_RE = /\[\[mv:(yellow|red|blue|green)\]\]([\s\S]*?)\[\[\/mv\]\]/g;

export function wrapInlineMask(color: MaskColor, text: string): string {
	return `[mv|${color}]${text}[/mv]`;
}

/** Convert legacy [[mv:…]] tags to [mv|…] */
export function normalizeMaskSyntax(text: string): string {
	return text.replace(LEGACY_INLINE_MASK_RE, (_, color: MaskColor, content: string) =>
		wrapInlineMask(color, content)
	);
}

export function stripInlineMaskMarkers(text: string): string {
	return normalizeMaskSyntax(text).replace(INLINE_MASK_RE, "$2");
}

export function hasInlineMasks(text: string): boolean {
	INLINE_MASK_RE.lastIndex = 0;
	LEGACY_INLINE_MASK_RE.lastIndex = 0;
	return INLINE_MASK_RE.test(text) || LEGACY_INLINE_MASK_RE.test(text);
}

export interface InlineMaskSegment {
	type: "text" | "mask";
	content: string;
	color?: MaskColor;
	index?: number;
}

export function parseInlineMasks(text: string): InlineMaskSegment[] {
	const normalized = normalizeMaskSyntax(text);
	const segments: InlineMaskSegment[] = [];
	let lastIndex = 0;
	let maskIndex = 0;
	const re = /\[mv\|(yellow|red|blue|green)\]([\s\S]*?)\[\/mv\]/g;
	let match: RegExpExecArray | null;

	while ((match = re.exec(normalized)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", content: normalized.slice(lastIndex, match.index) });
		}
		segments.push({
			type: "mask",
			color: match[1] as MaskColor,
			content: match[2],
			index: maskIndex++,
		});
		lastIndex = re.lastIndex;
	}

	if (lastIndex < normalized.length) {
		segments.push({ type: "text", content: normalized.slice(lastIndex) });
	}

	return segments;
}

export function countInlineMasks(text: string): number {
	return parseInlineMasks(text).filter((s) => s.type === "mask").length;
}

export function maskItemKey(
	canvasPath: string,
	nodeId: string,
	inlineIndex?: number
): string {
	return inlineIndex === undefined
		? `${canvasPath}::${nodeId}`
		: `${canvasPath}::${nodeId}::${inlineIndex}`;
}

export function noteMaskItemKey(notePath: string, inlineIndex: number): string {
	return `note::${notePath}::${inlineIndex}`;
}

export const TAP_THRESHOLD_PX = 8;

export function getCanvasNodeEditorView(node: CanvasNode): CMEditorView | null {
	const iframe = node.contentEl?.querySelector<HTMLIFrameElement>("iframe");
	const container = iframe?.contentDocument ?? node.contentEl?.ownerDocument;
	if (!container) return null;
	const root = iframe?.contentDocument ?? node.contentEl;
	const cmContent = root?.querySelector<CMContentElement>(".cm-content");
	return cmContent?.cmView?.view ?? null;
}

function readEditorFullText(view: CMEditorView): string {
	const doc = view.state.doc as { length: number; toString(): string } | undefined;
	if (doc && typeof doc.toString === "function") return doc.toString();
	return view.state.sliceDoc(0, 1_000_000);
}

export function wrapCanvasSelection(node: CanvasNode, color: MaskColor): boolean {
	const view = getCanvasNodeEditorView(node);
	if (!view) return false;
	const { from, to } = view.state.selection.main;
	if (from === to) return false;
	const text = view.state.sliceDoc(from, to);
	view.dispatch({
		changes: { from, to, insert: wrapInlineMask(color, text) },
	});
	node.setText(normalizeMaskSyntax(readEditorFullText(view)));
	return true;
}

/** Stop canvas drag / selection from swallowing tape taps. Clicks use delegation + local handlers. */
export function attachTapeToggle(el: HTMLElement, onToggle?: () => void): void {
	el.classList.add("mindvas-mask-ui");
	if (!isMobileApp()) {
		el.addEventListener("pointerdown", (e) => {
			e.stopPropagation();
		});
	}
	if (onToggle) {
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			e.preventDefault();
			onToggle();
		});
	}
}

export function getNodeMaskColor(canvas: Canvas, nodeId: string): MaskColor | null {
	const runtime = canvas.nodes.get(nodeId);
	const fromRuntime = runtime?.unknownData?.[MASK_DATA_KEY];
	if (typeof fromRuntime === "string" && fromRuntime in MASK_COLORS) {
		return fromRuntime as MaskColor;
	}

	const data = canvas.getData().nodes.find((n) => n.id === nodeId);
	const raw = data?.[MASK_DATA_KEY];
	return raw && typeof raw === "string" && raw in MASK_COLORS ? (raw as MaskColor) : null;
}

export function setNodeMaskColor(
	canvas: Canvas,
	nodeId: string,
	color: MaskColor | null
): void {
	const data = canvas.getData();
	const nodeData = data.nodes.find((n) => n.id === nodeId);
	if (!nodeData) return;

	if (color) nodeData[MASK_DATA_KEY] = color;
	else delete nodeData[MASK_DATA_KEY];

	const runtime = canvas.nodes.get(nodeId);
	if (runtime) {
		if (!runtime.unknownData) runtime.unknownData = {};
		if (color) runtime.unknownData[MASK_DATA_KEY] = color;
		else delete runtime.unknownData[MASK_DATA_KEY];
	}

	canvas.setData(data);
}

/** Obsidian may replace node.nodeEl after a drag/rerender — always query the live
 * connected element so mask DOM edits land on the card the user actually sees. */
export function resolveLiveNodeEl(node: CanvasNode): HTMLElement | null {
	if (node.nodeEl?.isConnected) return node.nodeEl;
	const wrapper = node.canvas?.wrapperEl;
	if (!wrapper) return null;
	for (const el of Array.from(wrapper.querySelectorAll<HTMLElement>(".canvas-node"))) {
		if (el.dataset.id === node.id || el.dataset.nodeId === node.id) return el;
	}
	return null;
}

export function getMaskOverlayHost(node: CanvasNode): HTMLElement | null {
	const root = resolveLiveNodeEl(node);
	if (!root) return null;
	return (
		root.querySelector<HTMLElement>(".canvas-node-container") ??
		root.querySelector<HTMLElement>(".canvas-node-content") ??
		(node.contentEl?.isConnected ? node.contentEl : null) ??
		root
	);
}
