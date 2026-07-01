import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import {
	getMaskOverlayHost,
	hasInlineMasks,
	maskItemKey,
	parseInlineMasks,
	normalizeMaskSyntax,
	noteMaskItemKey,
} from "./mask-core";
import { trackCanvasSelection } from "./mask-selection";
import { isRevealed, toggleRevealed } from "./mask-reveal";
import {
	isNodeMasked,
	coverAllMasks,
	revealAllMasks,
} from "./mask-study";
import {
	createMaskTapeElement,
	findNodePreviewRoot,
	previewHasMaskTags,
	stripAllMaskWraps,
	collectMaskRoots,
} from "./mask-dom";
import { cleanupMaskTagRemnants, markdownToPlainDisplay } from "./mask-source";
import { attachTapeToggle, getNodeMaskColor } from "./mask-core";
import { wrapCanvasSelection as wrapSel } from "./mask-core";
import { applyMaskColorClass } from "./mask-colors";
import { scanCanvasEditingNodes } from "./mask-canvas-editor-inject";
import { getCanvasNodeMaskSource } from "./mask-canvas-preview";
import { attachTapVsDrag } from "../ui/gesture-tap";
import { hudLine, hudEnabled } from "../ui/touch-hud";
import {
	isTextCardReadMode,
	isTextCardEditing,
	syncTextCardReadMask,
	syncAllTextCardMasksOnCanvas,
	clearTextCardOverlay,
	textCardMaskApplied,
	textCardOverlayApplied,
	resolveTextCardHost,
	applyCanvasNodeInPreviewMasks,
} from "./mask-canvas-text";
import {
	isTextCanvasNode,
	isFileCanvasNode,
	isMaskableCanvasNode,
} from "./mask-canvas-node";

export {
	getNodeMaskColor,
	setNodeMaskColor,
	wrapInlineMask,
	normalizeMaskSyntax,
	DEFAULT_MASK_COLOR,
	type MaskColor,
} from "./mask-core";
export {
	toggleNodeMask,
	isNodeMasked,
	countAllMasks,
	coverAllMasks,
	revealAllMasks,
} from "./mask-study";

import type { MaskColor } from "./mask-core";
import { getLastMaskColor } from "./mask-colors";
import { isMobileApp, isPhone } from "../ui/mobile-utils";

export function wrapCanvasSelection(
	node: CanvasNode,
	color?: MaskColor,
	app?: App
): boolean {
	const ok = wrapSel(node, color ?? getLastMaskColor());
	if (!ok) return false;
	if (app && isFileCanvasNode(node)) {
		const path = resolveCanvasFilePath(node);
		const file = path ? app.vault.getAbstractFileByPath(path) : null;
		if (file instanceof TFile) {
			void app.vault.modify(file, node.text);
		}
	}
	return true;
}

