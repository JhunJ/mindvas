import { normalizeMaskSyntax, attachTapeToggle, parseInlineMasks, type MaskColor } from "./mask-core";
import { isRevealed, toggleRevealed } from "./mask-reveal";
import { markdownToPlainDisplay } from "./mask-source";
import { applyMaskColorClass } from "./mask-colors";
import {
	resolveCanvasNodeFromEl,
	ensureCanvasMaskStylesForNode,
	restyleTapeElement,
} from "./mask-canvas-styles";

function finalizeTapeEl(wrap: HTMLElement, tapeEl: HTMLElement, color: MaskColor): void {
	const canvasNode = resolveCanvasNodeFromEl(wrap);
	if (canvasNode) ensureCanvasMaskStylesForNode(canvasNode);
	restyleTapeElement(tapeEl);
}

const MASK_IN_TEXT_RE = /\[mv\|(yellow|red|blue|green)\]([\s\S]*?)\[\/mv\]/g;

const PREVIEW_ROOT_SELECTORS = [
	".markdown-preview-sizer",
	".markdown-preview-view",
	".markdown-reading-view",
	".markdown-rendered",
	".markdown-embed-content",
	".embed-content",
	".internal-embed",
	".canvas-node-content",
] as const;

function queryPreviewRoot(root: ParentNode): HTMLElement | null {
	for (const sel of PREVIEW_ROOT_SELECTORS) {
		const el = root.querySelector<HTMLElement>(sel);
		if (el) return el;
	}
	return null;
}

function stampMaskEl(el: HTMLElement, key: string, content?: string): void {
	el.dataset.mindvasKey = key;
	if (content !== undefined) el.dataset.mindvasContent = content;
}

function bindWrapToggle(wrap: HTMLElement, content: string, key: string): void {
	if (wrap.dataset.mindvasBound === key) return;
	wrap.dataset.mindvasBound = key;

	const onToggle = (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		toggleRevealed(key);
		const color = (wrap.dataset.mindvasColor as MaskColor | undefined) ?? "yellow";
		refreshMaskTapeElement(wrap, content, key, color);
	};

	wrap.addEventListener("pointerup", onToggle, { capture: true });
	wrap.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onToggle(e);
		}
	});
}

/** Build inline tape widget — tap to show / hide. */
export function createMaskTapeElement(
	content: string,
	key: string,
	color: MaskColor = "yellow",
	doc: Document = document
): HTMLElement {
	const wrap = doc.createElement("span");
	wrap.className = "mindvas-inline-mask-wrap mindvas-mask-ui";
	stampMaskEl(wrap, key, content);
	applyMaskColorClass(wrap, color);
	bindWrapToggle(wrap, content, key);
	refreshMaskTapeElement(wrap, content, key, color);
	return wrap;
}

export function refreshMaskTapeElement(
	wrap: HTMLElement,
	content: string,
	key: string,
	color: MaskColor = "yellow"
): void {
	const doc = wrap.ownerDocument;
	stampMaskEl(wrap, key, content);
	applyMaskColorClass(wrap, color);
	bindWrapToggle(wrap, content, key);

	const tapeHost = wrap.querySelector(":scope > .mindvas-inline-tape, :scope > .mindvas-inline-revealed");
	if (tapeHost instanceof HTMLElement) {
		applyMaskColorClass(tapeHost, color);
		if (isRevealed(key)) {
			if (tapeHost.classList.contains("mindvas-inline-revealed")) {
				tapeHost.textContent = markdownToPlainDisplay(content);
				finalizeTapeEl(wrap, tapeHost, color);
				return;
			}
		} else if (tapeHost.classList.contains("mindvas-inline-tape")) {
			const plain = markdownToPlainDisplay(content);
			tapeHost.textContent = "●".repeat(Math.min(Math.max(plain.length, 3), 10));
			finalizeTapeEl(wrap, tapeHost, color);
			return;
		}
	}

	wrap.replaceChildren();

	if (isRevealed(key)) {
		const shown = doc.createElement("span");
		shown.className = "mindvas-inline-revealed mindvas-mask-ui";
		shown.textContent = markdownToPlainDisplay(content);
		shown.title = "탭하여 다시 가리기";
		stampMaskEl(shown, key, content);
		applyMaskColorClass(shown, color);
		attachTapeToggle(shown);
		wrap.appendChild(shown);
		finalizeTapeEl(wrap, shown, color);
		return;
	}

	const tape = doc.createElement("span");
	tape.className = "mindvas-inline-tape mindvas-mask-ui";
	tape.setAttribute("role", "button");
	tape.tabIndex = 0;
	tape.title = "탭하여 보기";
	const plain = markdownToPlainDisplay(content);
	tape.textContent = "●".repeat(Math.min(Math.max(plain.length, 3), 10));
	stampMaskEl(tape, key, content);
	applyMaskColorClass(tape, color);
	applyMaskColorClass(wrap, color);
	attachTapeToggle(tape);
	wrap.appendChild(tape);
	finalizeTapeEl(wrap, tape, color);
}

/** Remove all mask widgets and restore plain display text. */
export function stripAllMaskWraps(container: HTMLElement): void {
	for (const wrap of Array.from(container.querySelectorAll(".mindvas-inline-mask-wrap"))) {
		const content = (wrap as HTMLElement).dataset.mindvasContent;
		const text = content ? markdownToPlainDisplay(content) : (wrap.textContent ?? "");
		wrap.replaceWith(container.ownerDocument.createTextNode(text));
	}
}

