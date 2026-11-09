#!/usr/bin/env node
/**
 * Fail when a page reinvents something the kit already provides.
 *
 *   node tools/lint-ui-consistency.mjs [--json]
 *
 * With nothing written down about what a page looks like, every page grows
 * its own title size, its own container width, its own empty state and its
 * own idea of a button, and the only way to notice is to open two pages side
 * by side. That check has to be repeated after every change, and it finds the
 * same classes of defect every time: a hand-rolled control the kit already
 * ships, a stock palette color that ignores the theme, a character standing
 * in for an icon, one control nested inside another.
 *
 * So the rules below are not invented here. They are what the kit already
 * offers, written down so a page that walks away from it fails instead of
 * merely looking slightly different. Each rule states the defect it guards
 * against, because a rule whose reason is lost is a rule the next person
 * deletes.
 *
 * A rule can also be narrower than the defect class it is named for, and then
 * it reports a confident zero forever. So each rule reads every spelling of
 * its defect it can name, not only the first one.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGES = globSync('src/routes/**/+page.svelte');
const ALL = globSync('src/{routes,lib}/**/*.svelte');

/**
 * Pages inside the authed frame.
 *
 * The signed-out pages (login and first-run setup) are a centered card with no
 * shell around them. They carry the product name rather than a page title, so
 * the shell rules do not describe them and are not applied to them. They sit
 * outside the route group, so naming the group is what exempts them.
 */
const ADMIN_PAGES = PAGES.filter((f) => f.includes('(admin)'));

/**
 * Tailwind's stock palette, plus the two colors that have no palette at all.
 *
 * The theme ships tokens: fg, muted, faint, brand, violet, surface, line,
 * danger, and a stock color bypasses every one of them, so the element keeps
 * one theme's value when the palette changes underneath it. `white` and `black`
 * are the same defect in its shortest spelling: they are fixed on both themes
 * by definition, which is why the kit's own switch paints its thumb `bg-fg`.
 */
const RAW_COLOR =
  /\b(?:text|bg|border|ring|divide|from|via|to|outline|decoration|shadow|accent|caret|fill|stroke)-(?:(?:zinc|gray|slate|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)\b/g;

/**
 * A speed or a curve the kit's theme does not name.
 *
 * The kit declares four durations (fast, base, slow, progress) and three
 * curves (enter, exit, move), and hands the `transition-*` utilities the fast
 * rung and the move curve as defaults, so `transition-colors` on its own is
 * complete. `duration-150` beside it is a fifth speed nobody chose, Tailwind's
 * `ease-out` is a curve the theme never states, and `transition-all` animates
 * whatever happens to change, layout included. A surface that mounts and
 * unmounts enters and leaves through the kit's `motion` presets. An import
 * from `svelte/transition` or `svelte/easing` is a page choosing its own
 * numbers instead.
 */
const RAW_MOTION =
  /\b(?:duration-\d+|duration-\[[^\]]*\]|ease-(?:in|out|in-out|linear)|transition-all)\b|from '(?:svelte\/(?:transition|easing|animate))'/g;

/**
 * What the page renders, with the script and style blocks and the HTML comments
 * taken out.
 *
 * A rule that reads the whole file reads string literals as markup. A lookup
 * table of one and two character labels in a script has to stay legal, so a
 * rule looking for a glyph standing in for an icon has to see the markup and
 * not that table.
 */
export const markup = (src) =>
  src
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

/**
 * Every element in a fragment, with the text of its attributes.
 *
 * The tag is walked rather than matched. A Svelte attribute holds an
 * expression, so `value={a > b}` and `class={x ? "a" : "b"}` both end a regex
 * that stops at the first `>` half way through the tag, and the half of the
 * attributes past that point is where the class list usually is. Quotes and
 * brace depth decide where the tag ends instead.
 */
export function* elements(src) {
  const open = /<([A-Za-z][\w.:-]*)/g;
  let m;
  while ((m = open.exec(src)) !== null) {
    const from = open.lastIndex;
    let i = from;
    let depth = 0;
    let quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    yield { name: m[1], attrs: src.slice(from, i), index: m.index, end: i + 1 };
    open.lastIndex = i + 1;
  }
}

/** The value of one attribute, whether it is quoted or an expression. */
const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`).exec(attrs);
  if (!m) return null;
  return { value: m[1] ?? m[2] ?? m[3], dynamic: m[1] === undefined && m[2] === undefined };
};

/**
 * Roles that make a plain element behave as a control, so anything focusable
 * inside one is a second tab stop the screen reader cannot reach separately.
 */
const WIDGET_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'treeitem',
]);

/** What counts as a control when it turns up inside another one. */
const INTERACTIVE_CHILDREN = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'Button',
  'CopyButton',
  'Toggle',
  'Checkbox',
  'Radio',
]);

/**
 * The markup between an element's open and close tag, honoring nesting.
 *
 * Taking the next close tag instead reports the wrong span the moment an
 * element of that name nests inside itself, which for a div is always, and the
 * over-wide span then reports pairs that are siblings rather than parent and
 * child. The slice starts past the opening tag: from the element's own index it
 * puts the container into its own child list, so every wrapper reports itself.
 *
 * The end of the opening tag comes from the walker rather than from the first
 * `>` after it, because `disabled={a >= b}` puts a `>` inside the tag and a
 * search would cut the span open half way through the attributes.
 */
export const enclosed = (body, el) => {
  if (el.attrs.trimEnd().endsWith('/')) return null;
  const token = new RegExp(`<${el.name}\\b|</${el.name}\\s*>`, 'g');
  token.lastIndex = el.end;
  let depth = 1;
  let m;
  while ((m = token.exec(body)) !== null) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return body.slice(el.end, m.index);
  }
  return null;
};

/** Svelte's own elements render nothing into the page's own layout. */
const stripSvelteElements = (src) =>
  src
    .replace(/<svelte:([\w]+)\b[^>]*>[\s\S]*?<\/svelte:\1>/g, '')
    .replace(/<svelte:[\w]+\b[^>]*\/>/g, '')
    // PageTitle renders into the document head, the way svelte:head does.
    .replace(/<PageTitle\b[^>]*\/>/g, '');

/**
 * Snippet blocks, removed with their contents.
 *
 * A page declares its empty states and its action buttons as snippets above the
 * shell, so the first tag in the file is routinely an icon inside a snippet
 * that the shell renders later. Nesting is counted rather than matched lazily,
 * because a snippet holding a snippet would otherwise end at the inner close
 * and leave the outer body looking like page content.
 */
const stripSnippets = (src) => {
  const CLOSE = '{/snippet}';
  let out = '';
  let i = 0;
  for (;;) {
    const start = src.indexOf('{#snippet', i);
    if (start === -1) return out + src.slice(i);
    out += src.slice(i, start);
    let depth = 0;
    let j = start;
    for (;;) {
      const nested = src.indexOf('{#snippet', j + 1);
      const close = src.indexOf(CLOSE, j + 1);
      if (close === -1) return out;
      if (nested !== -1 && nested < close) {
        depth++;
        j = nested;
        continue;
      }
      if (depth === 0) {
        i = close + CLOSE.length;
        break;
      }
      depth--;
      j = close;
    }
  }
};

/**
 * The first element a page actually renders.
 *
 * Not the first tag in the file: the title in `svelte:head`, a comment above
 * the markup and the snippets a page defines before its body all come first in
 * source order and none of them is the page's root. Control flow is left in
 * place, so a page that opens `{#if licensed}` around its shell still reports
 * the shell as its root.
 */
export const pageRoot = (src) => {
  const body = stripSnippets(stripSvelteElements(markup(src)));
  for (const el of elements(body)) return el;
  return null;
};

/**
 * The text between one tag and the next, which is what a reader sees.
 *
 * The gaps between walked tags, not everything after a `>`. An attribute
 * holding `a >= b` puts a `>` inside a tag, and a scan that treats every `>` as
 * a tag end reads from the middle of the attributes to the next element and
 * calls the result a label. That label then contains half an expression, so
 * whatever a rule reports about it names a line the reader cannot find.
 */
export function* textNodes(src) {
  const closing = /<\/[\w.:-]*\s*>/;
  let cursor = 0;
  const chunk = function* (text) {
    for (const part of text.split(closing)) yield part;
  };
  for (const el of elements(src)) {
    if (el.index > cursor) yield* chunk(src.slice(cursor, el.index));
    cursor = el.end;
  }
  if (cursor < src.length) yield* chunk(src.slice(cursor));
}

/**
 * Every quoted string in an element's attributes, except the ones that carry
 * styling rather than words.
 *
 * A label handed to a component is a label. `<Button>Next</Button>` and
 * `<Stat sub="active" />` render the same words to the same reader, so a rule
 * about what a label may contain has to read both or it only holds for
 * whichever spelling the page happened to use.
 */
export function* attrStrings(attrs) {
  const styling = /\b(?:class|style)=/;
  const literal = /(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = literal.exec(attrs)) !== null) {
    const before = attrs.slice(Math.max(0, m.index - 12), m.index);
    if (styling.test(before)) continue;
    yield m[1] ?? m[2];
  }
}

