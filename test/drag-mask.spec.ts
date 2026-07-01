import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as url from "url";

const harnessUrl = url.pathToFileURL(path.resolve(__dirname, "harness/index.html")).href;

interface CardState {
	id: string;
	x: number;
	y: number;
	kind: "whole" | "plain" | "inline";
	revealed: boolean;
	inlineRevealed: boolean;
	dragCancelled: boolean;
	maskVisible: boolean;
}

async function reset(page: Page, suppressDuringTouch: boolean): Promise<void> {
	await page.evaluate((s) => {
		(window as any).harness.reset({ suppressDuringTouch: s });
	}, suppressDuringTouch);
}

async function getState(page: Page, id: string): Promise<CardState> {
	const s = await page.evaluate((id) => (window as any).harness.getState(id), id);
	expect(s, `card ${id} should exist`).not.toBeNull();
	return s as CardState;
}

/** Tap (pointerdown+up, no movement) at the centre of a CSS-selected element. */
async function tapEl(page: Page, selector: string): Promise<void> {
	await page.evaluate((selector) => {
		const el = document.querySelector(selector) as HTMLElement;
		const r = el.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		const fire = (t: string) =>
			el.dispatchEvent(
				new PointerEvent(t, { pointerId: 1, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true, cancelable: true })
			);
		fire("pointerdown");
		fire("pointerup");
	}, selector);
}

/** Drag from the centre of a CSS-selected element by (dx,dy). */
async function dragEl(
	page: Page,
	selector: string,
	dx: number,
	dy: number,
	opts: { midDropAndSweep?: string } = {}
): Promise<void> {
	await page.evaluate(
		({ selector, dx, dy, dropId }) => {
			const el = document.querySelector(selector) as HTMLElement;
			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const fire = (t: string, x: number, y: number) =>
				el.dispatchEvent(
					new PointerEvent(t, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true })
				);
			fire("pointerdown", cx, cy);
			const steps = 5;
			for (let i = 1; i <= steps; i++) {
				fire("pointermove", cx + (dx * i) / steps, cy + (dy * i) / steps);
				// Mid-drag: Obsidian clears our mask overlay, then our maintenance
				// sweep tries to restore it. That restore (a content rebuild) is what
				// can cancel the drag — unless suppression skips it during the touch.
				if (dropId && i === 3) {
					(window as any).harness.externalReRender(dropId);
					(window as any).harness.runMaintenanceSweep();
				}
			}
			fire("pointerup", cx + dx, cy + dy);
		},
		{ selector, dx, dy, dropId: opts.midDropAndSweep ?? null }
	);
}

/** Drag starting at an absolute point (used for empty-canvas box-select). */
async function dragFromPoint(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
	await page.evaluate(
		({ x, y, dx, dy }) => {
			const wrapper = document.getElementById("canvas-wrapper") as HTMLElement;
			const fire = (t: string, px: number, py: number) =>
				wrapper.dispatchEvent(
					new PointerEvent(t, { pointerId: 1, pointerType: "touch", clientX: px, clientY: py, bubbles: true, cancelable: true })
				);
			fire("pointerdown", x, y);
			const steps = 5;
			for (let i = 1; i <= steps; i++) fire("pointermove", x + (dx * i) / steps, y + (dy * i) / steps);
			fire("pointerup", x + dx, y + dy);
		},
		{ x, y, dx, dy }
	);
}

/**
 * Long-press then drag: finger goes down, holds STILL past the gesture-idle
 * window (no pointermove), then a mask restore fires, then the card is dragged.
 * This models the real Galaxy-Tab long-press (press, pause, move) that the
 * pointermove-only suppression missed. `holdMs` should exceed GESTURE_IDLE.
 */
async function longPressDrag(page: Page, selector: string, dx: number, dy: number, dropId: string): Promise<void> {
	await page.evaluate(
		({ selector, x0 }) => {
			const el = document.querySelector(selector) as HTMLElement;
			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			(window as any).__lp = { el, cx, cy };
			el.dispatchEvent(
				new PointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true, cancelable: true })
			);
			void x0;
		},
		{ selector, x0: 0 }
	);
	// Hold still, longer than the idle window — during a real long-press no
	// pointermove events fire here.
	await page.waitForTimeout(340);
	await page.evaluate((dropId) => {
		// Obsidian drops the overlay and maintenance tries to restore it while the
		// finger is still down (the imminent drag must survive).
		(window as any).harness.externalReRender(dropId);
		(window as any).harness.runMaintenanceSweep();
	}, dropId);
	await page.evaluate(
		({ dx, dy }) => {
			const { el, cx, cy } = (window as any).__lp as { el: HTMLElement; cx: number; cy: number };
			const fire = (t: string, x: number, y: number) =>
				el.dispatchEvent(
					new PointerEvent(t, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true })
				);
			const steps = 5;
			for (let i = 1; i <= steps; i++) fire("pointermove", cx + (dx * i) / steps, cy + (dy * i) / steps);
			fire("pointerup", cx + dx, cy + dy);
		},
		{ dx, dy }
	);
}

const cardSel = (id: string) => `.canvas-node[data-id="${id}"]`;
const inlineSel = (id: string) => `${cardSel(id)} .mindvas-inline-mask-wrap`;

test.beforeEach(async ({ page }) => {
	await page.goto(harnessUrl);
	await reset(page, true);
});