/** Update existing wraps (keep DOM + click handlers) after Obsidian re-renders. */
export function refreshExistingMaskWraps(
	container: HTMLElement,
	sourceText: string,
	keyForIndex: (index: number) => string
): boolean {
	const masks = parseInlineMasks(sourceText).filter((s) => s.type === "mask");
	const wraps = container.querySelectorAll<HTMLElement>(".mindvas-inline-mask-wrap");
	if (wraps.length === 0 || masks.length === 0) return false;
	if (wraps.length !== masks.length) return false;

	wraps.forEach((wrap, i) => {
		const seg = masks[i];
		if (!seg) return;
		refreshMaskTapeElement(wrap, seg.content, keyForIndex(i), seg.color ?? "yellow");
	});
	cleanupMaskTagRemnants(container);
	return true;
}

/** Replace raw [mv|…] tags in a rendered container (notes, canvas file cards). */
export function processMaskTagsInContainer(
	container: HTMLElement,
	keyForIndex: (index: number) => string
): boolean {
	const doc = container.ownerDocument;
	let changed = false;
	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];

	let n: Node | null;
	while ((n = walker.nextNode())) {
		const el = n.parentElement;
		if (el?.closest(".mindvas-inline-mask-wrap, .mindvas-mask-preview, .mindvas-mask-tape")) continue;
		const t = n.textContent ?? "";
		if (t.includes("[mv|") || t.includes("[[mv:")) textNodes.push(n as Text);
	}

	for (const textNode of textNodes) {
		if (replaceTextNodeMasks(textNode, keyForIndex)) changed = true;
	}
	return changed;
}

function replaceTextNodeMasks(
	textNode: Text,
	keyForIndex: (index: number) => string
): boolean {
	const doc = textNode.ownerDocument;
	const text = normalizeMaskSyntax(textNode.textContent ?? "");
	MASK_IN_TEXT_RE.lastIndex = 0;
	if (!MASK_IN_TEXT_RE.test(text)) return false;
	MASK_IN_TEXT_RE.lastIndex = 0;

	const frag = doc.createDocumentFragment();
	let last = 0;
	let maskIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = MASK_IN_TEXT_RE.exec(text)) !== null) {
		if (match.index > last) {
			frag.appendChild(doc.createTextNode(text.slice(last, match.index)));
		}
		const key = keyForIndex(maskIndex++);
		const color = match[1] as MaskColor;
		frag.appendChild(createMaskTapeElement(match[2], key, color, doc));
		last = MASK_IN_TEXT_RE.lastIndex;
	}

	if (last < text.length) {
		frag.appendChild(doc.createTextNode(text.slice(last)));
	}

	textNode.parentNode?.replaceChild(frag, textNode);
	return true;
}

export function findNodePreviewRoot(nodeEl: HTMLElement): HTMLElement | null {
	const direct = queryPreviewRoot(nodeEl);
	if (direct) return direct;

	const iframe = nodeEl.querySelector<HTMLIFrameElement>("iframe");
	if (iframe?.contentDocument?.body) {
		return queryPreviewRoot(iframe.contentDocument.body);
	}

	return nodeEl.querySelector<HTMLElement>(".canvas-node-content");
}

/** All DOM roots that may contain mask tag text inside a canvas card. */
export function collectMaskRoots(nodeEl: HTMLElement): HTMLElement[] {
	const roots = new Set<HTMLElement>();
	roots.add(nodeEl);

	const direct = findNodePreviewRoot(nodeEl);
	if (direct) roots.add(direct);

	const iframe = nodeEl.querySelector<HTMLIFrameElement>("iframe");
	const iframeBody = iframe?.contentDocument?.body;
	if (iframeBody) {
		roots.add(iframeBody);
		const inFrame = findNodePreviewRoot(iframeBody);
		if (inFrame) roots.add(inFrame);
	}

	for (const sel of PREVIEW_ROOT_SELECTORS) {
		nodeEl.querySelectorAll<HTMLElement>(sel).forEach((el) => roots.add(el));
	}

	return Array.from(roots);
}

export function countMaskWraps(nodeEl: HTMLElement): number {
	return nodeEl.querySelectorAll(".mindvas-inline-mask-wrap").length;
}

export function previewHasMaskTags(nodeEl: HTMLElement): boolean {
	const root = findNodePreviewRoot(nodeEl);
	if (!root) return false;
	const t = root.textContent ?? "";
	return t.includes("[mv|") || t.includes("[[mv:");
}

export function isMaskInteractionTarget(target: EventTarget | null): boolean {
	return (
		(target as HTMLElement)?.closest?.(
			".mindvas-mask-ui, .mindvas-mask-tape, .mindvas-mask-preview, .mindvas-inline-mask-wrap"
		) != null
	);
}

const TAG_OPEN_RE = /\[mv\|(yellow|red|blue|green)\]|\[\[mv:(yellow|red|blue|green)\]\]/g;
const TAG_CLOSE_RE = /\[\/mv\]|\[\[\/mv\]\]/g;

function cleanupMaskTagRemnants(container: HTMLElement): void {
	const doc = container.ownerDocument;
	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let n: Node | null;
	while ((n = walker.nextNode())) {
		const el = n.parentElement;
		if (el?.closest(".mindvas-inline-mask-wrap")) continue;
		const t = n.textContent ?? "";
		if (TAG_OPEN_RE.test(t) || TAG_CLOSE_RE.test(t)) nodes.push(n as Text);
	}
	TAG_OPEN_RE.lastIndex = 0;
	TAG_CLOSE_RE.lastIndex = 0;
	for (const textNode of nodes) {
		textNode.textContent = (textNode.textContent ?? "")
			.replace(TAG_OPEN_RE, "")
			.replace(TAG_CLOSE_RE, "");
	}
}