/**
 * A control the kit ships, keyed by the native element it replaces. An input is
 * keyed by its type. `hidden` and `file` are absent on purpose.
 */
/**
 * The date and time types a browser draws its own picker for, and the kit
 * field that replaces each. The kit has no month or week field, so those
 * go to the calendar the kit does have.
 */
const NATIVE_PICKER = {
  date: 'DatePicker',
  'datetime-local': 'DateTimePicker',
  time: 'TimePicker',
  month: 'DatePicker',
  week: 'DatePicker',
};

const KIT_CONTROL = {
  select: 'Select',
  textarea: 'Textarea',
  password: 'PasswordInput',
  date: 'DatePicker',
  'datetime-local': 'DateTimePicker',
  time: 'TimePicker',
  checkbox: 'Checkbox',
  radio: 'Radio',
  number: 'NumberInput',
  search: 'SearchInput',
};

/** Any focus variant, including the peer and group forms the kit's boxes use. */
const FOCUS_VARIANT = /\b(?:peer-|group-)?focus(?:-visible|-within)?:/;

/** A focus state that draws something, as opposed to one that removes it. */
const FOCUS_INDICATOR =
  /\b(?:peer-|group-)?focus(?:-visible|-within)?:(?:ring\b|shadow-|border-|outline-(?!none\b))/;

const FOCUS_KILL = /\b(?:peer-|group-)?focus(?:-visible|-within)?:outline-none\b/;

/** A focus color at partial alpha, which falls under the 3:1 floor on light. */
const FOCUS_ALPHA =
  /\b(?:peer-|group-)?focus(?:-visible|-within)?:(?:ring|border|outline|shadow)-[\w-]+\/\d+/g;

/**
 * The gutter, in every spelling. The axis pair is the common one, and
 * `pt-6 pr-6 pb-6 pl-6` declares the same gutter, so all seven prefixes count.
 */
const PAGE_PADDING = /\b(?:[\w-]+:)*p[xytrbl]?-[\d.]+(?:\/\d+)?\b/g;

/**
 * A content cap or a centering, in every spelling.
 *
 * `max-w-*` is the cap itself and `mx-auto` is the half of it a page forgets,
 * and a page that forgets it renders against the left edge of the window.
 * `w-screen` is the same decision written as a width.
 */
/** The rungs $lib/icon.ts declares. Kept here as numbers so the lint needs no import. */
const ICON_RUNGS = new Set([12, 14, 16, 20, 40]);

/** A component sized as an icon, by a number or a rung. */
const HAS_ICON = /<[A-Z]\w*\b[^>]*\bsize=\{(?:\d+|ICON\.\w+|RUNG\.\w+)\}/;

/** An icon element directly in front of a heading. */
const ICON_BEFORE_HEADING = /<[A-Z]\w*\b[^<>]*\bsize=\{(?:\d+|ICON\.\w+|RUNG\.\w+)\}[^<>]*\/>\s*<SectionHeading\b/g;

