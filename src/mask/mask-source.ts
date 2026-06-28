import { createMaskTapeElement } from "./mask-dom";
import type { InlineMaskSegment, MaskColor } from "./mask-core";

/** Strip common inline markdown for matching rendered preview text. */
export function markdownToPlainDisplay(md: string): string {
	return md
		.replace(/==([^=\n]+?)==/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/_([^_]+)_/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.trim();
}

const TAG_OPEN_RE = /\[mv\|(yellow|red|blue|green)\]|\[\[mv:(yellow|red|blue|green)\]\]/g;
const TAG_CLOSE_RE = /\[\/mv\]|\[\[\/mv\]\]/g;

/** Remove leftover raw mask tag text after wrapping rendered content. */
export function cleanupMaskTagRemnants(container: HTMLElement): void {
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
		const cleaned = (textNode.textContent ?? "")
			.replace(TAG_OPEN_RE, "")
			.replace(TAG_CLOSE_RE, "");
		if (cleaned !== textNode.textContent) textNode.textContent = cleaned;
	}
}

function isAlreadyMasked(el: Element): boolean {
	return el.closest(".mindvas-inline-mask-wrap") != null;
}

function wrapElement(
	el: Element | Text,
	sourceContent: string,
	key: string,
	color: MaskColor
): boolean {
	const parent = el.parentElement;
	if (!parent || isAlreadyMasked(parent)) return false;
	const doc = (el instanceof Text ? el.ownerDocument : el.ownerDocument) ?? document;
	const tape = createMaskTapeElement(sourceContent, key, color, doc);
	el.replaceWith(tape);
	return true;
}

/** Find rendered highlight / text matching mask content and replace with tape widget. */
export function wrapFirstDisplayMatch(
	container: HTMLElement,
	displayText: string,
	sourceContent: string,
	key: string,
	color: MaskColor
): boolean {
	if (!displayText) return false;
	const doc = container.ownerDocument;

	for (const strong of Array.from(container.querySelectorAll("strong, b"))) {
		if (strong.textContent?.trim() === displayText && wrapElement(strong, sourceContent, key, color)) {
			return true;
		}
	}

	for (const mark of Array.from(container.querySelectorAll("mark"))) {
		if (mark.textContent?.trim() === displayText && wrapElement(mark, sourceContent, key, color)) {
			return true;
		}
	}

	for (const el of Array.from(container.querySelectorAll(".hltr, [class*='highlight']"))) {
		if (el.textContent?.trim() === displayText && wrapElement(el, sourceContent, key, color)) {
			return true;
		}
	}

	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const textNode = node as Text;
		const parent = textNode.parentElement;
		if (!parent || isAlreadyMasked(parent)) continue;
		const text = textNode.textContent ?? "";
		const idx = text.indexOf(displayText);
		if (idx < 0) continue;

		if (text === displayText) {
			return wrapElement(textNode, sourceContent, key, color);
		}

		const range = doc.createRange();
		range.setStart(textNode, idx);
		range.setEnd(textNode, idx + displayText.length);
		const frag = range.extractContents();
		const tape = createMaskTapeElement(sourceContent, key, color, doc);
		range.insertNode(tape);
		if (frag.textContent) {
			tape.after(doc.createTextNode(frag.textContent.replace(displayText, "")));
		}
		return true;
	}

	return false;
}

export function applyMasksFromSource(
	container: HTMLElement,
	sourceText: string,
	segments: InlineMaskSegment[],
	keyForIndex: (index: number) => string
): number {
	let applied = 0;
	let maskCount = 0;

	for (const seg of segments) {
		if (seg.type !== "mask" || seg.index === undefined) continue;
		const display = markdownToPlainDisplay(seg.content);
		const key = keyForIndex(maskCount++);
		const color = seg.color ?? "yellow";
		if (wrapFirstDisplayMatch(container, display, seg.content, key, color)) {
			applied++;
		}
	}

	cleanupMaskTagRemnants(container);
	return applied;
}
