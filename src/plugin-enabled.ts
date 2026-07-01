/** Global gate — when false, Mindvas canvas/note hooks become no-ops. */

let enabledCheck: () => boolean = () => true;

export function setMindvasEnabledCheck(fn: () => boolean): void {
	enabledCheck = fn;
}

export function isMindvasEnabled(): boolean {
	return enabledCheck();
}
