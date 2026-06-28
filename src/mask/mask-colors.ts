import type { Menu } from "obsidian";
import { MASK_COLORS, type MaskColor } from "./mask-core";

let lastMaskColor: MaskColor = "blue";

export function getLastMaskColor(): MaskColor {
	return lastMaskColor;
}

export function setLastMaskColor(color: MaskColor): void {
	lastMaskColor = color;
}

export function applyMaskColorClass(el: HTMLElement, color: MaskColor): void {
	for (const c of Object.keys(MASK_COLORS) as MaskColor[]) {
		el.classList.remove(`mindvas-mask-${c}`);
	}
	el.classList.add(`mindvas-mask-${color}`);
	el.dataset.mindvasColor = color;
}

export function addUnmaskMenuItem(menu: Menu, onClick: () => void): void {
	menu.addItem((item) => {
		item.setTitle("가리기 해제").setIcon("eye").onClick(onClick);
	});
}
