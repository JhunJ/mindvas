import { Platform, Plugin, setIcon } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { isMobileApp } from "./mobile-utils";

interface ToolbarAction {
	id: string;
	icon: string;
	label: string;
	commandId: string;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
	{ id: "edit", icon: "pencil", label: "Edit", commandId: "mindvas:mindmap-edit-node" },
	{ id: "child", icon: "plus", label: "Child", commandId: "mindvas:mindmap-add-child" },
	{ id: "sibling", icon: "corner-down-left", label: "Sibling", commandId: "mindvas:mindmap-add-sibling" },
	{ id: "fold", icon: "chevrons-down-up", label: "Fold", commandId: "mindvas:mindmap-toggle-branch-fold" },
	{ id: "nav-left", icon: "arrow-left", label: "Left", commandId: "mindvas:mindmap-nav-left" },
	{ id: "nav-up", icon: "arrow-up", label: "Up", commandId: "mindvas:mindmap-nav-prev-sibling" },
	{ id: "nav-down", icon: "arrow-down", label: "Down", commandId: "mindvas:mindmap-nav-next-sibling" },
	{ id: "nav-right", icon: "arrow-right", label: "Right", commandId: "mindvas:mindmap-nav-right" },
	{ id: "relayout", icon: "refresh-cw", label: "Layout", commandId: "mindvas:mindmap-relayout" },
	{ id: "outline", icon: "list-tree", label: "Outline", commandId: "mindvas:mindmap-open-outline" },
];

/**
 * Floating bottom toolbar for touch devices.
 * Surfaces core mindmap commands without a physical keyboard.
 */
export class MobileToolbar {
	private toolbarEl: HTMLElement | null = null;
	private fabEl: HTMLElement | null = null;
	private visible = false;

	constructor(
		private plugin: Plugin,
		private isMindmapActive: (canvas: Canvas) => boolean
	) {}

	mount(canvas: Canvas): void {
		if (!isMobileApp()) return;
		this.unmount();

		const wrapper = canvas.wrapperEl;
		if (!wrapper) return;

		const toolbar = document.createElement("div");
		toolbar.addClass("mindvas-mobile-toolbar");
		toolbar.setAttribute("role", "toolbar");
		toolbar.setAttribute("aria-label", "Mindvas actions");

		for (const action of TOOLBAR_ACTIONS) {
			const btn = document.createElement("div");
			btn.addClass("mindvas-mobile-toolbar-btn", "clickable-icon");
			btn.setAttribute("aria-label", action.label);
			btn.setAttribute("data-action", action.id);
			setIcon(btn, action.icon);
			toolbar.appendChild(btn);
			this.plugin.registerDomEvent(btn, "click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const { commands } = this.plugin.app as unknown as {
					commands: { executeCommandById: (id: string) => boolean };
				};
				commands?.executeCommandById?.(action.commandId);
			});
		}

		wrapper.appendChild(toolbar);
		this.toolbarEl = toolbar;
		this.setVisible(this.isMindmapActive(canvas));

		// FAB for mindmap mode toggle when canvas toolbar is unavailable
		if (!canvas.view.containerEl.querySelector(".canvas-controls")) {
			this.mountFab(canvas, wrapper);
		}
	}

	private mountFab(canvas: Canvas, wrapper: HTMLElement): void {
		const fab = document.createElement("button");
		fab.addClass("mindvas-mobile-fab", "clickable-icon");
		fab.setAttribute("type", "button");
		fab.setAttribute("aria-label", "Toggle mindmap mode");
		setIcon(fab, this.isMindmapActive(canvas) ? "network" : "layout-dashboard");
		fab.toggleClass("is-active", this.isMindmapActive(canvas));

		this.plugin.registerDomEvent(fab, "click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const { commands } = this.plugin.app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			};
			commands?.executeCommandById?.("mindvas:mindmap-toggle-mode");
		});

		wrapper.appendChild(fab);
		this.fabEl = fab;
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.toolbarEl?.toggleClass("is-hidden", !visible);
	}

	updateFab(canvas: Canvas): void {
		if (!this.fabEl) return;
		const active = this.isMindmapActive(canvas);
		this.fabEl.empty();
		setIcon(this.fabEl, active ? "network" : "layout-dashboard");
		this.fabEl.toggleClass("is-active", active);
		this.fabEl.setAttribute("aria-label", active ? "Mindmap mode (active)" : "Mindmap mode (inactive)");
	}

	unmount(): void {
		this.toolbarEl?.remove();
		this.toolbarEl = null;
		this.fabEl?.remove();
		this.fabEl = null;
		this.visible = false;
	}
}
