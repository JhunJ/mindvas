import type { CanvasNode } from "../types/canvas-internal";

export type CanvasNodeKind = "text" | "file" | "link" | "group";

/** Obsidian 1.12 / Advanced Canvas may leave `node.type` undefined — read from getData(). */
export function getCanvasNodeDataRecord(node: CanvasNode): Record<string, unknown> | undefined {
	const withData = node as CanvasNode & { getData?: () => Record<string, unknown> };
	if (typeof withData.getData === "function") {
		try {
			return withData.getData();
		} catch {
			// fall through
		}
	}
	return node.canvas.getData().nodes.find((n) => n.id === node.id) as
		| Record<string, unknown>
		| undefined;
}

export function resolveCanvasNodeType(node: CanvasNode): CanvasNodeKind | undefined {
	const runtime = node.type;
	if (runtime === "text" || runtime === "file" || runtime === "link" || runtime === "group") {
		return runtime;
	}

	const data = getCanvasNodeDataRecord(node);
	const dataType = data?.type;
	if (dataType === "text" || dataType === "file" || dataType === "link" || dataType === "group") {
		return dataType;
	}

	const file = data?.file ?? node.file;
	if (typeof file === "string" && file.trim()) return "file";
	if (typeof data?.url === "string" && (data.url as string).trim()) return "link";
	if (data?.label !== undefined && !data?.text && !(typeof file === "string" && file.trim())) {
		return "group";
	}
	if (typeof data?.text === "string" || typeof node.text === "string") return "text";

	return undefined;
}

export function isTextCanvasNode(node: CanvasNode): boolean {
	return resolveCanvasNodeType(node) === "text";
}

export function isFileCanvasNode(node: CanvasNode): boolean {
	return resolveCanvasNodeType(node) === "file";
}

export function isMaskableCanvasNode(node: CanvasNode): boolean {
	const kind = resolveCanvasNodeType(node);
	return kind === "text" || kind === "file";
}
