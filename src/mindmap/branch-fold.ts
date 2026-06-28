import type { Canvas, CanvasEdge, CanvasNode } from "../types/canvas-internal";
import { buildForest, findTreeForNode, getDescendants, TreeNode } from "./tree-model";
import type { LayoutEngine } from "./layout-engine";

export function getCollapsedBranches(canvas: Canvas): Set<string> {
	const data = canvas.getData();
	return new Set(data.collapsedBranches ?? []);
}

export function setCollapsedBranches(canvas: Canvas, collapsed: Set<string>): void {
	const data = canvas.getData();
	if (collapsed.size === 0) {
		delete data.collapsedBranches;
	} else {
		data.collapsedBranches = Array.from(collapsed);
	}
	canvas.setData(data);
}

export function getHiddenNodeIds(canvas: Canvas): Set<string> {
	const collapsed = getCollapsedBranches(canvas);
	const hidden = new Set<string>();
	if (collapsed.size === 0) return hidden;

	const forest = buildForest(canvas);
	for (const parentId of collapsed) {
		const treeNode = findTreeForNode(forest, parentId);
		if (!treeNode) continue;
		for (const descendant of getDescendants(treeNode)) {
			hidden.add(descendant.canvasNode.id);
		}
	}
	return hidden;
}

export function isNodeBranchHidden(canvas: Canvas, nodeId: string): boolean {
	return getHiddenNodeIds(canvas).has(nodeId);
}

function shouldHideEdge(
	hidden: Set<string>,
	fromId: string,
	toId: string
): boolean {
	return hidden.has(fromId) || hidden.has(toId);
}

function setElementHidden(el: Element | undefined, hide: boolean): void {
	if (!el || !(el instanceof HTMLElement)) {
		if (el instanceof SVGElement) {
			el.style.display = hide ? "none" : "";
			el.style.pointerEvents = hide ? "none" : "";
			el.classList.toggle("mindvas-branch-hidden", hide);
		}
		return;
	}
	el.classList.toggle("mindvas-branch-hidden", hide);
	el.style.display = hide ? "none" : "";
	el.style.pointerEvents = hide ? "none" : "";
}

function setEdgeHidden(edge: CanvasEdge, hide: boolean): void {
	setElementHidden(edge.lineGroupEl, hide);
	setElementHidden(edge.lineEl, hide);
	setElementHidden(edge.lineEndGroupEl, hide);
	if (edge.path?.display) {
		setElementHidden(edge.path.display, hide);
	}
}

export function applyBranchVisibility(canvas: Canvas): void {
	const hidden = getHiddenNodeIds(canvas);

	for (const node of canvas.nodes.values()) {
		const hideNode = hidden.has(node.id);
		setElementHidden(node.nodeEl, hideNode);

		if (!hideNode && node.nodeEl) {
			syncConnectionPointsForNode(canvas, node, hidden);
		}
	}

	for (const edge of canvas.edges.values()) {
		const hide = shouldHideEdge(
			hidden,
			edge.from.node.id,
			edge.to.node.id
		);
		setEdgeHidden(edge, hide);
	}
}

/** Hide connection-point dots on sides that only lead to collapsed nodes. */
function syncConnectionPointsForNode(
	canvas: Canvas,
	node: CanvasNode,
	hidden: Set<string>
): void {
	if (!node.nodeEl) return;

	const hiddenSides = new Set<string>();
	for (const edge of canvas.edges.values()) {
		if (edge.from.node.id !== node.id) continue;
		if (shouldHideEdge(hidden, edge.from.node.id, edge.to.node.id)) {
			hiddenSides.add(edge.from.side);
		}
	}

	for (const point of Array.from(node.nodeEl.querySelectorAll(".canvas-node-connection-point"))) {
		const side = point.getAttribute("data-side");
		setElementHidden(
			point,
			side !== null && hiddenSides.has(side)
		);
	}
}

function countDescendants(node: TreeNode): number {
	return getDescendants(node).length;
}

function getChevronSide(treeNode: TreeNode): "left" | "right" {
	if (treeNode.direction) return treeNode.direction;

	let rightCount = 0;
	let leftCount = 0;
	for (const child of treeNode.children) {
		if (child.direction === "left") leftCount++;
		else rightCount++;
	}
	return leftCount > rightCount ? "left" : "right";
}

