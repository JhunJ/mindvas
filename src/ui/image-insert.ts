import { Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import type { CanvasAPI } from "../canvas/canvas-api";
import { resolveCanvasFilePath } from "../mask/mask-canvas";
import { resolveMaskTargetNode } from "../mask/mask-selection";

type AttachmentApp = App & {
	fileManager: {
		getAvailablePathForAttachment?: (fileName: string, sourcePath?: string) => Promise<string>;
	};
};

/** Save picked image bytes into the vault's attachment folder. */
async function saveImageToVault(
	app: App,
	file: File,
	canvasPath: string
): Promise<TFile | null> {
	const buf = await file.arrayBuffer();
	const safeName = file.name && file.name.trim() ? file.name : `pasted-image-${Date.now()}.png`;

	const fm = (app as AttachmentApp).fileManager;
	let targetPath = safeName;
	try {
		if (typeof fm.getAvailablePathForAttachment === "function") {
			targetPath = await fm.getAvailablePathForAttachment(safeName, canvasPath);
		}
	} catch {
		targetPath = safeName;
	}

	try {
		return await app.vault.createBinary(targetPath, buf);
	} catch (err) {
		console.error("Mindvas: failed to save image to vault", err);
		return null;
	}
}

/**
 * Rough intrinsic size for the image so the node isn't distorted.
 * Never hangs — resolves to a default after a short timeout.
 */
function readImageSize(file: File): Promise<{ width: number; height: number }> {
	return new Promise((resolve) => {
		let settled = false;
		const url = URL.createObjectURL(file);
		const finish = (w: number, h: number) => {
			if (settled) return;
			settled = true;
			URL.revokeObjectURL(url);
			resolve({ width: w || 400, height: h || 300 });
		};
		const timer = setTimeout(() => finish(400, 300), 1000);
		const img = new Image();
		img.onload = () => {
			clearTimeout(timer);
			finish(img.naturalWidth, img.naturalHeight);
		};
		img.onerror = () => {
			clearTimeout(timer);
			finish(0, 0);
		};
		img.src = url;
	});
}

/** Fit an image into a sensible canvas node size (cap the longest edge). */
function fitNodeSize(w: number, h: number): { width: number; height: number } {
	const MAX = 480;
	if (w <= MAX && h <= MAX) return { width: Math.max(w, 80), height: Math.max(h, 80) };
	const scale = MAX / Math.max(w, h);
	return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** Build an embed link (![[...]]) for an image file, relative to sourcePath. */
function imageEmbedLink(app: App, imageFile: TFile, sourcePath: string): string {
	let link = app.fileManager.generateMarkdownLink(imageFile, sourcePath);
	if (!link.startsWith("!")) link = "!" + link;
	return link;
}

/** Add the image into an already-selected note/file card. */
async function embedIntoFileNode(
	app: App,
	filePath: string,
	imageFile: TFile
): Promise<boolean> {
	const tf = app.vault.getAbstractFileByPath(filePath);
	if (!(tf instanceof TFile)) return false;
	const link = imageEmbedLink(app, imageFile, filePath);
	await app.vault.append(tf, `\n\n${link}\n`);
	return true;
}

/** Add the image into an already-selected text card. */
function embedIntoTextNode(
	app: App,
	canvas: Canvas,
	node: CanvasNode,
	imageFile: TFile,
	canvasPath: string
): boolean {
	if (typeof node.setText !== "function") return false;
	const link = imageEmbedLink(app, imageFile, canvasPath);
	const current = node.text ?? "";
	node.setText(current ? `${current}\n\n${link}` : link);
	canvas.requestSave();
	return true;
}

/**
 * Prompt for an image (desktop + mobile). If a note/file or text card is
 * selected, embed the image inside it; otherwise drop a new image node at the
 * center of the viewport.
 */
export function insertImageToCanvas(
	app: App,
	canvas: Canvas,
	canvasApi: CanvasAPI,
	canvasPath: string
): void {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "image/*";
	input.style.display = "none";

	input.addEventListener(
		"change",
		async () => {
			const file = input.files?.[0];
			input.remove();
			if (!file) return;

			const notice = new Notice("이미지 삽입 중…", 0);
			// Safety net: the progress notice always clears within 15s.
			const safety = setTimeout(() => notice.hide(), 15000);
			try {
				// Read the intrinsic size in parallel with the vault write so the
				// two slow steps overlap instead of adding up (matters on tablets).
				const sizePromise = readImageSize(file);
				const imageFile = await saveImageToVault(app, file, canvasPath);
				if (!imageFile) {
					new Notice("이미지 저장 실패");
					return;
				}

				// On mobile the selection clears the moment the FAB/button is tapped,
				// so fall back to the last remembered card (same as masking does).
				const target =
					canvasApi.getSelectedNode(canvas) ?? resolveMaskTargetNode(canvas, canvasApi);
				if (target) {
					const targetFilePath = resolveCanvasFilePath(target);
					if (targetFilePath) {
						if (await embedIntoFileNode(app, targetFilePath, imageFile)) {
							new Notice("선택한 노트에 이미지를 추가했습니다");
							try {
								canvas.selectOnly(target);
							} catch {
								// best-effort
							}
							return;
						}
					} else if (embedIntoTextNode(app, canvas, target, imageFile, canvasPath)) {
						new Notice("선택한 카드에 이미지를 추가했습니다");
						return;
					}
				}

				// Nothing suitable selected — create a standalone image node.
				const { width, height } = await sizePromise;
				const size = fitNodeSize(width, height);
				const center = canvasApi.getViewportCenter(canvas);
				const node = canvasApi.createFileNode(
					canvas,
					imageFile.path,
					center.x - size.width / 2,
					center.y - size.height / 2,
					size.width,
					size.height
				);
				if (!node) {
					new Notice("이 캔버스에서 이미지 노드를 만들 수 없습니다");
					return;
				}
				canvas.requestSave();
				try {
					// Select only — do NOT auto-zoom to the image. The forced
					// zoom felt like a "stuck zoomed-in" state on tablets.
					canvas.selectOnly(node);
				} catch {
					// best-effort
				}
				new Notice("이미지를 삽입했습니다");
			} catch (err) {
				console.error("Mindvas: image insert failed", err);
				new Notice("이미지 삽입 실패");
			} finally {
				clearTimeout(safety);
				notice.hide();
			}
		},
		{ once: true }
	);

	document.body.appendChild(input);
	input.click();
}
