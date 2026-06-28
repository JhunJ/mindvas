import { Compartment, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CMContentElement, CMEditorView, CanvasNode } from "../types/canvas-internal";
import { maskEditorExtension } from "./mask-editor-extension";

const injectedViews = new WeakSet<object>();
const compartments = new WeakMap<object, Compartment>();

/** Find every CodeMirror view inside a canvas card (main doc + iframe). */
export function findCMViewsInNode(node: CanvasNode): CMEditorView[] {
	const views: CMEditorView[] = [];
	const seen = new WeakSet<object>();
	const roots: ParentNode[] = [];

	if (node.nodeEl) roots.push(node.nodeEl);
	const iframe = node.nodeEl?.querySelector<HTMLIFrameElement>("iframe");
	if (iframe?.contentDocument?.body) roots.push(iframe.contentDocument.body);

	const addView = (view: CMEditorView | undefined | null) => {
		if (!view || seen.has(view)) return;
		seen.add(view);
		views.push(view);
	};

	for (const root of roots) {
		root.querySelectorAll<CMContentElement>(".cm-content").forEach((el) => {
			addView(el.cmView?.view);
		});
		root.querySelectorAll<HTMLElement>(".cm-editor").forEach((el) => {
			const tagged = el as CMContentElement & { view?: CMEditorView };
			addView(tagged.cmView?.view ?? tagged.view);
		});
	}

	return views;
}

/** Canvas card editors don't always inherit registerEditorExtension — inject on demand. */
export function ensureCanvasNodeEditorMask(view: CMEditorView | EditorView | null | undefined): void {
	if (!view || injectedViews.has(view)) return;

	let compartment = compartments.get(view);
	if (!compartment) {
		compartment = new Compartment();
		compartments.set(view, compartment);
	}

	try {
		(view as EditorView).dispatch({
			effects: StateEffect.appendConfig.of(compartment.of(maskEditorExtension())),
		});
		injectedViews.add(view);
	} catch {
		// Editor not ready yet.
	}
}

export function scheduleCanvasNodeEditorMask(getViews: () => CMEditorView[]): void {
	const run = () => {
		for (const view of getViews()) {
			ensureCanvasNodeEditorMask(view);
		}
	};
	run();
	window.setTimeout(run, 60);
	window.setTimeout(run, 250);
	window.setTimeout(run, 600);
	window.setTimeout(run, 1500);
}

export function scanCanvasEditingNodes(nodes: Iterable<CanvasNode>): void {
	for (const node of nodes) {
		if (!node.isEditing) continue;
		scheduleCanvasNodeEditorMask(() => findCMViewsInNode(node));
	}
}
