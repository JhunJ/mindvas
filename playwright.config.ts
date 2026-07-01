import { defineConfig, devices } from "@playwright/test";

/**
 * Emulates a Galaxy-Tab-like touch device (coarse pointer, touch events, large
 * viewport) so the mask/drag gesture logic can be verified without hardware.
 */
export default defineConfig({
	testDir: "./test",
	fullyParallel: true,
	reporter: [["list"]],
	use: {
		hasTouch: true,
		isMobile: true,
		viewport: { width: 1280, height: 800 },
	},
	projects: [
		{
			name: "tablet-chromium",
			use: { ...devices["Desktop Chrome"], hasTouch: true, isMobile: true, viewport: { width: 1280, height: 800 } },
		},
	],
});
