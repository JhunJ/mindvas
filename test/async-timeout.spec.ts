import { test, expect } from "@playwright/test";
import { withTimeout } from "../src/ui/async-timeout";

test("resolves the underlying promise when it settles in time", async () => {
	const result = await withTimeout(Promise.resolve("value"), 1000, "fallback");
	expect(result).toBe("value");
});

test("falls back when the promise never settles (no hang)", async () => {
	const never = new Promise<string>(() => {
		/* never resolves — simulates a hung mobile API */
	});
	const start = Date.now();
	const result = await withTimeout(never, 50, "fallback");
	expect(result).toBe("fallback");
	expect(Date.now() - start).toBeLessThan(1000);
});

test("falls back when the promise rejects", async () => {
	const result = await withTimeout(Promise.reject(new Error("boom")), 1000, "fallback");
	expect(result).toBe("fallback");
});
