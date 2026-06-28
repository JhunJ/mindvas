import type { MaskColor } from "./mask-core";

const STYLE_ID = "mindvas-canvas-mask-styles";

const TAPE_BG: Record<MaskColor, string> = {
	yellow: "rgba(255, 214, 64, 0.93)",
	red: "rgba(255, 120, 120, 0.93)",
	blue: "rgba(120, 170, 255, 0.93)",
	green: "rgba(120, 210, 140, 0.93)",
};

const REVEALED_BG: Record<MaskColor, string> = {
	yellow: "rgba(255, 214, 64, 0.22)",
	red: "rgba(255, 120, 120, 0.22)",
	blue: "rgba(120, 170, 255, 0.22)",
	green: "rgba(120, 210, 140, 0.22)",
};

/** Plugin CSS does not reach canvas card iframes — inject tape rules there. */
export function ensureCanvasMaskStyles(doc: Document = document): void {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
.mindvas-inline-mask-wrap { display: inline !important; }
.mindvas-inline-tape,
.mindvas-inline-revealed {
	display: inline-block !important;
	vertical-align: baseline !important;
	margin: 0 2px !important;
	padding: 2px 10px !important;
	border: none !important;
	border-radius: 4px !important;
	cursor: pointer !important;
	font-size: 0.85em !important;
	line-height: 1.4 !important;
	touch-action: manipulation !important;
	pointer-events: auto !important;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
	color: inherit !important;
	background-image: repeating-linear-gradient(
		-42deg,
		transparent,
		transparent 4px,
		rgba(255, 255, 255, 0.12) 4px,
		rgba(255, 255, 255, 0.12) 8px
	) !important;
}
.mindvas-mask-yellow.mindvas-inline-tape { background-color: ${TAPE_BG.yellow} !important; }
.mindvas-mask-red.mindvas-inline-tape { background-color: ${TAPE_BG.red} !important; }
.mindvas-mask-blue.mindvas-inline-tape { background-color: ${TAPE_BG.blue} !important; }
.mindvas-mask-green.mindvas-inline-tape { background-color: ${TAPE_BG.green} !important; }
.mindvas-mask-yellow.mindvas-inline-revealed { background: ${REVEALED_BG.yellow} !important; }
.mindvas-mask-red.mindvas-inline-revealed { background: ${REVEALED_BG.red} !important; }
.mindvas-mask-blue.mindvas-inline-revealed { background: ${REVEALED_BG.blue} !important; }
.mindvas-mask-green.mindvas-inline-revealed { background: ${REVEALED_BG.green} !important; }
`;
	(doc.head ?? doc.documentElement).appendChild(style);
}

export function resolveCanvasNodeFromEl(el: HTMLElement): HTMLElement | null {
	const direct = el.closest(".canvas-node") as HTMLElement | null;
	if (direct) return direct;
	const frame = el.ownerDocument.defaultView?.frameElement;
	if (frame instanceof HTMLIFrameElement) {
		return frame.closest(".canvas-node") as HTMLElement | null;
	}
	return null;
}

export function isInCanvasCard(el: HTMLElement): boolean {
	return resolveCanvasNodeFromEl(el) != null;
}

export function ensureCanvasMaskStylesForNode(nodeEl: HTMLElement | null | undefined): void {
	if (!nodeEl) return;
	ensureCanvasMaskStyles(nodeEl.ownerDocument);
	for (const iframe of Array.from(nodeEl.querySelectorAll("iframe"))) {
		try {
			const doc = iframe.contentDocument;
			if (doc) ensureCanvasMaskStyles(doc);
		} catch {
			// ignore
		}
	}
}

function tapeColor(el: HTMLElement): MaskColor {
	const fromData = el.dataset.mindvasColor as MaskColor | undefined;
	if (fromData) return fromData;
	const wrap = el.closest(".mindvas-inline-mask-wrap") as HTMLElement | null;
	const fromWrap = wrap?.dataset.mindvasColor as MaskColor | undefined;
	if (fromWrap) return fromWrap;
	for (const c of ["yellow", "red", "blue", "green"] as MaskColor[]) {
		if (el.classList.contains(`mindvas-mask-${c}`)) return c;
	}
	return "yellow";
}

/** Inline styles — required inside canvas card iframes. */
export function applyCanvasTapeInlineStyle(el: HTMLElement, color: MaskColor, revealed: boolean): void {
	el.style.setProperty("display", "inline-block", "important");
	el.style.setProperty("vertical-align", "baseline", "important");
	el.style.setProperty("margin", "0 2px", "important");
	el.style.setProperty("padding", "2px 10px", "important");
	el.style.setProperty("border-radius", "4px", "important");
	el.style.setProperty("border", "none", "important");
	el.style.setProperty("cursor", "pointer", "important");
	el.style.setProperty("font-size", "0.85em", "important");
	el.style.setProperty("line-height", "1.4", "important");
	el.style.setProperty("box-shadow", "0 1px 2px rgba(0, 0, 0, 0.08)", "important");
	el.style.setProperty("color", "inherit", "important");
	el.style.setProperty("background-color", revealed ? REVEALED_BG[color] : TAPE_BG[color], "important");
	if (!revealed) {
		el.style.setProperty(
			"background-image",
			"repeating-linear-gradient(-42deg, transparent, transparent 4px, rgba(255,255,255,0.12) 4px, rgba(255,255,255,0.12) 8px)",
			"important"
		);
	} else {
		el.style.removeProperty("background-image");
	}
}

export function restyleTapeElement(el: HTMLElement): void {
	if (!isInCanvasCard(el)) return;
	const canvasNode = resolveCanvasNodeFromEl(el);
	if (canvasNode) ensureCanvasMaskStylesForNode(canvasNode);
	ensureCanvasMaskStyles(el.ownerDocument);
	const color = tapeColor(el);
	const revealed = el.classList.contains("mindvas-inline-revealed");
	applyCanvasTapeInlineStyle(el, color, revealed);
}

export function restyleAllTapesUnder(root: ParentNode): void {
	for (const el of Array.from(root.querySelectorAll(".mindvas-inline-tape, .mindvas-inline-revealed"))) {
		if (el instanceof HTMLElement) restyleTapeElement(el);
	}
}