function walkTree(node: TreeNode, fn: (n: TreeNode) => void): void {
	fn(node);
	for (const child of node.children) {
		walkTree(child, fn);
	}
}

function ensureChevron(
	treeNode: TreeNode,
	isCollapsed: boolean,
	onToggle: (parentId: string) => void
): void {
	const node = treeNode.canvasNode;
	if (!node.nodeEl) return;

	let chevron = node.nodeEl.querySelector(".mindvas-fold-chevron") as HTMLButtonElement | null;
	if (!chevron) {
		chevron = document.createElement("button");
		chevron.type = "button";
		chevron.className = "mindvas-fold-chevron";
		chevron.setAttribute("aria-label", "Toggle branch");
		chevron.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			onToggle(node.id);
		});
		node.nodeEl.appendChild(chevron);
	}

	const side = getChevronSide(treeNode);
	chevron.classList.toggle("is-right", side === "right");
	chevron.classList.toggle("is-left", side === "left");
	chevron.classList.toggle("is-collapsed", isCollapsed);

	if (isCollapsed) {
		chevron.setAttribute("data-hidden-count", String(countDescendants(treeNode)));
	} else {
		chevron.removeAttribute("data-hidden-count");
	}
}

export function syncBranchFoldChevrons(
	canvas: Canvas,
	onToggle: (parentId: string) => void
): void {
	const collapsed = getCollapsedBranches(canvas);
	const hidden = getHiddenNodeIds(canvas);
	const forest = buildForest(canvas);
	const activeParentIds = new Set<string>();

	for (const root of forest) {
		walkTree(root, (node) => {
			if (node.children.length === 0) return;
			if (hidden.has(node.canvasNode.id)) {
				node.canvasNode.nodeEl?.querySelector(".mindvas-fold-chevron")?.remove();
				return;
			}
			activeParentIds.add(node.canvasNode.id);
			ensureChevron(node, collapsed.has(node.canvasNode.id), onToggle);
		});
	}

	for (const node of canvas.nodes.values()) {
		if (!activeParentIds.has(node.id)) {
			node.nodeEl?.querySelector(".mindvas-fold-chevron")?.remove();
		}
	}
}

export function refreshBranchFoldUI(
	canvas: Canvas,
	layoutEngine: LayoutEngine,
	isMindmap: () => boolean
): void {
	if (!isMindmap()) {
		clearBranchFoldUI(canvas);
		return;
	}

	applyBranchVisibility(canvas);
	syncBranchFoldChevrons(canvas, (parentId) => {
		toggleBranchFold(canvas, layoutEngine, parentId);
	});
}

export function clearBranchFoldUI(canvas: Canvas): void {
	for (const node of canvas.nodes.values()) {
		setElementHidden(node.nodeEl, false);
		node.nodeEl?.querySelector(".mindvas-fold-chevron")?.remove();
		for (const point of Array.from(node.nodeEl?.querySelectorAll(".canvas-node-connection-point") ?? [])) {
			setElementHidden(point, false);
		}
	}
	for (const edge of canvas.edges.values()) {
		setEdgeHidden(edge, false);
	}
}

export function toggleBranchFold(
	canvas: Canvas,
	layoutEngine: LayoutEngine,
	parentId: string
): void {
	const forest = buildForest(canvas);
	const treeNode = findTreeForNode(forest, parentId);
	if (!treeNode || treeNode.children.length === 0) return;

	const collapsed = getCollapsedBranches(canvas);
	if (collapsed.has(parentId)) {
		collapsed.delete(parentId);
	} else {
		collapsed.add(parentId);
	}

	setCollapsedBranches(canvas, collapsed);
	layoutEngine.layout(canvas);
	refreshBranchFoldUI(canvas, layoutEngine, () => true);
	canvas.requestSave();
	canvas.requestFrame();
}

export function registerBranchFoldHandler(
	canvas: Canvas,
	layoutEngine: LayoutEngine,
	isMindmap: () => boolean
): () => void {
	const sync = () => refreshBranchFoldUI(canvas, layoutEngine, isMindmap);

	sync();

	const onPointerUp = () => {
		requestAnimationFrame(sync);
	};
	canvas.wrapperEl.addEventListener("pointerup", onPointerUp);

	return () => {
		canvas.wrapperEl.removeEventListener("pointerup", onPointerUp);
		clearBranchFoldUI(canvas);
	};
}