export function resolveCanvasFilePath(node: CanvasNode): string | null {
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

export async function persistCanvasFileNodeContent(
	app: App,
	node: CanvasNode,
	content: string
): Promise<boolean> {
	const path = resolveCanvasFilePath(node);
	if (!path) return false;
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	node.setText(content);
	await app.vault.modify(file, content);
	return true;
}

function resolveFilePath(node: CanvasNode): string | null {
	return resolveCanvasFilePath(node);
}

function maskKeyFor(node: CanvasNode, canvasPath: string): (index: number) => string {
	const path = resolveCanvasFilePath(node);
	if (path) return (i: number) => noteMaskItemKey(path, i);
	return (i: number) => maskItemKey(canvasPath, node.id, i);
}

function getNodeTextSource(node: CanvasNode): string {
	return getCanvasNodeMaskSource(node);
}

function extractDomMaskSource(nodeEl: HTMLElement): string | null {
	const root = findNodePreviewRoot(nodeEl) ?? nodeEl;
	const text = normalizeMaskSyntax(root.textContent ?? "");
	return hasInlineMasks(text) ? text : null;
}

function resolveInlineMaskContent(node: CanvasNode): string | null {
	const fromNode = getNodeTextSource(node);
	if (hasInlineMasks(fromNode)) return fromNode;
	if (!node.nodeEl) return null;
	return extractDomMaskSource(node.nodeEl);
}

function getMaskHosts(node: CanvasNode): HTMLElement[] {
	const hosts: HTMLElement[] = [];
	if (node.nodeEl) hosts.push(node.nodeEl);
	if (node.contentEl && node.contentEl !== node.nodeEl) hosts.push(node.contentEl);
	return hosts;
}

/** Read mode: text cards use dedicated overlay; file cards use nodeEl layer. */
function applyInlineMasksToNode(
	node: CanvasNode,
	content: string,
	canvasPath: string
): void {
	if (!hasInlineMasks(content)) return;

	if (isTextCanvasNode(node)) {
		if (!isTextCardReadMode(node)) return;
		syncTextCardReadMask(node, canvasPath);
		return;
	}

	if (node.isEditing) return;
	if (!node.nodeEl) return;
	// File embeds: in-preview tape only — keep native markdown + branch color.
	removeInlinePreview(node);
	applyCanvasNodeInPreviewMasks(node, content, canvasPath);
}

function applyFileNodeInlineMasks(node: CanvasNode, content: string, canvasPath: string): void {
	applyInlineMasksToNode(node, content, canvasPath);
}

const iframeWatchGeneration = new WeakMap<HTMLIFrameElement, number>();

function watchFileNodeIframe(node: CanvasNode, onLoad: () => void): void {
	if (!node.nodeEl) return;
	const iframe = node.nodeEl.querySelector<HTMLIFrameElement>("iframe");
	if (!iframe) return;

	const gen = (iframeWatchGeneration.get(iframe) ?? 0) + 1;
	iframeWatchGeneration.set(iframe, gen);

	const schedule = () => {
		if (iframeWatchGeneration.get(iframe) !== gen) return;
		onLoad();
	};

	iframe.addEventListener("load", schedule, { passive: true });
	window.setTimeout(schedule, 0);
	window.setTimeout(schedule, 350);
	window.setTimeout(schedule, 900);
}

function setIframeVisible(node: CanvasNode, visible: boolean): void {
	if (!node.nodeEl) return;
	setIframeVisibleFromHost(node.nodeEl, visible);
}

/**
 * Mobile whole-card reveal: the tape covers the whole card and is
 * pointer-events:none (so native drag/long-press/box-select always reach the
 * card). Detect a stationary tap on the card itself to toggle the mask. A drag
 * (>8px) never toggles, so moving the card still works. Passive listeners only.
 */
function attachCardTapReveal(node: CanvasNode, key: string, onRefresh: () => void): void {
	const el = node.nodeEl;
	if (!el || el.dataset.mindvasTapReveal === "1") return;
	el.dataset.mindvasTapReveal = "1";

	attachTapVsDrag(el, {
		// Don't swallow the tap: the card should still be selectable. A drag
		// (>slop) is ignored so the card moves natively.
		swallowTap: false,
		shouldTap: () => !node.isEditing && isNodeMasked(node.canvas, node.id),
		onTap: () => {
			toggleRevealed(key);
			onRefresh();
		},
	});
}

function ensureWholeNodeOverlay(node: CanvasNode, canvasPath: string, onRefresh: () => void): void {
	const host = getMaskOverlayHost(node);
	if (!host) return;

	const key = maskItemKey(canvasPath, node.id);
	const revealed = isRevealed(key);

	let overlay = host.querySelector(":scope > .mindvas-mask-tape") as HTMLButtonElement | null;
	if (!overlay) {
		overlay = document.createElement("button");
		overlay.type = "button";
		overlay.className = "mindvas-mask-tape mindvas-mask-ui";
		overlay.dataset.mindvasKey = key;
		overlay.setAttribute("aria-label", "탭하여 보기");
		attachTapeToggle(overlay);
		host.style.position = "relative";
		host.appendChild(overlay);
	}

	if (isMobileApp()) attachCardTapReveal(node, key, onRefresh);

	overlay.dataset.mindvasKey = key;
	const nodeColor = getNodeMaskColor(node.canvas, node.id) ?? "yellow";
	applyMaskColorClass(overlay, nodeColor);

	if (revealed) {
		overlay.classList.add("is-revealed");
		overlay.textContent = "가리기";
		node.nodeEl?.classList.add("mindvas-mask-revealed");
		node.nodeEl?.classList.remove("mindvas-has-mask");
	} else {
		overlay.classList.remove("is-revealed");
		overlay.textContent = "";
		node.nodeEl?.classList.add("mindvas-has-mask");
		node.nodeEl?.classList.remove("mindvas-mask-revealed");
	}
}

function removeWholeNodeOverlay(node: CanvasNode): void {
	getMaskOverlayHost(node)?.querySelector(":scope > .mindvas-mask-tape")?.remove();
	node.nodeEl?.classList.remove("mindvas-has-mask", "mindvas-mask-revealed");
}

function setIframeVisibleFromHost(host: HTMLElement, visible: boolean): void {
	for (const iframe of Array.from(host.querySelectorAll<HTMLIFrameElement>("iframe"))) {
		iframe.style.opacity = visible ? "" : "0";
		iframe.style.pointerEvents = visible ? "" : "none";
	}
}

function removeInlinePreview(node: CanvasNode): void {
	if (isTextCanvasNode(node)) {
		clearTextCardOverlay(node);
		return;
	}
	for (const host of getMaskHosts(node)) {
		host.querySelector(":scope > .mindvas-mask-preview")?.remove();
		host.classList.remove("mindvas-has-inline-mask");
		for (const el of Array.from(host.querySelectorAll(".mindvas-native-hidden"))) {
			el.classList.remove("mindvas-native-hidden");
		}
	}
	node.nodeEl?.classList.remove("mindvas-has-inline-mask");
	if (node.nodeEl) setIframeVisibleFromHost(node.nodeEl, true);
}

async function readVaultFile(app: App, path: string): Promise<string | null> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	try {
		return await app.vault.read(file);
	} catch {
		return null;
	}
}