/** A snippet passed to a heading, which renders beside its text. */
const HEADING_SNIPPET = /\{#snippet\b[\s\S]*?\{\/snippet\}/g;

/** A capitalized word with nothing capitalized after its first letter. */
const TITLE_WORD = /^[A-Z][a-z]+\W*$/;

/** Names that are capitalized in every sentence, so a label may carry them. */
const PROPER = new Set(['Google', 'Sheets', 'Server', 'Postgres', 'Kafka', 'Slack', 'Discord', 'Microsoft', 'Teams', 'Hugo', 'Markdown', 'Bearer', 'Corp']);

const PAGE_CAP = /\b(?:[\w-]+:)*(?:max-w-[\w.[\]%/-]+|mx-auto|w-screen)\b/g;

/**
 * Characters that stand in for an icon: arrows, check marks, crosses, bullets
 * and the ellipsis.
 */
const ICON_GLYPH =
  /[←-⇿➔-➿■-◿•‣\u2026‹›«»×☑✅❌✓-✘]/;

/** A role that is not what the kit's Button renders. */
const NON_BUTTON_ROLE = /^(?:switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|checkbox|radio|img|presentation|none|status|alert)$/;

/**
 * A layout Button cannot produce.
 *
 * Button is one centered row: `inline-flex items-center justify-center`. A
 * control that ranges its own block content left, stacks it, or pushes it
 * apart is a list option or a menu row, not a Button painted by hand, and
 * routing it through Button would cost it the layout it exists for.
 */
const OWN_LAYOUT = /\b(?:text-(?:left|right)|flex-col|items-(?:start|end)|justify-(?:start|end|between))\b/;

/**
 * A width the element will not go below, which is what turns a clipped
 * container into lost content rather than a tidy edge.
 */
const WIDTH_FLOOR = (el) => {
  const cls = attr(el.attrs, 'class');
  // min-w-0 and min-w-full are the opposite of a floor: the first asks the
  // element to shrink below its content, the second stops at the container.
  if (cls && /\bmin-w-(?:\[|(?:screen|min|max|fit)\b|[1-9])/.test(cls.value)) {
    return 'a minimum width';
  }
  const style = attr(el.attrs, 'style');
  if (style && /grid-template-columns[^;]*\d\s*px/.test(style.value)) {
    return 'a pixel grid template';
  }
  if (el.name === 'table') return 'a table';
  return null;
};

/**
 * A container that gives its own contents a way out sideways.
 *
 * `overflow-auto` scrolls both axes, so it counts as much as the x-only
 * spelling. `overflow-hidden` on one axis is written with the other axis set,
 * which is why the pair is read off the same class list rather than assumed.
 */
const SCROLLS_X = /\boverflow(?:-x)?-(?:auto|scroll)\b/;

/**
 * Where each horizontally scrollable element inside a fragment begins and ends.
 *
 * Content under one of these is reachable whatever clips it further up, and a
 * clipping container is routinely the whole page frame: a shell that hides its
 * own overflow so the panes inside it scroll separately. Reporting everything
 * wide anywhere below that frame reports the panes doing their job.
 */
const scrollableSpans = (body) => {
  const spans = [];
  for (const el of elements(body)) {
    const cls = attr(el.attrs, 'class');
    if (!cls || !SCROLLS_X.test(cls.value)) continue;
    const inner = enclosed(body, el);
    if (inner !== null) spans.push([el.index, el.end + inner.length]);
  }
  return spans;
};

export const rules = [
  {
    id: 'page-header',
    files: ADMIN_PAGES,
    // A hand-written <h1> picks its own title size. PageHeader holds one.
    test: (src) => [...src.matchAll(/<h1\b/g)].map(() => 'hand-written <h1>; use PageHeader'),
  },
  {
    id: 'raw-color',
    files: ALL,
    test: (src) => [...src.matchAll(RAW_COLOR)].map((m) => `${m[0]}; use a theme token`),
  },
  {
    id: 'raw-motion',
    files: ALL,
    test: (src) =>
      [...src.matchAll(RAW_MOTION)].map(
        (m) => `${m[0]}; the theme sets the clock, use duration-base|slow|progress, ease-enter|exit|move or a motion preset`,
      ),
  },
  {
    id: 'style-block',
    files: ALL,
    /**
     * A stylesheet inside a component, where no other rule here can see it.
     *
     * Every rule in this file reads class names and markup, so a `<style>`
     * block takes a literal color, duration or size past all of them. The
     * admin's rule was no `<style>` blocks. Nothing enforced it, and the rich
     * text editor shipped one with its heading sizes in rem and its padding in
     * pixels. Markup the component renders takes utilities. Markup a library
     * renders, which no class reaches, gets a rule in src/app.css, scoped under
     * the component's own class and written in the theme's variables.
     */
    test: (src) =>
      // A script may build a document for a preview, and a comment may name
      // the element. Neither is a stylesheet this page loads.
      [
        ...src
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .matchAll(/<style\b/g),
      ].map(() => '<style> block; style with utilities, or with theme variables in src/app.css for markup a library renders'),
  },
  {
    id: 'raw-button',
    files: ALL,
    /**
     * A <button> is not the problem. A second button *style* is.
     *
     * Tab strips, sidebar navigation and icon toggles are buttons that no
     * Button variant describes, and forcing them through one produces worse
     * markup than leaving them alone. A role that is not `button`, and a
     * control that lays out its own block content, are the two ways an element
     * says it is one of those, and both are skipped. What has to go is the element that
     * repaints a variant the kit already ships: a filled tone, or a bordered
     * and padded control, written out by hand a few pixels off every other copy
     * of itself.
     *
     * The class is read off the walked tag rather than scraped with a regex.
     * A conditional class is the ordinary spelling here, and a scrape that
     * stops at the first inner quote never sees the branch that carries the
     * tone, so `class="rounded {on ? 'bg-brand' : ''}"` would pass.
     */
    test: (src) =>
      [...elements(markup(src))]
        .filter((el) => {
          if (el.name !== 'button' && el.name !== 'a') return false;
          const role = attr(el.attrs, 'role');
          if (role && !role.dynamic && NON_BUTTON_ROLE.test(role.value)) return false;
          const cls = attr(el.attrs, 'class');
          if (!cls) return false;
          if (OWN_LAYOUT.test(cls.value)) return false;
          // A tint (bg-brand/10) is a chip or a badge, not a filled button.
          const filled = /bg-(?:brand|danger|success|warn|violet)(?!\/)\b/.test(cls.value);
          // px or py with a rounding or a border is the hand-rolled button.
          // Uniform p- counts only beside a border: a rounded p-1 is the
          // icon toggle the prose above leaves alone.
          const padded =
            (/\b(?:px|py)-[\d.]+/.test(cls.value) && /\b(?:rounded|border)\b/.test(cls.value)) ||
            (/\bp-[\d.]+/.test(cls.value) && /\bborder\b/.test(cls.value));
          // A link is a button when it is painted as one. A padded, rounded
          // link is also how navigation chips are written, which no Button
          // variant describes.
          return el.name === 'a' ? filled : filled || padded;
        })
        .map((el) => {
          const cls = attr(el.attrs, 'class').value.replace(/\s+/g, ' ').trim();
          return `<${el.name} class="${cls.slice(0, 40)}"; use Button`;
        }),
  },
  {
    id: 'clipped-table',
    files: ALL,
    /**
     * Content wider than its container inside overflow-hidden loses its
     * right-hand edge with no scrollbar to reach it, and the right-hand column
     * of a row of data is almost always the actions.
     *
     * The kit's Table wraps itself in overflow-x-auto and needs no help. What
     * fails here is the hand-rolled equivalent: a grid whose template is
     * written in pixels, or an element with a minimum width, inside a rounded
     * card that clips. Rounded corners are the reason overflow-hidden gets
     * written, but overflow-x-auto rounds the same corners and still lets a reader
     * reach the far side. A grid of divs is the more common way to draw a row
     * of data, so the rule reads both.
     *
     * The walk stops at a descendant that scrolls sideways itself. A clipping
     * container here is often the page frame rather than a card, and every
     * pane below it already has its own scrollbar. Without that stop the rule
     * reports each of those panes and the real defect is lost in them.
     */
    test: (src) => {
      const body = markup(src);
      const hits = [];
      for (const el of elements(body)) {
        const cls = attr(el.attrs, 'class');
        if (!cls || !/\boverflow-hidden\b/.test(cls.value)) continue;
        if (/\boverflow-x-auto\b/.test(cls.value)) continue;
        const inner = enclosed(body, el);
        if (inner === null) continue;
        const reachable = scrollableSpans(inner);
        for (const child of elements(inner)) {
          const floor = WIDTH_FLOOR(child);
          if (!floor) continue;
          if (reachable.some(([from, to]) => child.index >= from && child.index < to)) continue;
          hits.push(
            `<${child.name}> with ${floor} inside overflow-hidden; use overflow-x-auto`,
          );
        }
      }
      return hits;
    },
  },
  {
    id: 'native-control',
    files: ALL,
    /**
     * A native control the kit already ships, which is a control the theme does
     * not reach.
     *
     * A native select opens its list in operating system chrome, white with a
     * bright highlight, in the middle of a dark page. A native date field is
     * the browser's own calendar behind a box sized against nothing in the
     * theme. A bare checkbox ignores the theme. A native password field has
     * no way to reveal what was pasted into it. A native details draws the
     * browser's own marker and snaps open in one frame. A native dialog
     * brings none of the kit's focus return, scroll lock or overlay sizes.
     *
     * `hidden` carries form state and renders nothing, and `file` is the only
     * way to open a file picker, including the common shape of a hidden picker
     * a Button clicks. Neither has a component and neither fires. An input with
     * no type is a text field, which Input covers, so leaving it out would
     * leave the shortest spelling of the defect legal. A `type` bound to an
     * expression is left alone: the value is not in the markup, and guessing at
     * it would fail the field components themselves.
     */
    test: (src) =>
      [...elements(markup(src))]
        .map((el) => {
          if (el.name === 'select' || el.name === 'textarea') {
            return `native <${el.name}>; use ${KIT_CONTROL[el.name]}`;
          }
          if (el.name === 'details' || el.name === 'summary') {
            return `native <${el.name}>; use Collapsible, or Accordion for a set`;
          }
          if (el.name === 'dialog') return 'native <dialog>; use Modal or Drawer';
          // An option list written by hand is a native select's list, whoever
          // renders it. The kit's Select takes its rows as data.
          if (el.name === 'option' || el.name === 'optgroup' || el.name === 'datalist') {
            return `native <${el.name}>; pass the rows to Select as options`;
          }
          // The kit's Input passes its type through, so <Input type="date">
          // is the browser's own calendar in a themed box. Both field
          // shapes are the same defect and both are refused.
          if (el.name === 'Input') {
            const t = attr(el.attrs, 'type');
            if (!t || t.dynamic || !NATIVE_PICKER[t.value]) return null;
            return `<Input type="${t.value}"> draws the browser's picker; use ${NATIVE_PICKER[t.value]}`;
          }
          if (el.name !== 'input') return null;
          const type = attr(el.attrs, 'type');
          if (!type) return 'native <input> with no type; use Input';
          if (type.dynamic) return null;
          const kit = KIT_CONTROL[type.value] ?? NATIVE_PICKER[type.value];
          return kit ? `native <input type="${type.value}">; use ${kit}` : null;
        })
        .filter(Boolean),
  },
  {
    id: 'page-title',
    files: PAGES,
    /**
     * A page that names no tab title, or names it twice.
     *
     * The layouts carry no fallback title. During server rendering Svelte keeps
     * one title per document and a layout's could outrank the page's, so a
     * page would render titled with the bare product name until the script
     * runs. The root layout states the format once, and a PageShell titles the
     * tab from its `title`, or from `documentTitle` when the tab reads
     * differently. A page with no PageShell, such as a signed-out card,
     * renders PageTitle instead. Both end the title in the tenant's name. A
     * page that renders both writes two title elements, and the tab shows
     * whichever the browser reads first. A page that only redirects renders
     * no markup and is left alone.
     */
    test: (src) => {
      const body = markup(src).replace(/<!--[\s\S]*?-->/g, '').trim();
      if (!body) return [];
      const shell = /<PageShell\b/.test(body);
      const title = /<PageTitle\b/.test(body);
      if (shell && title) return ['page renders a PageShell and a PageTitle; pass documentTitle to the PageShell instead'];
      return shell || title ? [] : ['page sets no tab title; render a PageShell, or <PageTitle title="..." /> on a page without one'];
    },
  },
  {
    id: 'page-shell',
    files: ADMIN_PAGES,
    /**
     * A page that starts with anything but the shell is a page that has picked
     * its own frame.
     *
     * A page that declares its own gutter picks a spelling and a content cap
     * with no rule behind the choice, and a page that sets a cap and forgets
     * to center it renders against the left edge of the window. PageShell owns the gutter, the cap, the centering and
     * the rhythm between sections, so the frame is a prop and not a class list.
     */
    test: (src) => {
      const root = pageRoot(src);
      if (!root || root.name === 'PageShell') return [];
      return [`page starts with <${root.name}>, not <PageShell>; render through PageShell`];
    },
  },
  {
    id: 'page-gutter',
    files: ADMIN_PAGES,
    /**
     * Padding on the page root, which is a page declaring its own gutter.
     *
     * The shell already sets it from the spacing token, so a second one on the
     * root either doubles the distance from the edge or contradicts it, and the
     * two pages next to each other in the sidebar start their content in
     * different places. This fires on the shell too: `<PageShell class="p-6">`
     * is the same page picking the same fight one level up.
     */
    test: (src) => {
      const root = pageRoot(src);
      const cls = root && attr(root.attrs, 'class');
      if (!cls) return [];
      return [...cls.value.matchAll(PAGE_PADDING)].map(
        (m) => `${m[0]} on the page root; PageShell owns the gutter`,
      );
    },
  },
  {
    id: 'page-cap',
    files: ADMIN_PAGES,
    /**
     * A content cap on the page root, which is a page choosing how wide the
     * product is.
     *
     * With no rule for picking a cap, the same kind of screen gets capped
     * different ways. The cap is a role (`narrow`, `default`, `wide`, `full`)
     * the shell resolves to a token, so retuning it is one edit.
     */
    test: (src) => {
      const root = pageRoot(src);
      const cls = root && attr(root.attrs, 'class');
      if (!cls) return [];
      return [...cls.value.matchAll(PAGE_CAP)].map(
        (m) => `${m[0]} on the page root; pass width="narrow|default|wide|full" instead`,
      );
    },
  },
  {
    id: 'page-width',
    files: ADMIN_PAGES,
    /**
     * A page that does not say how wide it is.
     *
     * PageShell falls back to `default`, so an unset width is a page taking a
     * cap nobody chose for it and reading as deliberate. A `fill` page is the
     * exception: it owns the viewport and the cap does not apply to it.
     */
    test: (src) => {
      const root = pageRoot(src);
      if (!root || root.name !== 'PageShell') return [];
      // `fill` is a bare boolean attribute, which attr() cannot see: it reads
      // a value, and this one has none.
      if (/\bfill\b(?!=)/.test(root.attrs)) return [];
      const width = attr(root.attrs, 'width');
      if (!width) return ['PageShell names no width; pass wide, or full for a canvas'];
      // One width for every admin page. A page at default sits in a centered
      // column while a page at wide runs to the gutter, so the content's left
      // edge would jump between neighboring screens.
      if (!width.dynamic && width.value !== 'wide' && width.value !== 'full') {
        return [`PageShell width="${width.value}"; every admin page is wide, or full for a canvas`];
      }
      return [];
    },
  },
  {
    id: 'raw-count',
    // Numbers are formatted in the API wrappers too, and ALL is Svelte only.
    files: globSync('src/{routes,lib}/**/*.{ts,svelte}'),
    /**
     * A number grouped by hand instead of by the one formatter.
     *
     * `toLocaleString()` with no locale renders 1,234 in one browser and 1.234
     * in another, and the second reads as a fraction. Naming 'en-US' at the
     * call site fixes that one number and leaves the next one to remember.
     * `$lib/format.ts` holds the formatter, built once.
     */
    test: (src) =>
      // A call carrying an options object is formatting a date or a currency
      // and has chosen its shape on purpose. The subject here is a bare number
      // grouped at the call site, with a locale or without one.
      [...src.matchAll(/\.toLocaleString\(\s*(?:'[^']*'|"[^"]*")?\s*\)/g)].map(
        () => 'toLocaleString groups a number by hand; use formatCount from $lib/format',
      ),
  },
  {
    id: 'raw-date',
    // Dates are formatted in the API wrappers too, and ALL is Svelte only.
    files: globSync('src/{routes,lib}/**/*.{ts,svelte}'),
    /**
     * A date or a time written out with no locale.
     *
     * With no locale the browser picks the format, so the same moment reads
     * 14:32:07 in one browser and 2:32:07 PM in another, in the reader's own
     * zone and unlabeled. The stream lab stamped each event that way beside a
     * console that prints UTC everywhere else. `undefined` in the locale's
     * place is the same call, and so is a formatter built with no locale.
     * `$lib/format.ts` holds the one presentation: formatDate, formatDateTime
     * and formatTime.
     */
    test: (src) =>
      [...src.matchAll(/\.(toLocaleDateString|toLocaleTimeString)\(\s*(?:\)|undefined\b)|\b(Intl\.DateTimeFormat)\(\s*(?:\)|undefined\b)/g)].map(
        (m) => `${m[1] ?? m[2]} with no locale renders per browser; use formatDate, formatDateTime or formatTime from $lib/format`,
      ),
  },
  {
    id: 'trapped-scroll',
    files: ALL,
    /**
     * A scrolling pane that cannot shrink, which is how one list gets two
     * scrollbars.
     *
     * A flex item refuses to go below its content height by default, so a
     * `flex-1` pane with `overflow-auto` grows to fit everything it holds,
     * pushes the column past the bottom of the window, and the frame behind it
     * takes a scrollbar of its own. The reader then has two bars for one list
     * and the inner one is out of reach. PageShell's own `fill` branch carries
     * this warning in prose.
     *
     * A pane that scrolls a child rather than itself is not the subject: the
     * arbitrary-variant form `[&_textarea]:overflow-auto` names the child.
     */
    test: (src) =>
      [...src.matchAll(/class="([^"]*)"/g)]
        .map((m) => m[1])
        .filter(
          (c) =>
            /(?:^|\s)overflow-(?:y-)?(?:auto|scroll)(?:\s|$)/.test(c) &&
            /(?:^|\s)flex-(?:1|auto)(?:\s|$)/.test(c) &&
            !/(?:^|\s)min-h-0(?:\s|$)/.test(c),
        )
        .map(() => 'a flex-1 pane that scrolls needs min-h-0, or the frame scrolls too'),
  },
  {
    id: 'unscoped-header',
    files: ALL,
    /**
     * A header cell that does not say what it heads.
     *
     * Without `scope` a screen reader guesses which cells a header applies to,
     * and it guesses per table, so the same column header can behave
     * differently from one page to the next.
     */
    test: (src) =>
      [...elements(src)]
        .filter((el) => el.name === 'th' && !/\bscope=/.test(el.attrs))
        .map(() => 'th has no scope; a header in a thead is scope="col", one in a row is scope="row"'),
  },
  {
    id: 'sr-only-table',
    files: ALL,
    /**
     * A table carrying sr-only.
     *
     * A table box ignores the 1px width and height sr-only gives it and grows
     * to its rows, and it is positioned against the page, so a long hidden
     * table lengthens the document under the app frame and scrolls the frame
     * out of view. Put sr-only on a wrapper div.
     */
    test: (src) =>
      [...elements(src)]
        .filter((el) => el.name === 'table' && /\bsr-only\b/.test(attr(el.attrs, 'class')?.value ?? ''))
        .map(() => 'table has sr-only; a table ignores its 1px box, so wrap it in a div with sr-only'),
  },
  {
    id: 'unnamed-table',
    files: ALL,
    /**
     * A table whose scroll box has no accessible name.
     *
     * Table makes that box a focusable region, and a region with no name is
     * announced as "region" and nothing else. Three unnamed regions on one
     * page is three identical stops with no way to tell them apart.
     */
    test: (src) => {
      const found = [];
      const seen = new Map();
      for (const el of elements(src)) {
        if (el.name !== 'Table') continue;
        // `{label}` is the shorthand for `label={label}` and names it just as
        // well, which a check for `label=` alone cannot see.
        if (/\{label\}/.test(el.attrs)) continue;
        const label = attr(el.attrs, 'label');
        if (!label) {
          found.push('Table has no label; its scroll box is a region with no accessible name');
          continue;
        }
        // Two regions on one page under one name is the same defect as two
        // with no name: a reader cycling them cannot tell which is which.
        const n = (seen.get(label.value) ?? 0) + 1;
        seen.set(label.value, n);
        if (n === 2) {
          found.push(`two tables on this page are both called "${label.value}"`);
        }
      }
      return found;
    },
  },
  {
    id: 'icon-size',
    files: ALL,
    /**
     * An icon sized to a number nobody chose, or sized by a class.
     *
     * A size picked per icon drifts, so the same row action ends up a pixel
     * apart on neighboring list pages. A size set by `h-4 w-4` reads as a
     * class and not as a size. `$lib/icon.ts` names the five rungs and says
     * what each is for. An icon on a line of text matches that text.
     */
    test: (src) => {
      const found = [];
      for (const el of elements(src)) {
        if (!/^[A-Z]/.test(el.name)) continue;
        // A number here is a number nobody chose. The ladder is enforced by
        // value below, but a value is not a vocabulary: the module says what
        // each rung is for, and a literal at the call site reaches none of it.
        const size = /\bsize=\{(\d+)\}/.exec(el.attrs);
        if (size) {
          found.push(
            ICON_RUNGS.has(Number(size[1]))
              ? `size={${size[1]}} names a number; pass ICON.xs|sm|md|lg from $lib/icon`
              : `size={${size[1]}} is not a rung; $lib/icon.ts names 12, 14, 16, 20 and 40`,
          );
        }
        const cls = /class="[^"]*\bh-(\d(?:\.\d)?) w-\1\b/.exec(el.attrs);
        if (cls) {
          found.push(`h-${cls[1]} w-${cls[1]} sizes an icon by class; pass size={...} instead`);
        }
      }
      return found;
    },
  },
  {
    id: 'weak-focus',
    files: ALL,
    /**
     * A focus indicator removed and not replaced, or replaced with one too
     * faint to see.
     *
     * The base `:focus-visible` outline measures 9.85:1 on dark and 7.70:1 on
     * light. `focus:outline-none` throws that away, and on its own it leaves a
     * control that a keyboard cannot be aimed at. A ring at half alpha falls
     * under the 3:1 floor for a non-text indicator on light.
     *
     * The replacement has to be on the same element. A ring on a parent is not
     * this element's focus state, and the two elements do not receive focus at
     * the same time.
     */
    test: (src) =>
      [...elements(markup(src))].flatMap((el) => {
        const hits = [...el.attrs.matchAll(FOCUS_ALPHA)].map(
          (m) => `${m[0]} on <${el.name}>; a focus indicator at partial alpha is under 3:1`,
        );
        if (FOCUS_KILL.test(el.attrs) && !FOCUS_INDICATOR.test(el.attrs)) {
          hits.push(`focus:outline-none on <${el.name}> with no replacement indicator`);
        }
        return hits;
      }),
  },
  {
    id: 'weak-border',
    files: ALL,
    /**
     * The weak border token on a control.
     *
     * `border-line` reads 1.25:1. On a card or a panel that is the intent and
     * the kit's own card surface uses it. On a control it is the only thing
     * saying where the field is, which is what SC 1.4.11 asks for at 3:1, and
     * `border-line-strong` is the token that carries it.
     *
     * What makes an element a control here is a focus variant, which means it
     * takes focus, or a placeholder utility, which means it holds typed text.
     * The control surface counts only with a control height beside it, because
     * `bg-surface-2` is also the code chip and the pre block, and neither is a
     * control whose border has to be found.
     */
    test: (src) =>
      [...elements(markup(src))]
        .filter((el) => {
          if (!/\bborder-line(?![\w-])/.test(el.attrs)) return false;
          const surface = /\bbg-surface-2\b/.test(el.attrs) && /\bh-control\b/.test(el.attrs);
          return FOCUS_VARIANT.test(el.attrs) || /\bplaceholder[:-]/.test(el.attrs) || surface;
        })
        .map((el) => `border-line on control <${el.name}>; use border-line-strong`),
  },
  {
    id: 'nested-interactive',
    files: ALL,
    /**
     * One control inside another.
     *
     * Interactive content inside interactive content is invalid HTML. It gives
     * one control two tab stops, and it announces one thing while behaving like
     * another, so what a screen reader says the control is contradicts what
     * pressing it does. It also swallows the inner activation unless the page
     * remembers to stop the event, which is a bug that only shows up on the
     * second click.
     *
     * Button takes href and renders the anchor itself, which is one element,
     * one tab stop and one role. A card that has to be clickable is the control
     * and holds no other one. A card that holds a control is not itself a
     * control.
     */
    test: (src) => {
      const body = markup(src);
      const hits = [];

      for (const el of elements(body)) {
        const interactiveTag = el.name === 'a';
        // A container made interactive by attribute is the same defect wearing
        // a different tag. A rule that tests only <a> reads as covering the
        // whole class and does not: a row built as
        // <div role="button" tabindex={0}> holding its own copy button passes
        // it while every control inside is unreachable.
        const role = attr(el.attrs, 'role');
        const tabindex = attr(el.attrs, 'tabindex');
        const interactiveRole = role !== null && WIDGET_ROLES.has(role.value);
        const focusable = tabindex !== null && !String(tabindex.value).trim().startsWith('-');
        // Card takes role="button" and tabindex from an onclick, inside the
        // component. Nothing in the page's own markup says so, so a rule that
        // reads only what the page wrote never sees the container at all.
        const clickableCard = el.name === 'Card' && /\bonclick=/.test(el.attrs);
        if (!interactiveTag && !interactiveRole && !focusable && !clickableCard) continue;

        const inner = enclosed(body, el);
        if (inner === null) continue;
        for (const child of elements(inner)) {
          if (!INTERACTIVE_CHILDREN.has(child.name)) continue;
          if (interactiveTag) {
            hits.push(`<a> wrapping <${child.name}>; give Button the href`);
          } else if (clickableCard) {
            hits.push(
              `<Card onclick> wrapping <${child.name}>; ` +
                'the card is the control or it holds one, not both',
            );
          } else {
            const how = interactiveRole ? `role="${role.value}"` : 'tabindex';
            hits.push(
              `<${el.name}> with ${how} wrapping <${child.name}>; ` +
                'make the container plain and leave one control focusable',
            );
          }
        }
      }
      return hits;
    },
  },
  {
    id: 'unicode-icon',
    files: ALL,
    /**
     * A character standing in for an icon.
     *
     * An arrow, a check mark, a cross, a bullet or an ellipsis typed as text is
     * an icon that renders in whatever the reader's font has, at a size and a
     * weight nothing controls, and a screen reader reads it aloud as its
     * character name in the middle of the label. Lucide ships all of them, and
     * an icon that carries meaning gets a stroked SVG with a name and an
     * `aria-hidden` the reader never hears.
     *
     * A label fires when it is nothing but these characters, and when one of
     * them is stuck to its front or its back, which is the shape an arrow
     * arrives in: `Next -> ` is a word plus an icon. A glyph
     * between two words is punctuation and is left alone, so a path written
     * `Settings -> API keys` and a size written `1920 x 1080` both pass, and so
     * does an expression that builds a mask out of bullets.
     *
     * Labels handed to a component count as labels. Only `class` and `style`
     * are skipped, because those are the two attributes that hold styling
     * rather than words.
     */
    test: (src) => {
      const body = markup(src);
      const labels = [...textNodes(body)];
      for (const el of elements(body)) labels.push(...attrStrings(el.attrs));
      return labels
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && ICON_GLYPH.test(t))
        .filter((t) => {
          const onlyGlyphs = [...t].every((c) => /\s/.test(c) || ICON_GLYPH.test(c));
          return onlyGlyphs || ICON_GLYPH.test(t[0]) || ICON_GLYPH.test(t[t.length - 1]);
        })
        .map((t) => `"${t.slice(0, 40)}" as an icon; use a Lucide icon`);
    },
  },
  {
    id: 'action-button',
    files: ALL,
    /**
     * One rule for a create, edit, delete, save or cancel control, by where it
     * sits. Without it, pages disagree: a bare text "Edit" beside a filled red
     * "Delete", an icon-only trash, a hand-styled link, and modal footers at md
     * beside headers at sm.
     *
     * Placement decides the shape, and the shape is the common one in each
     * place:
     *
     *   header   the page's top-level actions snippet: sm, an icon at 14 and
     *            text
     *   empty    inside EmptyState's action snippet: secondary, default size,
     *            icon and text
     *   row      inside a td or tr, or a Card repeated by an each block: ghost,
     *            sm, icon only, aria-label, and a Trash2 painted text-danger
     *   footer   inside a Modal or a footer snippet: text only, default size,
     *            secondary, primary or danger. The first of a pair is the
     *            secondary Cancel. One delete may lead a footer of three
     *            or more, ahead of that order, so it never sits beside the
     *            primary
     */
    test: (src, file = '') => {
      const body = markup(src);
      const hits = [];
      const all = [...elements(body)];
      const spans = new Map();
      const spanOf = (el) => {
        if (!spans.has(el)) {
          const inner = enclosed(body, el);
          spans.set(el, inner === null ? [el.index, el.end] : [el.index, el.end + inner.length]);
        }
        return spans.get(el);
      };
      const ancestors = (el) =>
        all.filter((a) => a !== el && spanOf(a)[0] < el.index && spanOf(a)[1] > el.index);
      const snippetRanges = (name) => {
        const out = [];
        const re = new RegExp(`\\{#snippet ${name}\\(\\)\\}`, 'g');
        let m;
        while ((m = re.exec(body)) !== null) {
          const close = body.indexOf('{/snippet}', m.index);
          if (close !== -1) out.push([m.index, close]);
        }
        return out;
      };
      const inRange = (ranges, i) => ranges.some(([a, b]) => a < i && i < b);
      const inEach = (i) => {
        // The nearest each block that opens before i and closes after it.
        const opens = [...body.matchAll(/\{#each\b/g)].map((m) => m.index);
        return opens.some((o) => {
          const close = body.indexOf('{/each}', o);
          return o < i && (close === -1 || close > i);
        });
      };
      // The page header is the actions snippet whose only enclosing element
      // is the PageShell. SectionHeading and Card carry one of their own.
      const headerRanges = snippetRanges('actions').filter(([a]) =>
        all.filter((e) => spanOf(e)[0] < a && spanOf(e)[1] > a).every((e) => e.name === 'PageShell'),
      );
      const footerRanges = snippetRanges('footer');
      const emptyRanges = snippetRanges('action');
      // A size names a rung through $lib/icon, so these read the name.
      const ICON = (inner) =>
        /<[A-Z]\w*\b[^>]*(?:\bsize=\{(?:\d+|ICON\.\w+|RUNG\.\w+)\}|\bclass="[^"]*\bh-\d)/.test(inner);
      const ICON_14 = (inner) =>
        /<[A-Z]\w*\b[^>]*\bsize=\{(?:14|ICON\.sm|RUNG\.sm)\}/.test(inner);
      // Words, not template logic: an {#if} around two icons is not a label.
      const TEXT = (inner) => [...textNodes(inner)].some((t) => t.replace(/\{[^}]*\}/g, '').trim().length > 0);
      // A variant chosen by an expression is read as whatever it resolves to,
      // which the rule cannot know. It is left alone.
      const variantOf = (attrs) => {
        const v = attr(attrs, 'variant');
        return v ? (v.dynamic ? 'dynamic' : v.value) : 'primary';
      };

      const crud = (inner) =>
        /<(?:Trash2|Pencil|Plus)\b/.test(inner) ||
        /^\s*(?:Edit|Delete|Remove|Add(?: \w+)?)\s*$/.test([...textNodes(inner)].join(' ').replace(/\s+/g, ' '));
      const placementOf = (el) => {
        const anc = ancestors(el);
        const inner = enclosed(body, el) ?? '';
        // Only the CRUD controls are row actions. Configure, Manage and
        // Restore in a row are navigation and stay what they are.
        if (anc.some((a) => a.name === 'td' || a.name === 'tr')) return crud(inner) ? 'row' : null;
        // A card repeated by an each block is a list item, and its edit and
        // delete are row actions. Its other buttons are whatever the card is.
        if (anc.some((a) => a.name === 'Card') && inEach(el.index) && crud(inner)) return 'row';
        // A footer button says what it does in words. An icon-only control in
        // a modal's body, a copy button beside a secret, is not one.
        if (inRange(footerRanges, el.index) || (anc.some((a) => a.name === 'Modal') && TEXT(inner))) return 'footer';
        if (inRange(emptyRanges, el.index) && anc.some((a) => a.name === 'EmptyState')) return 'empty';
        if (inRange(headerRanges, el.index)) return 'header';
        return null;
      };

      const footerGroups = new Map();
      for (const el of all) {
        if (el.name !== 'Button') continue;
        const where = placementOf(el);
        if (!where) continue;
        const inner = enclosed(body, el) ?? '';
        const variant = variantOf(el.attrs);
        const size = attr(el.attrs, 'size')?.value ?? null;
        const label = (TEXT(inner) ? [...textNodes(inner)].join(' ') : attr(el.attrs, 'aria-label')?.value ?? '')
          .replace(/\{[^}]*\}/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 24);
        const say = (why) => hits.push(`${where} "${label}": ${why}`);
        if (where === 'header') {
          if (size !== 'sm') say('header actions are size="sm"');
          // A variant the template decides (the dashboard's window links) is
          // a segmented control wearing Buttons, and it is left alone.
          if (variant !== 'dynamic' && !(ICON(inner) && TEXT(inner)))
            say('a header action carries an icon and its text');
          if (ICON(inner) && !ICON_14(inner)) say('a header icon is size={14}');
        } else if (where === 'empty') {
          // An empty state's action is an invitation: a list with nothing in it
          // is not asking for anything, so nothing on it is filled. An error
          // surface is the opposite. It is a dead end, the reader has to leave
          // it, and there is a right way out: sign in on a 401, the console on
          // a 404. One primary there is the answer, not an emphasis.
          const deadEnd = /ErrorPanel/.test(file);
          if (!deadEnd && variant !== 'secondary')
            say('an empty state action is variant="secondary"');
          if (size !== null) say('an empty state action keeps the default size');
          if (/^(?:New|Add|Create|Upload)\b/.test(label) && !(ICON(inner) && TEXT(inner)))
            say('an empty state create carries an icon and its text');
        } else if (where === 'row') {
          if (variant !== 'ghost' || size !== 'sm') say('a row action is variant="ghost" size="sm"');
          if (TEXT(inner)) say('a row action is icon only, named by aria-label');
          if (!attr(el.attrs, 'aria-label')) say('a row action names its target in aria-label');
          if (/<Trash2\b/.test(inner) && !/text-danger/.test(inner)) say('a row delete paints its Trash2 text-danger');
        } else if (where === 'footer') {
          if (ICON(inner)) say('a footer button is text only');
          if (size !== null) say('a footer button keeps the default size');
          if (!['secondary', 'primary', 'danger', 'dynamic'].includes(variant)) say('a footer button is secondary, primary or danger');
          const owner = ancestors(el).find((a) => a.name === 'Modal') ?? footerRanges.find(([a, b]) => a < el.index && el.index < b);
          const key = owner ? (owner.index ?? owner[0]) : 'none';
          (footerGroups.get(key) ?? footerGroups.set(key, []).get(key)).push({ el, variant, label });
        }
      }
      for (const group of footerGroups.values()) {
        const rest = group.slice(1);
        const lead = group.length >= 3 && group[0].variant === 'danger' && !rest.some((b) => b.variant === 'danger');
        const pair = lead ? rest : group;
        if (pair.length >= 2 && pair[0].variant !== 'secondary')
          hits.push(`footer "${pair[0].label}": the first of a pair is the secondary Cancel`);
      }
      return hits;
    },
  },
  {
    id: 'heading-icon',
    files: ALL,
    /**
     * An icon inside a section heading.
     *
     * An icon on some headings and not on others makes the same level read
     * as two different weights from one page to the next. The heading names the section. An icon that means something
     * belongs to the control it describes.
     */
    test: (src) => {
      const body = markup(src);
      const hits = [];
      for (const el of elements(body)) {
        if (el.name !== 'SectionHeading') continue;
        // An actions snippet is the heading's trailing control, not the heading.
        const inner = enclosed(body, el)?.replace(HEADING_SNIPPET, '');
        if (inner != null && HAS_ICON.test(inner)) hits.push('SectionHeading holds an icon; the heading is text only');
      }
      // The same icon set beside the heading instead of inside it reads the same.
      for (const _ of body.matchAll(ICON_BEFORE_HEADING)) hits.push('an icon leads a SectionHeading; the heading is text only');
      return hits;
    },
  },
  {
    id: 'title-case',
    files: ALL,
    /**
     * A heading or a label written in Title Case.
     *
     * Every surface here is sentence case, and "Delete Subject Data" beside
     * "Export subject data" reads as two products. A word counts when it is
     * capitalized and lower case after its first letter, so an acronym (API,
     * SSO) and a name with its own inner capitals (OAuth, GraphQL) never fire.
     * A proper noun that is written that way on purpose goes in PROPER.
     */
    test: (src) => {
      const body = markup(src);
      const labels = [];
      for (const el of elements(body)) {
        if (el.name === 'SectionHeading') {
          const inner = enclosed(body, el)?.replace(HEADING_SNIPPET, '');
          if (inner != null && !/[<{]/.test(inner)) labels.push(inner);
        }
        for (const name of ['title', 'label', 'documentTitle']) {
          const a = attr(el.attrs, name);
          if (!a || a.dynamic) continue;
          // A tab title names the page, then the section it sits in, so each
          // part is its own phrase and starts with a capital.
          if (el.name === 'PageTitle' || name === 'documentTitle') labels.push(...a.value.split(' - '));
          else labels.push(a.value);
        }
      }
      return labels
        .map((t) => t.trim().replace(/\s+/g, ' '))
        .filter((t) => {
          const words = t.split(' ');
          return words.length > 1 && words.slice(1).some((w) => TITLE_WORD.test(w) && !PROPER.has(w.replace(/\W+$/, '')));
        })
        .map((t) => `"${t.slice(0, 40)}" is Title Case; write it in sentence case`);
    },
  },
];

/**
 * A file opts out of one rule with
 *
 *     <!-- ui-consistency: allow raw-color - why -->
 *
 * The reason is required, and it has to be in the file the exception applies
 * to. A rule with no way out gets deleted the first time it is inconvenient.
 * One that can be waived silently stops meaning anything.
 */
/**
 * A waiver is only a waiver if it carries a reason.
 *
 * The lookahead rejects the comment terminator, because without it
 * `ui-consistency: allow raw-color - -->` satisfies "a dash then a non-space"
 * and buys silence with no reason at all.
 */
const allows = (src, id) =>
  new RegExp(`ui-consistency:\\s*allow\\s+${id}\\s+-\\s+(?!-->)\\S`).test(src);

/** Run every rule over the files it selects. */
export function scan() {
  let total = 0;
  const report = {};
  for (const rule of rules) {
    for (const file of rule.files) {
      const src = readFileSync(file, 'utf8');
      if (allows(src, rule.id)) continue;
      const hits = rule.test(src, file);
      if (!hits.length) continue;
      (report[file] ??= []).push(...hits.map((h) => `${rule.id}: ${h}`));
      total += hits.length;
    }
  }
  return { total, report };
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { total, report } = scan();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, files: report }, null, 2));
  } else {
    for (const [file, hits] of Object.entries(report).sort()) {
      console.log(`\n${file}  (${hits.length})`);
      const counts = {};
      for (const h of hits) counts[h] = (counts[h] ?? 0) + 1;
      for (const [h, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(3)}  ${h}`);
      }
    }
    // The sample size belongs in the line. "0 findings in 0 files" reads as a
    // gate that scanned nothing, which is exactly how a broken glob reports
    // success.
    console.log(
      `\n${total} findings in ${Object.keys(report).length} of ${ALL.length} files scanned`,
    );
  }

  process.exit(total === 0 ? 0 : 1);
}
