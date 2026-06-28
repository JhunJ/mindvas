import "obsidian";

declare module "obsidian" {
	interface MenuItem {
		/** Obsidian built-in submenu (undocumented but stable). */
		setSubmenu(): Menu;
	}
}