const fileSyncGeneration = new WeakMap<CanvasNode, number>();
// Cache file-node contents so repeated syncs (boot/maintain intervals,
// MutationObserver) don't hit the disk every tick. Invalidated on vault modify.
const fileContentCache = new WeakMap<CanvasNode, string | null>();

/** Only markdown files can contain mask syntax. Reading images/PDFs as text
 * (UTF-8 decoding large binaries) freezes the app, especially on tablets. */
function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

function invalidateFileContentCache(node: CanvasNode): void {
	fileContentCache.delete(node);
}

async function syncFileNodeFromVault(
	node: CanvasNode,
	app: App,
	canvasPath: string,
	_onRefresh: () => void
): Promise<void> {
	if (!node.nodeEl || node.isEditing) return;

	const gen = (fileSyncGeneration.get(node) ?? 0) + 1;
	fileSyncGeneration.set(node, gen);

	const path = resolveFilePath(node);
	// Non-markdown embeds (images, PDFs, audio, etc.) can never hold mask syntax
	// and must NOT be read as text — decoding a large binary as UTF-8 freezes
	// the app and blocks subsequent touch input.
	if (path && !isMarkdownPath(path)) {
		removeInlinePreview(node);
		setIframeVisible(node, true);
		return;
	}
	let source: string | null = null;
	if (path) {
		if (fileContentCache.has(node)) {
			source = fileContentCache.get(node) ?? null;
		} else {
			source = await readVaultFile(app, path);
			if (fileSyncGeneration.get(node) !== gen) return;
			fileContentCache.set(node, source);
		}
	}
	if (fileSyncGeneration.get(node) !== gen) return;

	if (!source || !hasInlineMasks(source)) {
		const fromNode = getNodeTextSource(node);
		if (hasInlineMasks(fromNode)) source = fromNode;
	}
	if ((!source || !hasInlineMasks(source)) && node.nodeEl) {
		source = extractDomMaskSource(node.nodeEl);
	}

	if (!source || !hasInlineMasks(source)) {
		removeInlinePreview(node);
		if (node.nodeEl) {
			for (const root of collectMaskRoots(node.nodeEl)) {
				stripAllMaskWraps(root);
				cleanupMaskTagRemnants(root);
			}
		}
		setIframeVisible(node, true);
		return;
	}

	if (isNodeMasked(node.canvas, node.id)) return;

	applyFileNodeInlineMasks(node, source, canvasPath);
}

