import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import type { MaskColor } from "./mask-core";

const MASK_SCAN_RE =
	/\[mv\|(yellow|red|blue|green)\]([\s\S]*?)\[\/mv\]|\[\[mv:(yellow|red|blue|green)\]\]([\s\S]*?)\[\[\/mv\]\]/g;

class MaskTapeWidget extends WidgetType {
	constructor(
		readonly color: MaskColor,
		readonly content: string
	) {
		super();
	}

	eq(other: MaskTapeWidget): boolean {
		return other.color === this.color && other.content === this.content;
	}

	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.className = `mindvas-cm-tape mindvas-mask-${this.color}`;
		el.textContent = "●".repeat(Math.min(Math.max(this.content.length, 3), 10));
		return el;
	}
}

function buildMaskDecorations(view: EditorView): DecorationSet {
	const text = view.state.doc.toString();
	const ranges: ReturnType<Decoration["range"]>[] = [];
	let match: RegExpExecArray | null;
	const re = new RegExp(MASK_SCAN_RE.source, "g");

	while ((match = re.exec(text)) !== null) {
		const color = (match[1] ?? match[3]) as MaskColor;
		const content = match[2] ?? match[4] ?? "";
		ranges.push(
			Decoration.replace({
				widget: new MaskTapeWidget(color, content),
				inclusive: false,
			}).range(match.index, match.index + match[0].length)
		);
	}

	return Decoration.set(ranges, true);
}

/** Hide raw [mv|…] tags in editors — show colored tape pill. */
export function maskEditorExtension() {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildMaskDecorations(view);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildMaskDecorations(update.view);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}