// --- whole-card mask: tap reveals, drag moves ---

test("whole-card: stationary tap toggles reveal", async ({ page }) => {
	expect((await getState(page, "A")).revealed).toBe(false);
	await tapEl(page, cardSel("A"));
	expect((await getState(page, "A")).revealed).toBe(true);
	await tapEl(page, cardSel("A"));
	expect((await getState(page, "A")).revealed).toBe(false);
});

test("whole-card: drag moves the card and never toggles reveal", async ({ page }) => {
	const before = await getState(page, "A");
	await dragEl(page, cardSel("A"), 100, 60);
	const after = await getState(page, "A");
	expect(after.x).toBeCloseTo(before.x + 100, 0);
	expect(after.y).toBeCloseTo(before.y + 60, 0);
	expect(after.revealed).toBe(false);
	expect(after.dragCancelled).toBe(false);
});

test("plain card drags (baseline)", async ({ page }) => {
	const before = await getState(page, "B");
	await dragEl(page, cardSel("B"), 120, 0);
	expect((await getState(page, "B")).x).toBeCloseTo(before.x + 120, 0);
});

// --- inline mask: tap reveals, drag moves the card ---

test("inline: stationary tap toggles inline reveal without moving the card", async ({ page }) => {
	const before = await getState(page, "C");
	expect(before.inlineRevealed).toBe(false);
	await tapEl(page, inlineSel("C"));
	const after = await getState(page, "C");
	expect(after.inlineRevealed).toBe(true);
	expect(after.x).toBeCloseTo(before.x, 0);
	expect(after.y).toBeCloseTo(before.y, 0);
});

test("inline: dragging over an inline mask moves the card and does not reveal", async ({ page }) => {
	const before = await getState(page, "C");
	await dragEl(page, inlineSel("C"), 90, 40);
	const after = await getState(page, "C");
	expect(after.x).toBeCloseTo(before.x + 90, 0);
	expect(after.y).toBeCloseTo(before.y + 40, 0);
	expect(after.inlineRevealed).toBe(false);
});

// --- box-select vs card gesture ---

test("empty-canvas drag box-selects intersecting cards", async ({ page }) => {
	await dragFromPoint(page, 20, 20, 380, 220);
	const gesture = await page.evaluate(() => (window as any).harness.getLastGesture());
	const selection = await page.evaluate(() => (window as any).harness.getSelection());
	expect(gesture).toBe("box");
	expect(selection).toContain("A");
});

test("dragging on a masked card is a card gesture, not a box-select", async ({ page }) => {
	await dragEl(page, cardSel("A"), 100, 0);
	const gesture = await page.evaluate(() => (window as any).harness.getLastGesture());
	expect(gesture).toBe("card");
});

// --- mid-drag re-render (the intermittent "됐다 안 됐다") ---

test("suppression ON: a mask restore is deferred during touch, so the drag survives", async ({ page }) => {
	const before = await getState(page, "A");
	await dragEl(page, cardSel("A"), 150, 0, { midDropAndSweep: "A" });
	const after = await getState(page, "A");
	expect(after.dragCancelled).toBe(false);
	expect(after.x).toBeCloseTo(before.x + 150, 0);
});

test("control: suppression OFF lets a mid-drag mask restore cancel the drag", async ({ page }) => {
	await reset(page, false);
	const before = await getState(page, "A");
	await dragEl(page, cardSel("A"), 150, 0, { midDropAndSweep: "A" });
	const after = await getState(page, "A");
	expect(after.dragCancelled).toBe(true);
	expect(after.x).toBeLessThan(before.x + 150);
});

// --- long-press then drag (the "됐다가 뭘 건드리면 안 되는" bug) ---

test("long-press: holding still past the idle window then dragging is not cancelled", async ({ page }) => {
	const before = await getState(page, "A");
	await longPressDrag(page, cardSel("A"), 150, 0, "A");
	const after = await getState(page, "A");
	expect(after.dragCancelled).toBe(false);
	expect(after.x).toBeCloseTo(before.x + 150, 0);
});

test("control: with suppression OFF, a long-press hold lets the restore cancel the drag", async ({ page }) => {
	await reset(page, false);
	const before = await getState(page, "A");
	await longPressDrag(page, cardSel("A"), 150, 0, "A");
	const after = await getState(page, "A");
	expect(after.dragCancelled).toBe(true);
	expect(after.x).toBeLessThan(before.x + 150);
});

// --- mask must not vanish after Obsidian re-renders a card (self-heal) ---

test("whole-card mask restored after an external re-render", async ({ page }) => {
	expect((await getState(page, "A")).maskVisible).toBe(true);
	await page.evaluate(() => (window as any).harness.externalReRender("A"));
	expect((await getState(page, "A")).maskVisible).toBe(false);
	await page.evaluate(() => (window as any).harness.runMaintenanceSweep());
	expect((await getState(page, "A")).maskVisible).toBe(true);
});

test("inline mask restored after an external re-render", async ({ page }) => {
	expect((await getState(page, "C")).maskVisible).toBe(true);
	await page.evaluate(() => (window as any).harness.externalReRender("C"));
	expect((await getState(page, "C")).maskVisible).toBe(false);
	await page.evaluate(() => (window as any).harness.runMaintenanceSweep());
	expect((await getState(page, "C")).maskVisible).toBe(true);
});
