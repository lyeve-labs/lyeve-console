/**
 * What a page may ask of the app shell around it.
 *
 * The layout mounts AppShell and a page never sees it, so a page that wants
 * the frame out of its way needs a channel up, because the layout reads its
 * own load and nothing else. This is context rather than
 * a module-level `$state`, because a module is one object for every request
 * the server renders and a page's ask would leak into the next reader's
 * frame. Context is scoped to the tree the layout mounts. It is not a store,
 * which the console does not use.
 */
import { getContext, setContext } from 'svelte';

export interface Shell {
	/** The page owns the viewport: the sidebar narrows to the icon rail and the header bar goes. */
	focus: boolean;
}

export const SHELL_KEY = Symbol('lyeve-console-shell');

/** The layout calls this once. The object it gets back is what it binds the shell to. */
export function provideShell(): Shell {
	const shell = $state<Shell>({ focus: false });
	setContext(SHELL_KEY, shell);
	return shell;
}

/** A page reads this. It is undefined when it renders outside the layout, as under a unit test. */
export function useShell(): Shell | undefined {
	return getContext<Shell | undefined>(SHELL_KEY);
}
