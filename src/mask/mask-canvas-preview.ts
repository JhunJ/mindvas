import type { App, Plugin } from "obsidian";
import { TFile } from "obsidian";
import type { CanvasNode } from "../types/canvas-internal";
import {
	hasInlineMasks,
	parseInlineMasks,
	countInlineMasks,
	normalizeMaskSyntax,
	noteMaskItemKey,
	maskItemKey,
} from "./mask-core";
import {
	processMaskTagsInContainer,
	refreshExistingMaskWraps,
	stripAllMaskWraps,
} from "./mask-dom";
import { applyMasksFromSource, cleanupMaskTagRemnants } from "./mask-source";
import { getMaskCanvasRefresh } from "./mask-clicks";
import { isTextCardReadMode, syncTextCardReadMask, clearTextCardOverlay } from "./mask-canvas-text";
import { isTextCanvasNode, isFileCanvasNode, isMaskableCanvasNode } from "./mask-canvas-node";

function resolveCanvasFilePath(node: CanvasNode): string | null {
	const runtimeFile = node.file;
	if (typeof runtimeFile === "string" && runtimeFile.trim()) return runtimeFile;
	if (runtimeFile && typeof runtimeFile === "object") {
		const fileObj = runtimeFile as { path?: string; file?: string };
		const path = fileObj.path ?? fileObj.file;
		if (typeof path === "string" && path.trim()) return path;
	}
	const data = node.canvas.getData().nodes.find((n) => n.id === node.id);
	if (typeof data?.file === "string" && data.file.trim()) return data.file;
	return null;
}

function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

export function findCanvasNodeByEl(app: App, nodeEl: HTMLElement): CanvasNode | null {
	for (const leaf of app.workspace.getLeavesOfType("canvas")) {
		const canvas = (leaf.view as { canvas?: { nodes: Map<string, CanvasNode> } }).canvas;
		if (!canvas) continue;
		for (const node of canvas.nodes.values()) {
			if (node.nodeEl === nodeEl) return node;
		}
	}
	return null;
}

export function getCanvasNodeMaskSource(node: CanvasNode): string {
	const dataNode = node.canvas.getData().nodes.find((n) => n.id === node.id);
	return normalizeMaskSyntax(node.text || dataNode?.text || "");
}

function maskKeyForNode(node: CanvasNode, canvasPath: string): (index: number) => string {
	const filePath = resolveCanvasFilePath(node);
	if (filePath) return (i: number) => noteMaskItemKey(filePath, i);
	return (i: number) => maskItemKey(canvasPath, node.id, i);
}

function applyMasksToPreviewEl(
	el: HTMLElement,
	source: string,
	keyFor: (index: number) => string
): boolean {
	const expected = countInlineMasks(source);
	if (expected === 0) return false;

	if (refreshExistingMaskWraps(el, source, keyFor)) return true;

	const segments = parseInlineMasks(source);
	applyMasksFromSource(el, source, segments, keyFor);
	processMaskTagsInContainer(el, keyFor);
	cleanupMaskTagRemnants(el);

	return el.querySelectorAll(".mindvas-inline-mask-wrap").length >= expected;
}

/** Hook Obsidian markdown render inside canvas cards (read mode). */
export function registerCanvasMarkdownMaskProcessor(plugin: Plugin): void {
	plugin.registerMarkdownPostProcessor(
		(el, ctx) => {
			const nodeEl = el.closest(".canvas-node") as HTMLElement | null;
			if (!nodeEl) return;

			const node = findCanvasNodeByEl(plugin.app, nodeEl);
			if (!node || !isMaskableCanvasNode(node)) return;
			if (isTextCanvasNode(node) && !isTextCardReadMode(node)) return;
			if (isFileCanvasNode(node) && node.isEditing) return;

			const canvasPath =
				node.canvas.view?.file?.path ??
				(ctx.sourcePath.endsWith(".canvas") ? ctx.sourcePath : "");
			if (!canvasPath) return;

			const target = (
				el.closest(".markdown-preview-view") ??
				el.closest(".markdown-embed-content") ??
				el
			) as HTMLElement;

			const applyText = (source: string) => {
				if (!hasInlineMasks(source)) {
					stripAllMaskWraps(target);
					cleanupMaskTagRemnants(target);
					return;
				}
				const keyFor = maskKeyForNode(node, canvasPath);
				if (!applyMasksToPreviewEl(target, source, keyFor)) {
					window.setTimeout(() => {
						if (isTextCanvasNode(node) && !isTextCardReadMode(node)) return;
						applyMasksToPreviewEl(target, source, keyFor);
						getMaskCanvasRefresh()?.();
					}, 120);
				}
			};

			if (isFileCanvasNode(node)) {
				const path = resolveCanvasFilePath(node);
				if (path && isMarkdownPath(path)) {
					const file = plugin.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						void plugin.app.vault.read(file).then(applyText);
						return;
					}
				}
				if (path) return;
			}

			applyText(getCanvasNodeMaskSource(node));
		},
		100
	);
}

const ADVANCED_CANVAS_EVENTS = [
	"advanced-canvas:node-changed",
	"advanced-canvas:node-breakpoint-changed",
	"advanced-canvas:node-text-content-changed",
	"advanced-canvas:node-added",
	"advanced-canvas:data-loaded:after",
	"advanced-canvas:canvas-saved:after",
] as const;

/** Advanced Canvas re-renders cards often — refresh masks after its lifecycle events. */
export function registerAdvancedCanvasMaskHooks(plugin: Plugin): void {
	const ws = plugin.app.workspace as unknown as {
		on(name: string, cb: (...args: unknown[]) => void): import("obsidian").EventRef;
	};
	for (const name of ADVANCED_CANVAS_EVENTS) {
		plugin.registerEvent(
			ws.on(name, () => {
				window.setTimeout(() => {
					getMaskCanvasRefresh()?.();
				}, 50);
			})
		);
	}

	plugin.registerEvent(
		ws.on(
			"advanced-canvas:node-editing-state-changed",
			(_canvas: unknown, node: unknown, editing: unknown) => {
				const n = node as CanvasNode;
				if (!isMaskableCanvasNode(n)) return;
				const isEditing = editing === true;
				window.setTimeout(() => {
					getMaskCanvasRefresh()?.();
					if (isEditing && isTextCanvasNode(n)) {
						clearTextCardOverlay(n);
					} else if (!isEditing && isTextCanvasNode(n)) {
						const canvasPath = n.canvas.view?.file?.path ?? "";
						syncTextCardReadMask(n, canvasPath);
					}
				}, isEditing ? 0 : 80);
			}
		)
	);
}