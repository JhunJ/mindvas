import type { Plugin } from "obsidian";
import { TFile } from "obsidian";
import {
	noteMaskItemKey,
	wrapInlineMask,
	hasInlineMasks,
	parseInlineMasks,
	countInlineMasks,
	getNodeMaskColor,
	type MaskColor,
} from "./mask-core";
import {
	processMaskTagsInContainer,
	refreshExistingMaskWraps,
	stripAllMaskWraps,
} from "./mask-dom";
import { applyMasksFromSource, cleanupMaskTagRemnants } from "./mask-source";
import { editorOverlapsMask, unwrapMaskInEditor } from "./mask-unmask";
import { addUnmaskMenuItem } from "./mask-colors";
import { addMaskSubmenu } from "./mask-picker";
import { refreshAllCanvasMasks } from "./mask-canvas";
import { isMindvasEnabled } from "../plugin-enabled";
import {
	findCanvasNodeForEditor,
	applyMaskInCanvasEditor,
	unwrapMaskInCanvasEditor,
} from "./mask-canvas-editor";
import type { Canvas } from "../types/canvas-internal";

const MASK_BADGE: Record<MaskColor, string> = {
	yellow: "복",
	red: "어",
	blue: "용",
	green: "숙",
};

export function registerNoteMaskSupport(plugin: Plugin): void {
	plugin.registerMarkdownPostProcessor(
		(el, ctx) => {
			if (!isMindvasEnabled()) return;
			const path = ctx.sourcePath;
			const file = plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			// Canvas cards use registerCanvasMarkdownMaskProcessor (per-node source).
			if (path.endsWith(".canvas")) return;

			void plugin.app.vault.read(file).then((source) => {
				if (!hasInlineMasks(source)) {
					stripAllMaskWraps(el);
					cleanupMaskTagRemnants(el);
					return;
				}

				const keyFor = (i: number) => noteMaskItemKey(path, i);
				const expected = countInlineMasks(source);

				if (refreshExistingMaskWraps(el, source, keyFor)) return;

				const segments = parseInlineMasks(source);
				const applied = applyMasksFromSource(el, source, segments, keyFor);
				if (applied === 0) {
					processMaskTagsInContainer(el, keyFor);
				}
				if (el.querySelectorAll(".mindvas-inline-mask-wrap").length < expected) {
					window.setTimeout(() => {
						if (refreshExistingMaskWraps(el, source, keyFor)) return;
						stripAllMaskWraps(el);
						applyMasksFromSource(el, source, segments, keyFor);
					}, 200);
				}
			});
		},
		-100
	);

	let noteModifyTimer: ReturnType<typeof setTimeout> | null = null;
	plugin.registerEvent(
		plugin.app.vault.on("modify", (file) => {
			if (!isMindvasEnabled()) return;
			if (!(file instanceof TFile) || file.extension !== "md") return;
			if (noteModifyTimer) clearTimeout(noteModifyTimer);
			noteModifyTimer = setTimeout(() => refreshAllCanvasMasks(plugin.app), 120);
		})
	);

	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
			if (!isMindvasEnabled()) return;
			const canvasNode = findCanvasNodeForEditor(plugin.app, editor);
			const hasNoteFile = Boolean(view?.file);

			const hasUnmask = editorOverlapsMask(editor);
			const sel = editor.getSelection();
			const canMask = Boolean(sel && !/\[mv\||\[\[mv:/.test(sel));

			if (!hasUnmask && !canMask) return;
			if (!hasNoteFile && !canvasNode) return;

			menu.addSeparator();

			if (hasUnmask) {
				addUnmaskMenuItem(menu, () => {
					unwrapMaskInEditor(editor);
					if (canvasNode) unwrapMaskInCanvasEditor(plugin.app, editor, canvasNode);
				});
			}

			if (canMask) {
				if (hasUnmask) menu.addSeparator();
				addMaskSubmenu(menu, (color) => {
					if (canvasNode) {
						applyMaskInCanvasEditor(plugin.app, editor, canvasNode, color, sel);
					} else {
						editor.replaceSelection(wrapInlineMask(color, sel));
					}
				});
			}
		})
	);
}

export function getNodeMaskIndicator(canvas: Canvas, nodeId: string, text?: string): string {
	const whole = getNodeMaskColor(canvas, nodeId);
	if (whole) return `[${MASK_BADGE[whole]}]`;
	if (text && hasInlineMasks(text)) return "·";
	return "";
}
