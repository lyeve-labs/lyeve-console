# Contributing to `@lyeve/console`

This guide is short. The git hooks and CI enforce the rest.

## Quick start

The toolchain is Node 26 and pnpm, at the versions `mise.toml` pins. pnpm is
the only package manager: an install through any other one stops before it
starts, because pnpm enforces the supply-chain policies this repository sets.

```sh
pnpm install                       # installs deps and the commitlint and svelte-check hooks
git checkout dev && git pull
git checkout -b feat/my-thing
# ... make changes ...
git commit -m "feat(schema): add drag handle to canvas nodes"
git push -u origin feat/my-thing   # open a PR against `dev`
```

## Building and running against an engine

This repository builds and tests on its own: `pnpm check`, `pnpm test` and
`pnpm build` need nothing outside it. Running the UI needs an engine to talk
to, and any lyeve-core build works, including `make build-kernel`, which
builds the engine with no plugins. The UI shows the pages of the plugins the
engine runs. The README's "Quick start" section shows the proxy targets.

## The four phases

Changes move through four phases.

| # | Phase    | When                              | What happens                                                       |
|---|----------|-----------------------------------|--------------------------------------------------------------------|
| 1 | Validate | on every pull request into `dev` or `main`, on a release tag (called by `release.yml`), or dispatched by a maintainer against a branch | `ci.yml`: secret scan, svelte-check, lint:ui, pnpm audit, vitest, build |
| 2 | Release  | release PR from `dev` into `main` | A person reviews and merges it. Nothing is automated here          |
| 3 | Tag      | annotated `vX.Y.Z` on `main`      | Cut by a person, with the CHANGELOG entry in the same commit       |
| 4 | Publish  | on tag push                       | `release.yml`: requires a green `ci` run on the tagged commit, then builds and publishes `ghcr.io/lyeve-labs/lyeve-console:<tag>` |

Your commit type determines the version bump and the CHANGELOG section the
entry lands in:

| Commit type | Bump | CHANGELOG section |
|-------------|------|-------------------|
| `feat:`     | minor | Added |
| `fix:`      | patch | Fixed |
| `perf:` `refactor:` `revert:` `docs:` | patch | Changed |
| `deps:`     | patch | Dependencies |
| `feat!:` or `BREAKING CHANGE:` footer | minor, not major, while the version is below 1.0 | Added, with a breaking marker |
| `test:` `build:` `ci:` `chore:` `style:` | none | hidden |

While the version is below 1.0.0, a breaking change and a `feat:` both bump
minor rather than major or patch. That changes the day the version reaches
1.0.0.

## Branches

`dev` is the integration branch. `main` is production and
carries the release tags. Both take merges only. **Branch off `dev` and open the
PR back into `dev`**, and rebase onto `dev` rather than merging it into your branch.
Only a hotfix branches off `main`, and it must be merged back into `dev`.

- `feat/<short-slug>`: new functionality
- `fix/<short-slug>`: bug fixes
- `hotfix/<short-slug>`: urgent production fix, the only type cut from `main`
- `chore/<short-slug>`: repo maintenance, tooling
- `docs/<short-slug>`: documentation only
- `refactor/` `perf/` `test/` `ci/`: as their names say

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/).
The `commit-msg` git hook (installed by `pnpm install`) will reject anything
that doesn't parse. The format:

```
<type>(<optional scope>): <subject>

<optional body>

<optional footer(s)>
```

Examples that pass:

```
feat(schema): add drag handle to canvas nodes
fix(auth): clear sys_session cookie on 401
perf(content): debounce autosave to 500ms
deps: bump @sveltejs/kit to 2.5.18
feat!: remove deprecated /api/v0 client

BREAKING CHANGE: Consumers must migrate to /api/v1. See MIGRATION.md.
```

Examples that fail:

