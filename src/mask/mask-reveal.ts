/** Session-only: what is currently revealed (tap to show). */
const revealedKeys = new Set<string>();

export function isRevealed(key: string): boolean {
	return revealedKeys.has(key);
}

export function setRevealed(key: string, revealed: boolean): void {
	if (revealed) revealedKeys.add(key);
	else revealedKeys.delete(key);
}

export function toggleRevealed(key: string): boolean {
	const next = !isRevealed(key);
	setRevealed(key, next);
	return next;
}

export function coverAll(): void {
	revealedKeys.clear();
}

export function revealAllKeys(keys: string[]): void {
	for (const k of keys) revealedKeys.add(k);
}
