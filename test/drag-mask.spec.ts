import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as url from "url";

const harnessUrl = url.pathToFileURL(path.resolve(__dirname, "harness/index.html")).href;

interface CardState {
	id: string;
	x: number;
	y: number;
	masked: boolean;
	revealed: boolean;
	dragCancelled: boolean;
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

/** Fire a stationary tap (pointerdown+up at the card centre). */
async function tap(page: Page, id: string): Promise<void> {
	await page.evaluate((id) => {
		const el = document.querySelector(`.canvas-node[data-id="${id}"]`) as HTMLElement;
		const r = el.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		const fire = (t: string) =>
			el.dispatchEvent(
				new PointerEvent(t, { pointerId: 1, pointerType: "touch", clientX: cx, clientY: cy, bubbles: true, cancelable: true })
			);
		fire("pointerdown");
		fire("pointerup");
	}, id);
}

/** Drag a card by (dx,dy) in `steps`; optionally run a maintenance sweep mid-drag. */
async function drag(
	page: Page,
	id: string,
	dx: number,
	dy: number,
	opts: { midSweep?: boolean } = {}
): Promise<void> {
	await page.evaluate(
		({ id, dx, dy, midSweep }) => {
			const el = document.querySelector(`.canvas-node[data-id="${id}"]`) as HTMLElement;
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
				if (midSweep && i === 3) (window as any).harness.runMaintenanceSweep();
			}
			fire("pointerup", cx + dx, cy + dy);
		},
		{ id, dx, dy, midSweep: opts.midSweep ?? false }
	);
}

test.beforeEach(async ({ page }) => {
	await page.goto(harnessUrl);
	await reset(page, true);
});

test("stationary tap on a masked card toggles reveal", async ({ page }) => {
	expect((await getState(page, "A")).revealed).toBe(false);
	await tap(page, "A");
	expect((await getState(page, "A")).revealed).toBe(true);
	await tap(page, "A");
	expect((await getState(page, "A")).revealed).toBe(false);
});

test("dragging an unmasked card moves it", async ({ page }) => {
	const before = await getState(page, "B");
	await drag(page, "B", 120, 0);
	const after = await getState(page, "B");
	expect(after.x).toBeCloseTo(before.x + 120, 0);
});

test("dragging a masked card moves it and does NOT toggle reveal", async ({ page }) => {
	const before = await getState(page, "A");
	await drag(page, "A", 100, 60);
	const after = await getState(page, "A");
	expect(after.x).toBeCloseTo(before.x + 100, 0);
	expect(after.y).toBeCloseTo(before.y + 60, 0);
	expect(after.revealed).toBe(false);
	expect(after.dragCancelled).toBe(false);
});

test("with suppression ON, a mid-drag re-render does not cancel the drag", async ({ page }) => {
	const before = await getState(page, "A");
	await drag(page, "A", 150, 0, { midSweep: true });
	const after = await getState(page, "A");
	expect(after.dragCancelled).toBe(false);
	expect(after.x).toBeCloseTo(before.x + 150, 0);
});

test("control: with suppression OFF, a mid-drag re-render cancels the drag", async ({ page }) => {
	await reset(page, false);
	const before = await getState(page, "A");
	await drag(page, "A", 150, 0, { midSweep: true });
	const after = await getState(page, "A");
	// The sweep fired at 3/5 of the drag, rebuilding the card and cancelling it.
	expect(after.dragCancelled).toBe(true);
	expect(after.x).toBeLessThan(before.x + 150);
});
