import { EditorView } from "@codemirror/view";

const ARROW_SYMBOL = "→";

/**
 * CodeMirror extension: replace "->" with "→" as the user types.
 * Works in canvas node editors (desktop, mobile, tablet) via registerEditorExtension.
 */
export function arrowShortcutExtension() {
	return EditorView.inputHandler.of((view, from, to, text) => {
		if (text !== ">" || from !== to || from < 1) return false;

		const doc = view.state.doc;
		if (doc.sliceString(from - 1, from) !== "-") return false;
		// Avoid turning "-->" into "-→"
		if (from >= 2 && doc.sliceString(from - 2, from - 1) === "-") return false;

		view.dispatch({
			changes: { from: from - 1, to: from, insert: ARROW_SYMBOL },
			selection: { anchor: from - 1 + ARROW_SYMBOL.length },
		});
		return true;
	});
}

/**
 * Replace "->" with "→" in a contenteditable element (e.g. outline group rename).
 * Returns a cleanup function.
 */
export function attachContentEditableArrowShortcut(el: HTMLElement): () => void {
	const onBeforeInput = (e: InputEvent) => {
		if (e.inputType !== "insertText" || e.data !== ">") return;

		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;

		const range = sel.getRangeAt(0);
		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE) return;

		const offset = range.startOffset;
		const text = node.textContent ?? "";
		if (offset < 1 || text[offset - 1] !== "-") return;
		if (offset >= 2 && text[offset - 2] === "-") return;

		e.preventDefault();

		const replaceStart = offset - 1;
		node.textContent = text.slice(0, replaceStart) + ARROW_SYMBOL + text.slice(offset);

		const newRange = document.createRange();
		newRange.setStart(node, replaceStart + ARROW_SYMBOL.length);
		newRange.collapse(true);
		sel.removeAllRanges();
		sel.addRange(newRange);
	};

	el.addEventListener("beforeinput", onBeforeInput);
	return () => el.removeEventListener("beforeinput", onBeforeInput);
}
