/**
 * Resolve `p`, but give up with `fallback` after `ms`. Used so a hung mobile
 * API (e.g. attachment-path resolution or a vault append) can never leave the
 * UI stuck on "이미지 삽입 중…". Kept dependency-free for unit testing.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
	return Promise.race([
		p.catch(() => fallback),
		new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
	]);
}