function syncOneNode(
	node: CanvasNode,
	canvasPath: string,
	onRefresh: () => void,
	app: App
): void {
	if (!isMaskableCanvasNode(node)) {
		removeWholeNodeOverlay(node);
		removeInlinePreview(node);
		return;
	}

	if (!node.isEditing && node.text?.includes("[[mv:")) {
		const fixed = normalizeMaskSyntax(node.text);
		if (fixed !== node.text) node.setText(fixed);
	}

	if (isTextCanvasNode(node) && (node.isEditing || isTextCardEditing(node))) {
		removeWholeNodeOverlay(node);
		removeInlinePreview(node);
		scanCanvasEditingNodes([node]);
		return;
	}

	if (!isTextCanvasNode(node) && node.isEditing) {
		removeWholeNodeOverlay(node);
		removeInlinePreview(node);
		scanCanvasEditingNodes([node]);
		return;
	}

	if (isNodeMasked(node.canvas, node.id)) {
		removeInlinePreview(node);
		setIframeVisible(node, true);
		ensureWholeNodeOverlay(node, canvasPath, onRefresh);
		return;
	}

	removeWholeNodeOverlay(node);

	if (isFileCanvasNode(node)) {
		watchFileNodeIframe(node, onRefresh);
		void syncFileNodeFromVault(node, app, canvasPath, onRefresh);
		if (!node.nodeEl) return;
		if (!node.nodeEl.dataset.mindvasMaskPending) {
			node.nodeEl.dataset.mindvasMaskPending = "1";
			window.setTimeout(() => {
				delete node.nodeEl?.dataset.mindvasMaskPending;
				void syncFileNodeFromVault(node, app, canvasPath, onRefresh);
			}, 400);
			window.setTimeout(() => {
				void syncFileNodeFromVault(node, app, canvasPath, onRefresh);
			}, 1200);
		}
		return;
	}

	const inlineContent = resolveInlineMaskContent(node);
	if (inlineContent) {
		applyInlineMasksToNode(node, inlineContent, canvasPath);
		if (isTextCanvasNode(node)) scheduleTextNodeMaskRetries(node, canvasPath, onRefresh, app);
		return;
	}

	// Text nodes: apply from canvas JSON even when node.text / DOM extraction failed.
	if (isTextCanvasNode(node)) {
		const source = getCanvasNodeMaskSource(node);
		if (hasInlineMasks(source) && isTextCardReadMode(node)) {
			syncTextCardReadMask(node, canvasPath);
			scheduleTextNodeMaskRetries(node, canvasPath, onRefresh, app);
			return;
		}
	}

	removeInlinePreview(node);
}

const textSyncGeneration = new WeakMap<CanvasNode, number>();

function scheduleTextNodeMaskRetries(
	node: CanvasNode,
	canvasPath: string,
	onRefresh: () => void,
	app: App
): void {
	if (!isTextCanvasNode(node)) return;
	const gen = (textSyncGeneration.get(node) ?? 0) + 1;
	textSyncGeneration.set(node, gen);

	const retry = () => {
		if (textSyncGeneration.get(node) !== gen || !isTextCardReadMode(node)) return;
		const content = resolveInlineMaskContent(node);
		if (!content) return;
		if (textCardMaskApplied(node, content)) return;
		syncOneNode(node, canvasPath, onRefresh, app);
	};

	for (const ms of [0, 50, 150, 350, 700, 1500, 3000]) {
		window.setTimeout(retry, ms);
	}
	requestAnimationFrame(() => requestAnimationFrame(retry));
}

