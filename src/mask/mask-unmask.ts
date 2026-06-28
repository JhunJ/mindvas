import type { App, Editor } from "obsidian";
import { Notice, TFile } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { normalizeMaskSyntax, setNodeMaskColor } from "./mask-core";

const MASK_RE = /\[mv\|(yellow|red|blue|green)\]([\s\S]*?)\[\/mv\]/g;

export type ParsedMaskKey =
	| { kind: "note"; path: string; index: number }
	| { kind: "canvas-whole"; canvasPath: string; nodeId: string }
	| { kind: "canvas-inline"; canvasPath: string; nodeId: string; index: number }
	| { kind: "canvas-node-inline"; nodeId: string; index: number };

export function parseMaskKey(key: string): ParsedMaskKey | null {
	if (key.startsWith("note::")) {
		const rest = key.slice(6);
		const lastSep = rest.lastIndexOf("::");
		if (lastSep < 0) return null;
		const index = Number.parseInt(rest.slice(lastSep + 2), 10);
		if (Number.isNaN(index)) return null;
		return { kind: "note", path: rest.slice(0, lastSep), index };
	}

	if (key.startsWith("canvas-node:")) {
		const rest = key.slice(12);
		const lastSep = rest.lastIndexOf("::");
		if (lastSep < 0) return null;
		const index = Number.parseInt(rest.slice(lastSep + 2), 10);
		if (Number.isNaN(index)) return null;
		return { kind: "canvas-node-inline", nodeId: rest.slice(0, lastSep), index };
	}

	const lastSep = key.lastIndexOf("::");
	if (lastSep < 0) return null;
	const tail = key.slice(lastSep + 2);
	const before = key.slice(0, lastSep);

	if (/^\d+$/.test(tail)) {
		const index = Number.parseInt(tail, 10);
		const sep2 = before.lastIndexOf("::");
		if (sep2 < 0) return null;
		return {
			kind: "canvas-inline",
			canvasPath: before.slice(0, sep2),
			nodeId: before.slice(sep2 + 2),
			index,
		};
	}

	return { kind: "canvas-whole", canvasPath: before, nodeId: tail };
}

export function unwrapMaskAtIndex(text: string, maskIndex: number): string | null {
	const normalized = normalizeMaskSyntax(text);
	let idx = 0;
	let changed = false;
	const result = normalized.replace(MASK_RE, (full, _color: string, content: string) => {
		if (idx++ === maskIndex) {
			changed = true;
			return content;
		}
		return full;
	});
	return changed ? result : null;
}

function findMasksInRange(
	text: string,
	rangeStart: number,
	rangeEnd: number
): { start: number; end: number; content: string }[] {
	const normalized = normalizeMaskSyntax(text);
	const hits: { start: number; end: number; content: string }[] = [];
	let match: RegExpExecArray | null;
	const re = new RegExp(MASK_RE.source, "g");
	while ((match = re.exec(normalized)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		if (start < rangeEnd && end > rangeStart) {
			hits.push({ start, end, content: match[2] });
		}
	}
	return hits;
}

export function editorOverlapsMask(editor: Editor): boolean {
	const doc = editor.getValue();
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	const start = Math.min(from, to);
	const end = Math.max(from, to);
	const probe = start === end ? start : start;
	const rangeEnd = start === end ? start + 1 : end;
	return findMasksInRange(doc, probe, rangeEnd).length > 0
		|| (editor.getSelection().length > 0 && /\[mv\||\[\[mv:/.test(editor.getSelection()));
}

/** Remove [mv|…] tags from the current selection or mask under the cursor. */
export function unwrapMaskInEditor(editor: Editor): boolean {
	const sel = editor.getSelection();
	if (sel && (sel.includes("[mv|") || sel.includes("[[mv:"))) {
		const stripped = normalizeMaskSyntax(sel).replace(MASK_RE, "$2");
		if (stripped !== sel) {
			editor.replaceSelection(stripped);
			return true;
		}
	}

	const doc = editor.getValue();
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	let start = Math.min(from, to);
	let end = Math.max(from, to);
	if (start === end) {
		const hits = findMasksInRange(doc, start, start + 1);
		if (hits.length === 0) return false;
		start = hits[0].start;
		end = hits[0].end;
	}

	const hits = findMasksInRange(doc, start, end);
	if (hits.length === 0) return false;

	for (const hit of hits.sort((a, b) => b.start - a.start)) {
		editor.replaceRange(
			hit.content,
			editor.offsetToPos(hit.start),
			editor.offsetToPos(hit.end)
		);
	}
	return true;
}

function resolveFilePathFromCanvasNode(canvas: Canvas, nodeId: string): string | null {
	const node = canvas.nodes.get(nodeId);
	if (!node) return null;
	if (typeof node.file === "string" && node.file.trim()) return node.file;
	if (node.file && typeof node.file === "object") {
		const fileObj = node.file as { path?: string; file?: string };
		const path = fileObj.path ?? fileObj.file;
		if (typeof path === "string" && path.trim()) return path;
	}
	const data = canvas.getData().nodes.find((n) => n.id === nodeId);
	return typeof data?.file === "string" && data.file.trim() ? data.file : null;
}

export async function unmaskByKey(
	app: App,
	key: string,
	canvas: Canvas | null,
	onCanvasRefresh?: () => void
): Promise<boolean> {
	const parsed = parseMaskKey(key);
	if (!parsed) return false;

	if (parsed.kind === "note") {
		const file = app.vault.getAbstractFileByPath(parsed.path);
		if (!(file instanceof TFile)) return false;
		const content = await app.vault.read(file);
		const next = unwrapMaskAtIndex(content, parsed.index);
		if (!next) return false;
		await app.vault.modify(file, next);
		new Notice("가리기 해제");
		onCanvasRefresh?.();
		return true;
	}

	if (!canvas) return false;

	if (parsed.kind === "canvas-whole") {
		setNodeMaskColor(canvas, parsed.nodeId, null);
		canvas.requestSave();
		new Notice("가리기 해제");
		onCanvasRefresh?.();
		return true;
	}

	if (parsed.kind === "canvas-inline") {
		const node = canvas.nodes.get(parsed.nodeId);
		if (!node?.text) return false;
		const next = unwrapMaskAtIndex(node.text, parsed.index);
		if (!next) return false;
		node.setText(next);
		canvas.requestSave();
		new Notice("가리기 해제");
		onCanvasRefresh?.();
		return true;
	}

	// canvas-node:nodeId::index — file card without cached path in key
	const filePath = resolveFilePathFromCanvasNode(canvas, parsed.nodeId);
	if (filePath) {
		const file = app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const content = await app.vault.read(file);
			const next = unwrapMaskAtIndex(content, parsed.index);
			if (!next) return false;
			await app.vault.modify(file, next);
			new Notice("가리기 해제");
			onCanvasRefresh?.();
			return true;
		}
	}

	return false;
}
