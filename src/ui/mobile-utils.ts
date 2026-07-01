import { Platform, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";

/** True on Obsidian mobile (phone or tablet). */
export function isMobileApp(): boolean {
	return Platform.isMobileApp;
}

function mobileShortSide(): number {
	const vv = window.visualViewport;
	const w = vv?.width ?? window.innerWidth ?? 0;
	const h = vv?.height ?? window.innerHeight ?? 0;
	return Math.min(w, h);
}

/** True on phone-sized mobile screens. */
export function isPhone(): boolean {
	if (!Platform.isMobileApp) return false;
	// Some Android tablets report Platform.isPhone. Prefer the actual viewport
	// size so Galaxy Tab follows the tablet/native-canvas path.
	if (mobileShortSide() >= 600) return false;
	return Platform.isPhone && !Platform.isTablet;
}

/** True on tablet-sized mobile screens (Galaxy Tab, iPad). */
export function isTablet(): boolean {
	if (!Platform.isMobileApp) return false;
	return Platform.isTablet || mobileShortSide() >= 600;
}

/** Add a body class so CSS can target touch devices without hover. */
export function syncMobileBodyClass(): void {
	const body = document.body;
	if (!body) return;
	body.classList.toggle("mindvas-mobile", isMobileApp());
	body.classList.toggle("mindvas-phone", isPhone());
	body.classList.toggle("mindvas-tablet", isTablet());
}

/**
 * Open (or reuse) the Map outline in the right sidebar — works on desktop and tablet.
 * Uses Obsidian's ensureSideLeaf API when available (1.7.2+).
 */
export async function ensureOutlineLeaf(
	app: App,
	viewType: string,
	options?: { reveal?: boolean }
): Promise<WorkspaceLeaf | null> {
	const existing = app.workspace.getLeavesOfType(viewType);
	if (existing.length > 0) return existing[0];

	const reveal = options?.reveal ?? false;

	const ws = app.workspace as unknown as {
		ensureSideLeaf?: (
			type: string,
			side: "left" | "right",
			options?: { split?: boolean; reveal?: boolean; active?: boolean }
		) => Promise<WorkspaceLeaf>;
		getRightLeaf: (split: boolean) => WorkspaceLeaf | null;
	};

	if (typeof ws.ensureSideLeaf === "function") {
		try {
			return await ws.ensureSideLeaf(viewType, "right", {
				split: true,
				reveal,
				active: false,
			});
		} catch (err) {
			console.error("Mindvas: ensureSideLeaf failed", err);
		}
	}

	try {
		const leaf = ws.getRightLeaf(true);
		if (leaf) return leaf;
	} catch {
		// fall through
	}

	try {
		return app.workspace.getLeaf("tab");
	} catch {
		return null;
	}
}

/** Expand the right sidebar drawer if it is collapsed (mobile/tablet). */
export function expandRightSidebar(app: App): void {
	const rightSplit = app.workspace.rightSplit as { collapsed?: boolean; expand?: () => void } | undefined;
	if (rightSplit?.collapsed && typeof rightSplit.expand === "function") {
		rightSplit.expand();
	}
}

/** Run fn safely; log and return false on failure. */
export function safeRun(label: string, fn: () => void): boolean {
	try {
		fn();
		return true;
	} catch (err) {
		console.error(`Mindvas: ${label} failed`, err);
		return false;
	}
}