const nodeMaskWatchers = new WeakMap<CanvasNode, MutationObserver>();
const nodeWasEditing = new WeakMap<CanvasNode, boolean>();

function ensureNodeMaskWatch(
	node: CanvasNode,
	canvasPath: string,
	app: App,
	refresh: () => void
): void {
	if (nodeMaskWatchers.has(node)) return;
	const host = isTextCanvasNode(node) ? resolveTextCardHost(node) : node.nodeEl;
	if (!host) return;

	const observer = new MutationObserver(() => {
		if (isTextCanvasNode(node) && !isTextCardReadMode(node)) return;
		if (!isTextCanvasNode(node) && node.isEditing) return;
		const needsMask =
			hasInlineMasks(getNodeTextSource(node)) || previewHasMaskTags(node.nodeEl);
		const content = resolveInlineMaskContent(node);
		const hasOverlay = content
			? textCardMaskApplied(node, content)
			: textCardMaskApplied(node);
		if (needsMask && !hasOverlay) {
			syncOneNode(node, canvasPath, refresh, app);
		}
	});
	observer.observe(host, {
		subtree: true,
		childList: true,
		characterData: true,
	});
	nodeMaskWatchers.set(node, observer);
}

function clearNodeMaskWatch(node: CanvasNode): void {
	nodeMaskWatchers.get(node)?.disconnect();
	nodeMaskWatchers.delete(node);
}

function schedulePostEditBlurSync(refresh: () => void): void {
	for (const ms of [0, 80, 200, 500, 1200]) {
		window.setTimeout(refresh, ms);
	}
}

export function syncCanvasMaskUI(canvas: Canvas, canvasPath: string, app: App): void {
	const onRefresh = () => syncCanvasMaskUI(canvas, canvasPath, app);
	syncAllTextCardMasksOnCanvas(canvasPath, canvas.nodes.values());
	let anyBlur = false;
	for (const node of canvas.nodes.values()) {
		const wasEditing = nodeWasEditing.get(node) ?? false;
		if (wasEditing && !node.isEditing) anyBlur = true;
		nodeWasEditing.set(node, node.isEditing);
		syncOneNode(node, canvasPath, onRefresh, app);
		if (!node.isEditing && isMaskableCanvasNode(node)) {
			const content = resolveInlineMaskContent(node);
			if (content) ensureNodeMaskWatch(node, canvasPath, app, onRefresh);
			else clearNodeMaskWatch(node);
		} else {
			clearNodeMaskWatch(node);
		}
	}
	if (anyBlur) schedulePostEditBlurSync(onRefresh);
}

export function clearCanvasMaskUI(canvas: Canvas): void {
	for (const node of canvas.nodes.values()) {
		clearNodeMaskWatch(node);
		removeWholeNodeOverlay(node);
		removeInlinePreview(node);
	}
}

export function refreshCanvasMaskUI(canvas: Canvas, canvasPath: string, app: App): void {
	syncCanvasMaskUI(canvas, canvasPath, app);
}

/** Refresh every open canvas view (e.g. after a linked note file changes). */
export function refreshAllCanvasMasks(app: App): void {
	for (const leaf of app.workspace.getLeavesOfType("canvas")) {
		const view = leaf.view as { canvas?: Canvas; file?: { path?: string } };
		const canvas = view?.canvas;
		if (!canvas) continue;
		const canvasPath = view.file?.path ?? "";
		refreshCanvasMaskUI(canvas, canvasPath, app);
		canvas.requestFrame();
	}
}