| Message | Why it fails |
|---|---|
| `Add new thing` | no type |
| `feat: Added new thing` | the subject starts in upper case |
| `fix: fixed the bug.` | the subject ends with a period |
| `update` | no type, and it says nothing |

## Developer Certificate of Origin

Contributions are accepted under the repository's MIT license. Every commit
must carry a `Signed-off-by:` line with your name and email, which certifies
that you wrote the change or have the right to submit it under that license, as
set out in the [Developer Certificate of Origin 1.1](https://developercertificate.org).
`git commit -s` adds the line. A pull request with an unsigned commit is not
merged until the commit is amended.

## PR rules

1. Open against `dev`. Never push directly to `dev` or `main`. A PR merges once it is reviewed.
2. Keep PRs small and focused. One logical change per PR.
3. The PR title becomes the message of the merge commit, so it must be a
   valid Conventional Commit. The maintainer who merges checks it.
4. The local checks below pass, and so does `ci.yml`, which runs on every pull
   request.
5. At least one approving review from a maintainer.

## Releasing

A maintainer releases by hand. The flow is:

1. Merge feature and fix PRs into `dev` with valid Conventional Commit titles.
2. When `dev` is ready, a maintainer opens a release PR into `main` from a
   release branch cut at `dev`'s commit, then reviews and merges it.
3. Tag `main` with an annotated `vX.Y.Z`. The CHANGELOG entry and the
   `package.json` version are written in the release commit itself. A
   published tag is never moved or deleted. A bad release is superseded by
   the next patch.
4. The `release.yml` workflow requires a green `ci` run on the tagged commit,
   then publishes `ghcr.io/lyeve-labs/lyeve-console:vX.Y.Z`.

## Local checks before pushing

```sh
pnpm run check     # svelte-kit sync + svelte-check
pnpm run test      # vitest
pnpm run lint:ui   # the UI consistency rules
pnpm run build     # SvelteKit production build
```

The git hooks run svelte-check and commitlint. The full set runs in `ci.yml` on
every pull request and every release tag.

## Code conventions

- Svelte 5 runes only. No `writable()`, no `$:` reactive statements.
- Reads go through `+page.server.ts` load functions and writes through form
  actions. A component never calls the API, with three exceptions: the import
  wizard and the media upload send a file from the browser straight to the
  engine, because a file can exceed the console's own body limit, and the
  flow editor validates a draft while it is edited.
- `structuredClone` fails on Svelte 5 reactive proxies. Use
  `JSON.parse(JSON.stringify(x))` instead.
- `svelte-dnd-action` items need stable `id` properties. Stamp them with
  `crypto.randomUUID()` in the browser and strip them before sending to the
  server.
- Primitives (`Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Toggle`,
  `Label`, `Badge`, `Modal`, `Alert`) come from `@lyeve-labs/ui-kit`. Only
  components specific to the console live in `$lib/components/`.
- Tests are colocated and run under vitest with `@testing-library/svelte`.
  Component files opt into jsdom per file with `// @vitest-environment jsdom`.
  The default environment stays node, so the server-rendered paths stay
  testable.

## Measuring small screens

`pnpm run measure:small-screens` visits every route at phone, tablet and
desktop width, against a running dev server and an admin account on the
engine behind it. It reports horizontal overflow, controls under 44px, text
under 12px, tables without a scroll box, rows that refuse to wrap, dialogs
taller than the window, a drawer that cannot be closed, the primary action
off screen, and the desktop fold, and saves one screenshot per page per
width. Below 1024px the browser presents a coarse pointer, as a phone or a
tablet does, so the kit's touch targets apply and a control is measured by
the hit box it grows, not only by its visual. Playwright is not a dependency
here. Install it anywhere and point PLAYWRIGHT_DIR at that directory:

```bash
CONSOLE_URL=http://localhost:5173 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
PLAYWRIGHT_DIR=/path/to/playwright BROWSER_CHANNEL=chrome \
pnpm run measure:small-screens --out /tmp/small-screens
```
