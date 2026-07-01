import { Menu, Notice } from "obsidian";
import type { Plugin } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { unmaskByKey } from "./mask-unmask";
import { addUnmaskMenuItem } from "./mask-colors";
import { isMindvasEnabled } from "../plugin-enabled";

type CanvasGetter = () => Canvas | null;
type RefreshFn = () => void;

function findMaskContextTarget(target: EventTarget | null): HTMLElement | null {
	const el = target as HTMLElement | null;
	if (!el) return null;
	if (el.closest(".cm-editor")) return null;
	return el.closest<HTMLElement>(
		"[data-mindvas-key], .mindvas-inline-mask-wrap, .mindvas-inline-tape, .mindvas-inline-revealed, .mindvas-mask-tape"
	);
}

function resolveKeyFromTarget(el: HTMLElement): string | null {
	if (el.dataset.mindvasKey) return el.dataset.mindvasKey;
	const wrap = el.closest<HTMLElement>("[data-mindvas-key]");
	return wrap?.dataset.mindvasKey ?? null;
}

/** Right-click on masked UI → 가리기 해제 (mirror of editor wrap menu). */
export function registerMaskContextMenu(
	plugin: Plugin,
	getCanvas: CanvasGetter,
	onRefresh: RefreshFn
): void {
	plugin.registerDomEvent(
		document,
		"contextmenu",
		(evt) => {
			if (!isMindvasEnabled()) return;
			const target = findMaskContextTarget(evt.target);
			if (!target) return;

			const key = resolveKeyFromTarget(target);
			if (!key) return;

			evt.preventDefault();
			evt.stopPropagation();

			const menu = new Menu();
			addUnmaskMenuItem(menu, () => {
				void unmaskByKey(plugin.app, key, getCanvas(), onRefresh).then((ok) => {
					if (!ok) new Notice("가리기 해제할 수 없습니다");
				});
			});
			menu.showAtMouseEvent(evt);
		},
		{ capture: true }
	);
}