export function registerCanvasMaskHandler(
	canvas: Canvas,
	canvasPath: string,
	app: App
): () => void {
	const mobile = isMobileApp();
	const tablet = mobile && !isPhone();

	// Sync strategy:
	//  - Desktop: hook requestFrame to reapply masks per frame (safe with mouse).
	//  - Mobile (phones + tablets): NO requestFrame hook. Instead, passive pointer
	//    tracking marks `interacting` during any touch so the maintenance interval
	//    never re-renders a card mid-drag (which cancels a native touch drag —
	//    canvas.isDragging is unreliable on mobile so it can't guard alone).
	//  - Tablets additionally skip the MutationObserver (its childList mutations
	//    fire during select/drag/box-select and can't be guarded reliably).
	// Debounce sync so pan/zoom (which fire requestFrame dozens of times/sec on
	// mobile) never trigger a full node scan mid-gesture.
	const SYNC_DEBOUNCE = mobile ? 250 : 100;
	const GESTURE_IDLE = mobile ? 260 : 140;

	let syncing = false;
	let interacting = false;
	let pointerHeld = false;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let gestureTimer: ReturnType<typeof setTimeout> | null = null;
	// Active touch/pen pointers by id. A native canvas drag can capture the
	// pointer and release it on an element that isn't under our wrapper, so a
	// matching pointerup/cancel may never reach these listeners. Each pointer
	// therefore carries a safety timeout: if no release arrives, we forget it so
	// `pointerHeld` (and the sync suppression it drives) can NEVER stick forever.
	// Without this, one missed release froze all sync — masks stopped healing and
	// tap-to-reveal stopped updating: the "works once, then dead" bug.
	const activePointers = new Map<number, ReturnType<typeof setTimeout>>();
	const POINTER_SAFETY_MS = 6000;
	const syncPointerHeld = () => {
		pointerHeld = activePointers.size > 0;
	};
	// Diagnostics only (HUD): observe when sync runs vs. when a gesture starts.
	let lastSyncAt = 0;
	let syncCount = 0;
	let downCount = 0;
	let upCount = 0;

	const runSync = () => {
		// Never scan/rewrite the DOM while the user is panning/zooming, or while
		// Obsidian is dragging a node (isDragging) — re-rendering a card mid-drag
		// cancels the drag on touch devices. isDragging is the robust signal that
		// works on all platforms regardless of pointer/touch event quirks.
		if (syncing || interacting || pointerHeld || canvas.isDragging) return;
		syncing = true;
		try {
			syncCanvasMaskUI(canvas, canvasPath, app);
			lastSyncAt = Date.now();
			syncCount++;
		} finally {
			syncing = false;
		}
	};

	const scheduleSync = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			if (interacting) {
				scheduleSync();
				return;
			}
			runSync();
		}, SYNC_DEBOUNCE);
	};

	const refresh = () => scheduleSync();

	// A pointer/wheel gesture is in progress — suppress sync until it settles.
	// While a finger is still down (pointerHeld), keep re-arming: a long-press
	// holds still (no pointermove) for a while before the drag begins, and if we
	// let sync resume during that stillness a re-render would cancel the imminent
	// drag. This was the "works, then breaks when I touch something" bug.
	const markInteracting = () => {
		interacting = true;
		if (gestureTimer) clearTimeout(gestureTimer);
		gestureTimer = setTimeout(() => {
			gestureTimer = null;
			if (pointerHeld) {
				markInteracting();
				return;
			}
			interacting = false;
			scheduleSync();
		}, GESTURE_IDLE);
	};

	const wrapper = canvas.wrapperEl;
	const gestureOpts = { passive: true, capture: true } as AddEventListenerOptions;
	const onGesture = () => markInteracting();
	const reportHud = (phase: string, e: Event, n: number) => {
		if (!hudEnabled()) return;
		const t = e.target as HTMLElement | null;
		const cardEl = t?.closest?.(".canvas-node") as HTMLElement | null;
		const tgt = t?.className ? String(t.className).slice(0, 18) : t?.tagName ?? "?";
		const sinceSync = lastSyncAt ? Date.now() - lastSyncAt : -1;
		hudLine(
			phase,
			`#${n} ${cardEl ? "CARD" : "empty"} isDrag=${canvas.isDragging ? 1 : 0} int=${interacting ? 1 : 0} ph=${activePointers.size} dSync=${sinceSync} syncN=${syncCount} tgt=${tgt}`
		);
	};
	const onPointerDown = (e: Event) => {
		const id = (e as PointerEvent).pointerId ?? 0;
		const stale = activePointers.get(id);
		if (stale) clearTimeout(stale);
		activePointers.set(
			id,
			setTimeout(() => {
				activePointers.delete(id);
				syncPointerHeld();
			}, POINTER_SAFETY_MS)
		);
		syncPointerHeld();
		markInteracting();
		reportHud("DOWN", e, ++downCount);
	};
	const onPointerRelease = (e: Event) => {
		const id = (e as PointerEvent).pointerId;
		if (id == null) {
			for (const t of activePointers.values()) clearTimeout(t);
			activePointers.clear();
		} else {
			const t = activePointers.get(id);
			if (t) clearTimeout(t);
			activePointers.delete(id);
		}
		syncPointerHeld();
		markInteracting();
		reportHud("UP", e, ++upCount);
	};
	// All mobile (phones + tablets): passive pointer tracking so any in-progress
	// touch (card drag, long-press, box-select, pan) suppresses the maintenance
	// sync that would otherwise re-render a card mid-gesture and cancel it. Purely
	// passive — preventDefault is never called, so native gestures stay intact.
	// touchmove is intentionally omitted (it previously interfered with drag-to-
	// select). Desktop uses no listeners (its requestFrame hook handles sync and
	// mouse drags survive re-renders).
	if (mobile) {
		wrapper?.addEventListener("pointerdown", onPointerDown, gestureOpts);
		wrapper?.addEventListener("pointermove", onGesture, gestureOpts);
		wrapper?.addEventListener("pointerup", onPointerRelease, gestureOpts);
		wrapper?.addEventListener("pointercancel", onPointerRelease, gestureOpts);
		wrapper?.addEventListener("wheel", onGesture, gestureOpts);
	}

	// DESKTOP ONLY: hook requestFrame to reapply masks per frame (rAF-debounced).
	// This is safe with a mouse (pointer capture keeps drags alive through DOM
	// re-renders). On tablets it broke card dragging: a mid-drag requestFrame
	// (from the edge updater) triggered runSync which re-rendered the card DOM
	// and cancelled the touch drag — and canvas.isDragging isn't reliably set on
	// mobile, so it couldn't guard against it. Tablets instead rely on the
	// MutationObserver + maintenance intervals to keep masks in sync, leaving
	// Obsidian's native canvas methods completely untouched during drags.
	let origRequestFrame: (() => void) | null = null;
	if (!mobile) {
		origRequestFrame = canvas.requestFrame.bind(canvas);
		let frameSyncPending = false;
		canvas.requestFrame = () => {
			origRequestFrame!();
			if (frameSyncPending) return;
			frameSyncPending = true;
			requestAnimationFrame(() => {
				frameSyncPending = false;
				runSync();
			});
		};
	}

	// Initial application (deferred so it doesn't block the first paint).
	setTimeout(runSync, 0);

	const observer = new MutationObserver((records) => {
		if (interacting || pointerHeld || canvas.isDragging) return;
		const fromMask = records.some((r) => {
			const el = (r.target as Node).nodeType === Node.ELEMENT_NODE
				? (r.target as HTMLElement)
				: (r.target as Node).parentElement;
			return el?.closest?.(".mindvas-mask-ui, .mindvas-inline-mask-wrap") != null;
		});
		if (fromMask) return;
		scheduleSync();
	});
	// Tablets skip the observer: childList mutations fire while selecting/dragging
	// cards (and while box-selecting empty space), and since canvas.isDragging is
	// unreliable on mobile it can't guard runSync — the resulting mid-gesture
	// re-render cancels the native touch drag. The self-heal interval below keeps
	// masks applied without ever rewriting a card that's already correct.
	if (!tablet) {
		observer.observe(canvas.wrapperEl, {
			subtree: true,
			childList: true,
		});
	}

	const onVaultChange = app.vault.on("modify", (file) => {
		if (!(file instanceof TFile)) return;
		for (const node of canvas.nodes.values()) {
			if (resolveFilePath(node) === file.path) {
				invalidateFileContentCache(node);
				scheduleSync();
			}
		}
	});

	// Boot: apply masks a few times right after load, then stop.
	let tick = 0;
	const bootMax = mobile ? 8 : 16;
	const bootInterval = window.setInterval(() => {
		if (!interacting && !pointerHeld && !canvas.isDragging) {
			runSync();
			scanCanvasEditingNodes(canvas.nodes.values());
		}
		if (++tick >= bootMax) window.clearInterval(bootInterval);
	}, mobile ? 500 : 400);

	const editScanInterval = window.setInterval(() => {
		if (interacting || pointerHeld || canvas.isDragging) return;
		scanCanvasEditingNodes(canvas.nodes.values());
	}, mobile ? 900 : 500);

	// Diagnostics only: live sample of drag/suppression state while at rest.
	const hudSampler = window.setInterval(() => {
		if (!hudEnabled()) return;
		hudLine(
			"now",
			`isDrag=${canvas.isDragging ? 1 : 0} int=${interacting ? 1 : 0} ph=${activePointers.size} dSync=${lastSyncAt ? Date.now() - lastSyncAt : -1}`
		);
	}, 250);

	// Idle self-heal: only re-apply masks that went missing (e.g. after rerender).
	const maintainInterval = window.setInterval(() => {
		if (interacting || pointerHeld || canvas.isDragging) return;
		for (const node of canvas.nodes.values()) {
			if (!isMaskableCanvasNode(node)) continue;
			if (isTextCanvasNode(node) && (node.isEditing || isTextCardEditing(node))) continue;
			if (!isTextCanvasNode(node) && node.isEditing) continue;
			if (!node.nodeEl && !isTextCanvasNode(node)) continue;
			if (isTextCanvasNode(node) && !resolveTextCardHost(node)) continue;
			const source = getNodeTextSource(node);
			const needsMask = hasInlineMasks(source) || previewHasMaskTags(node.nodeEl);
			const hasOverlay = hasInlineMasks(source)
				? textCardMaskApplied(node, source)
				: textCardMaskApplied(node);
			if (needsMask && !hasOverlay) {
				syncOneNode(node, canvasPath, refresh, app);
				ensureNodeMaskWatch(node, canvasPath, app, refresh);
			}
		}
	}, mobile ? 1600 : 900);

	const cleanupSelection = trackCanvasSelection(canvas);

	return () => {
		if (origRequestFrame) canvas.requestFrame = origRequestFrame;
		window.clearInterval(bootInterval);
		window.clearInterval(editScanInterval);
		window.clearInterval(maintainInterval);
		window.clearInterval(hudSampler);
		if (debounceTimer) clearTimeout(debounceTimer);
		if (gestureTimer) clearTimeout(gestureTimer);
		if (mobile) {
			wrapper?.removeEventListener("pointerdown", onPointerDown, gestureOpts);
			wrapper?.removeEventListener("pointermove", onGesture, gestureOpts);
			wrapper?.removeEventListener("pointerup", onPointerRelease, gestureOpts);
			wrapper?.removeEventListener("pointercancel", onPointerRelease, gestureOpts);
			wrapper?.removeEventListener("wheel", onGesture, gestureOpts);
		}
		for (const t of activePointers.values()) clearTimeout(t);
		activePointers.clear();
		observer.disconnect();
		app.vault.offref(onVaultChange);
		cleanupSelection();
		clearCanvasMaskUI(canvas);
	};
}
