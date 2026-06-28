import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "../canvas/canvas-api";
import { buildForest, findTreeForNode, getDescendants } from "../mindmap/tree-model";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 12;

/**
 * Zoom and focus utilities for mind map navigation.
 */
export class Navigation {
	constructor(private canvasApi: CanvasAPI) {}

	/**
	 * Select the entire tree (root + all descendants) that a node belongs to.
	 * Triggered by Alt+click on a node.
	 */
	selectTree(canvas: Canvas, node: CanvasNode): void {
		const forest = buildForest(canvas);
		if (forest.length === 0) return;
		const treeNode = findTreeForNode(forest, node.id);
		if (!treeNode) return;

		let root = treeNode;
		while (root.parent) root = root.parent;

		const allNodes = [root, ...getDescendants(root)];
		canvas.deselectAll();
		for (const n of allNodes) {
			canvas.selection.add(n.canvasNode);
		}
		canvas.requestFrame();
	}

	/**
	 * Zoom to fit an entire branch (node + all descendants).
	 * Triggered by Ctrl+click on a node.
	 */
	zoomToBranch(canvas: Canvas, node: CanvasNode): void {
		const forest = buildForest(canvas);
		if (forest.length === 0) return;

		const treeNode = findTreeForNode(forest, node.id);
		if (!treeNode) return;

		const allNodes = [treeNode, ...getDescendants(treeNode)];

		// Calculate bounding box
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;

		for (const n of allNodes) {
			const cn = n.canvasNode;
			minX = Math.min(minX, cn.x);
			minY = Math.min(minY, cn.y);
			maxX = Math.max(maxX, cn.x + cn.width);
			maxY = Math.max(maxY, cn.y + cn.height);
		}

		// Add padding
		const pad = 50;
		canvas.zoomToBbox({
			minX: minX - pad,
			minY: minY - pad,
			maxX: maxX + pad,
			maxY: maxY + pad,
		});
	}

	/**
	 * Register Ctrl+click handler for zoom-to-branch.
	 */
	registerClickHandler(canvas: Canvas): (() => void) | null {
		const handler = (e: MouseEvent) => {
			if (!e.ctrlKey && !e.metaKey && !e.altKey) return;

			const target = e.target as HTMLElement;
			if (target.closest(".canvas-node-connection-point")) return;
			const nodeEl = target.closest(".canvas-node") as HTMLElement;
			if (!nodeEl) return;

			for (const node of canvas.nodes.values()) {
				if (node.nodeEl === nodeEl) {
					e.preventDefault();
					e.stopPropagation();
					if (e.altKey) {
						this.selectTree(canvas, node);
					} else {
						this.zoomToBranch(canvas, node);
					}
					break;
				}
			}
		};

		canvas.wrapperEl?.addEventListener("click", handler, true);

		return () => {
			canvas.wrapperEl?.removeEventListener("click", handler, true);
		};
	}

	/**
	 * Long-press on a node triggers zoom-to-branch (mobile substitute for Ctrl+click).
	 */
	registerTouchHandler(canvas: Canvas): (() => void) | null {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let startX = 0;
		let startY = 0;
		let targetNode: CanvasNode | null = null;
		let longPressFired = false;

		const clearTimer = () => {
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
		};

		const findNodeFromTarget = (target: EventTarget | null): CanvasNode | null => {
			const el = (target as HTMLElement | null)?.closest?.(".canvas-node") as HTMLElement | null;
			if (!el) return null;
			for (const node of canvas.nodes.values()) {
				if (node.nodeEl === el) return node;
			}
			return null;
		};

		const onPointerDown = (e: PointerEvent) => {
			if (e.pointerType === "mouse") return;
			const target = e.target as HTMLElement;
			if (target.closest(".mindvas-mobile-toolbar, .mindvas-mobile-fab, .mindvas-fold-chevron")) return;
			if (target.closest(".canvas-node-connection-point")) return;

			targetNode = findNodeFromTarget(e.target);
			if (!targetNode) return;

			longPressFired = false;
			startX = e.clientX;
			startY = e.clientY;
			clearTimer();
			timer = setTimeout(() => {
				timer = null;
				longPressFired = true;
				if (targetNode) {
					this.zoomToBranch(canvas, targetNode);
					if (navigator.vibrate) navigator.vibrate(20);
				}
			}, LONG_PRESS_MS);
		};

		const onPointerMove = (e: PointerEvent) => {
			if (!timer) return;
			if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) {
				clearTimer();
			}
		};

		const onPointerUp = () => {
			clearTimer();
			targetNode = null;
		};

		const onClick = (e: MouseEvent) => {
			if (longPressFired) {
				e.preventDefault();
				e.stopPropagation();
				longPressFired = false;
			}
		};

		const wrapper = canvas.wrapperEl;
		wrapper?.addEventListener("pointerdown", onPointerDown, true);
		wrapper?.addEventListener("pointermove", onPointerMove, true);
		wrapper?.addEventListener("pointerup", onPointerUp, true);
		wrapper?.addEventListener("pointercancel", onPointerUp, true);
		wrapper?.addEventListener("click", onClick, true);

		return () => {
			clearTimer();
			wrapper?.removeEventListener("pointerdown", onPointerDown, true);
			wrapper?.removeEventListener("pointermove", onPointerMove, true);
			wrapper?.removeEventListener("pointerup", onPointerUp, true);
			wrapper?.removeEventListener("pointercancel", onPointerUp, true);
			wrapper?.removeEventListener("click", onClick, true);
		};
	}
}
