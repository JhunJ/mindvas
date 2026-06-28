import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI, findNodeFromEvent, isCanvasReadonly, NODE_DRAG_THRESHOLD_PX } from "./canvas-api";

/**
 * Collect all descendant nodes by walking outgoing edges (BFS).
 * Uses the edge index for O(N) traversal instead of O(N*E).
 */
function collectDescendants(canvas: Canvas, canvasApi: CanvasAPI, nodeId: string): CanvasNode[] {
	const result: CanvasNode[] = [];
	const visited = new Set<string>([nodeId]);
	const queue = [nodeId];

	while (queue.length > 0) {
		const id = queue.shift()!;
		for (const edge of canvasApi.getOutgoingEdges(canvas, id)) {
			const childId = edge.to.node.id;
			if (!visited.has(childId)) {
				visited.add(childId);
				result.push(edge.to.node);
				queue.push(childId);
			}
		}
	}
	return result;
}

/**
 * Register pointer listeners that make dragging a node also move
 * all its descendant nodes, preserving relative positions.
 *
 * Skipped entirely in canvas read mode so viewport pan stays smooth.
 * Uses a movement threshold so taps / pans starting on a node do not
 * install moveTo wrappers prematurely.
 *
 * Hold Alt while dragging to move only the single node.
 */
export function registerSubtreeDragHandler(canvas: Canvas, canvasApi: CanvasAPI): () => void {
	let draggedNode: CanvasNode | null = null;
	let cachedDescendants: CanvasNode[] | null = null;
	let originalMoveTo: ((pos: { x: number; y: number }) => void) | null = null;
	let pendingNode: CanvasNode | null = null;
	let startX = 0;
	let startY = 0;

	function installWrapper(node: CanvasNode): void {
		const descendants = collectDescendants(canvas, canvasApi, node.id);
		if (descendants.length === 0) return;

		draggedNode = node;
		cachedDescendants = descendants;

		const proto = Object.getPrototypeOf(node) as CanvasNode;
		originalMoveTo = proto.moveTo.bind(node);
		node.moveTo = (pos: { x: number; y: number }) => {
			const dx = pos.x - node.x;
			const dy = pos.y - node.y;
			originalMoveTo!(pos);
			for (const desc of cachedDescendants!) {
				const descProto = Object.getPrototypeOf(desc) as CanvasNode;
				descProto.moveTo.call(desc, { x: desc.x + dx, y: desc.y + dy });
			}
		};
	}

	function clearDragSession(): void {
		if (draggedNode && originalMoveTo) {
			delete (draggedNode as { moveTo?: unknown }).moveTo;
		}
		draggedNode = null;
		cachedDescendants = null;
		originalMoveTo = null;
		pendingNode = null;
	}

	const downHandler = (e: PointerEvent): void => {
		if (draggedNode) clearDragSession();
		if (isCanvasReadonly(canvas)) return;
		if (e.altKey) return;

		const node = findNodeFromEvent(canvas, e);
		if (!node) return;

		pendingNode = node;
		startX = e.clientX;
		startY = e.clientY;
	};

	const moveHandler = (e: PointerEvent): void => {
		if (isCanvasReadonly(canvas)) {
			clearDragSession();
			return;
		}
		if (e.buttons === 0) return;

		if (e.altKey) {
			if (draggedNode) clearDragSession();
			pendingNode = null;
			return;
		}

		if (!draggedNode && pendingNode) {
			if (Math.hypot(e.clientX - startX, e.clientY - startY) >= NODE_DRAG_THRESHOLD_PX) {
				installWrapper(pendingNode);
				pendingNode = null;
			}
		}

		if (!draggedNode) return;

		const currentSelected = canvasApi.getSelectedNode(canvas);
		if (!currentSelected || currentSelected.id !== draggedNode.id) {
			clearDragSession();
		}
	};

	const upHandler = (): void => {
		pendingNode = null;
		if (!draggedNode) return;
		canvas.requestSave();
		clearDragSession();
	};

	const opts = { passive: true } as AddEventListenerOptions;
	const wrapper = canvas.wrapperEl;
	wrapper?.addEventListener("pointerdown", downHandler, opts);
	wrapper?.addEventListener("pointermove", moveHandler, opts);
	wrapper?.addEventListener("pointerup", upHandler, opts);
	wrapper?.addEventListener("pointercancel", upHandler, opts);

	return () => {
		clearDragSession();
		wrapper?.removeEventListener("pointerdown", downHandler, opts);
		wrapper?.removeEventListener("pointermove", moveHandler, opts);
		wrapper?.removeEventListener("pointerup", upHandler, opts);
		wrapper?.removeEventListener("pointercancel", upHandler, opts);
	};
}
