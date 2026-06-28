import type { Menu } from "obsidian";
import { MASK_COLORS, type MaskColor } from "./mask-core";
import { setLastMaskColor } from "./mask-colors";

function colorMenuTitle(color: MaskColor, label: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const swatch = document.createElement("span");
	swatch.className = `mindvas-menu-swatch mindvas-mask-${color}`;
	const text = document.createElement("span");
	text.className = "mindvas-menu-swatch-label";
	text.textContent = label;
	frag.append(swatch, text);
	return frag;
}

/** Native Obsidian submenu — hover "마스킹" → panel opens to the right. */
export function addMaskSubmenu(
	menu: Menu,
	onPick: (color: MaskColor) => void,
	options?: { title?: string }
): void {
	const title = options?.title ?? "마스킹";

	menu.addItem((item) => {
		item.setTitle(title).setIcon("eye-off");
		const sub = item.setSubmenu();

		for (const color of Object.keys(MASK_COLORS) as MaskColor[]) {
			const meta = MASK_COLORS[color];
			sub.addItem((subItem) => {
				subItem.setTitle(colorMenuTitle(color, meta.label)).onClick(() => {
					setLastMaskColor(color);
					onPick(color);
				});
			});
		}
	});
}
