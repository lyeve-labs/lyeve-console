import { describe, expect, it } from 'vitest';
import {
  elements,
  enclosed,
  markup,
  pageRoot,
  rules,
  textNodes,
} from './lint-ui-consistency.mjs';

/**
 * The cases are the two halves that make a rule worth keeping: the markup as
 * the app writes it stays silent, and the markup of the defect fails. A rule
 * with only the first half passes forever and catches nothing.
 *
 * Every rule has a case here, including the ones that find nothing in this
 * application. A rule with no subject and no case rots into one that
 * cannot fire at all, and a gate reporting a confident zero is the one shape of
 * failure nobody investigates.
 */
const check = (id, src) => {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  return rule.test(src, 'src/routes/(admin)/admin/example/+page.svelte');
};

describe('markup', () => {
  it('drops the script, the style and the comments', () => {
    const out = markup(
      `<script>const a = '\u2192';</script><style>.x{color:red}</style><!-- \u2192 --><p>ok</p>`,
    );
    expect(out).toBe('<p>ok</p>');
  });
});

describe('elements', () => {
  it('ends a tag on its own closing bracket, not on one inside an expression', () => {
    const [el] = [...elements('<Button disabled={a >= b} class="px-2">x</Button>')];
    expect(el.name).toBe('Button');
    expect(el.attrs).toContain('class="px-2"');
  });

  it('reports where the opening tag ends', () => {
    const src = '<div class="a">body</div>';
    const [el] = [...elements(src)];
    expect(src.slice(el.end)).toBe('body</div>');
  });
});

describe('enclosed', () => {
  it('counts nesting rather than stopping at the first close', () => {
    const src = '<div><div><span>inner</span></div></div>';
    const [outer] = [...elements(src)];
    expect(enclosed(src, outer)).toBe('<div><span>inner</span></div>');
  });

  it('leaves the container out of its own contents', () => {
    const src = '<a href="/x"><Button>go</Button></a>';
    const [outer] = [...elements(src)];
    expect(enclosed(src, outer)).toBe('<Button>go</Button>');
  });

  it('takes the tag end from the walker, not from the first bracket after it', () => {
    const src = '<div hidden={a >= b}><Button>go</Button></div>';
    const [outer] = [...elements(src)];
    expect(enclosed(src, outer)).toBe('<Button>go</Button>');
  });

  it('reports nothing enclosed by a self-closing tag', () => {
    const src = '<Toggle checked /><Button>x</Button>';
    const [el] = [...elements(src)];
    expect(enclosed(src, el)).toBeNull();
  });
});

describe('textNodes', () => {
  it('does not read a comparison inside a tag as the start of a label', () => {
    const nodes = [...textNodes('<Button disabled={a >= b}>Next</Button>')].map((t) => t.trim());
    expect(nodes.filter(Boolean)).toEqual(['Next']);
  });
});

describe('pageRoot', () => {
  it('skips the head, the comments and the snippets a page declares first', () => {
    const src = [
      '<svelte:head><title>x</title></svelte:head>',
      '<!-- a note -->',
      '{#snippet actions()}<Button>Save</Button>{/snippet}',
      '<PageShell title="x"><p>body</p></PageShell>',
    ].join('\n');
    expect(pageRoot(src).name).toBe('PageShell');
  });
});

describe('page-header', () => {
  it('fails a hand-written page title', () => {
    expect(check('page-header', '<h1 class="text-2xl">Tenants</h1>')).toHaveLength(1);
  });

  it('passes a page that renders its title through the shell', () => {
    expect(check('page-header', '<PageShell title="Tenants" />')).toEqual([]);
  });
});

describe('sr-only-table', () => {
  it('fails a table that carries sr-only', () => {
    expect(check('sr-only-table', '<table class="sr-only"><caption>Requests</caption></table>')).toHaveLength(1);
  });

  it('passes a table inside an sr-only wrapper', () => {
    expect(check('sr-only-table', '<div class="sr-only"><table><caption>Requests</caption></table></div>')).toEqual([]);
  });
});

describe('raw-color', () => {
  it('fails a stock palette shade', () => {
    expect(check('raw-color', '<div class="bg-zinc-800 text-red-400">x</div>')).toHaveLength(2);
  });

  it('fails white and black, which no theme can move', () => {
    expect(check('raw-color', '<div class="bg-white text-black">x</div>')).toHaveLength(2);
  });

  it('passes the tokens, including a token at partial alpha', () => {
    expect(check('raw-color', '<div class="bg-surface-2 text-fg border-line">x</div>')).toEqual([]);
    expect(check('raw-color', '<div class="bg-brand/10 text-danger">x</div>')).toEqual([]);
  });
});

describe('style-block', () => {
  it('passes a component styled through its markup', () => {
    expect(check('style-block', '<div class="rte bg-surface-2 text-sm">x</div>')).toEqual([]);
  });

  it('fails a stylesheet in the component, with attributes or inside the head', () => {
    expect(check('style-block', '<div class="rte">x</div>\n<style>\n  :global(.rte h1) { font-size: 1.5rem; }\n</style>')).toHaveLength(1);
    expect(check('style-block', '<style lang="postcss">.x { padding: 10px; }</style>')).toHaveLength(1);
    expect(check('style-block', '<svelte:head><style>body { margin: 0; }</style></svelte:head>')).toHaveLength(1);
  });

  it('reads the markup and not the script or the comments', () => {
    // A preview built as a string is not a stylesheet this page loads.
    expect(check('style-block', "<script>const doc = '<style>p { margin: 0; }</style>';</script><p>ok</p>")).toEqual([]);
    expect(check('style-block', '<!-- the theme owns the <style> here --><p>ok</p>')).toEqual([]);
  });

  it('leaves an element whose name only starts like it alone', () => {
    expect(check('style-block', '<styled-frame>x</styled-frame><Style />')).toEqual([]);
  });
});

describe('raw-button', () => {
  it('sees a tone that only the conditional half of the class carries', () => {
    // A scrape stops at the first quote inside the attribute, and an arrow
    // function in an earlier attribute ends it sooner still, so every button
    // written this way would pass.
    const src =
      `<button onclick={() => pick(x)} class="rounded {on ? 'bg-brand' : 'bg-surface-2'}">x</button>`;
    expect(check('raw-button', src)).toHaveLength(1);
  });

  it('fails a bordered and padded control painted by hand', () => {
    expect(
      check('raw-button', '<button class="rounded-lg border px-4 py-2 text-sm">Save</button>'),
    ).toHaveLength(1);
  });

  it('passes a role that is not what Button renders', () => {
    const src = `<button role="switch" class="rounded-full px-2 py-1 {on ? 'bg-brand' : ''}"></button>`;
    expect(check('raw-button', src)).toEqual([]);
  });

  it('passes a list row that lays out its own block content', () => {
    // The sidebar schema list. Button is one centered row, so routing this
    // through it would cost the row the layout it exists for.
    const src = '<button class="w-full rounded-lg px-3 py-2 text-left">Articles</button>';
    expect(check('raw-button', src)).toEqual([]);
  });

  it('passes a button with no class of its own', () => {
    expect(check('raw-button', '<button onclick={close}>Close</button>')).toEqual([]);
  });
});

describe('clipped-table', () => {
  it('fails a table that cannot shrink inside a clipping card', () => {
    const src =
      '<div class="rounded-xl border border-line overflow-hidden">' +
      '<table class="w-full min-w-[36rem]"><tbody></tbody></table></div>';
    expect(check('clipped-table', src)).toHaveLength(1);
  });

  it('fails a pixel grid template, which is the same defect without a table', () => {
    const src =
      '<div class="rounded-xl overflow-hidden">' +
      '<div style="grid-template-columns: minmax(280px, 2fr) 1fr"></div></div>';
    expect(check('clipped-table', src)).toHaveLength(1);
  });

  it('passes content that shrinks, which is what overflow-hidden is for', () => {
    // min-w-0 asks the element to shrink past its content and min-w-full stops
    // at the container, so neither is a floor.
    expect(
      check('clipped-table', '<div class="rounded-xl overflow-hidden"><div class="min-w-0 flex-1">x</div></div>'),
    ).toEqual([]);
    expect(
      check('clipped-table', '<div class="rounded-xl overflow-hidden"><div class="min-w-full">x</div></div>'),
    ).toEqual([]);
  });

  it('passes the same content where a reader can scroll to it', () => {
    const src = '<div class="rounded-xl overflow-x-auto"><table class="min-w-[36rem]"></table></div>';
    expect(check('clipped-table', src)).toEqual([]);
  });

  it('passes a pane that scrolls itself inside a frame that clips', () => {
    // The page frame hides its own overflow so the panes inside it scroll
    // separately. Without this stop the rule reports every pane doing its job
    // and the real defect is lost among them.
    const src =
      '<div class="flex flex-1 overflow-hidden">' +
      '<div class="overflow-auto p-6"><table class="min-w-[36rem]"></table></div></div>';
    expect(check('clipped-table', src)).toEqual([]);
  });
});

describe('native-control', () => {
  it('refuses an option list written by hand, inside the kit Select too', () => {
    // The kit's Select used to render its children in a native select, which
    // opens a list the browser draws.
    expect(check('native-control', '<Select name="x"><option value="a">A</option></Select>')[0]).toContain('options');
    expect(check('native-control', '<optgroup label="g"></optgroup>')).toHaveLength(1);
    expect(check('native-control', '<datalist id="d"></datalist>')).toHaveLength(1);
  });

  it('refuses the kit Input given a type the browser draws a picker for', () => {
    expect(check('native-control', '<Input label="From" type="date" name="from" />')[0]).toContain('DatePicker');
    expect(check('native-control', '<Input\n  name="since"\n  type="datetime-local"\n/>')[0]).toContain('DateTimePicker');
    expect(check('native-control', '<Input type="time" />')[0]).toContain('TimePicker');
    expect(check('native-control', '<input type="month" />')[0]).toContain('DatePicker');
    expect(check('native-control', '<Input type="email" name="to" />')).toEqual([]);
    expect(check('native-control', '<Input type={kind} />')).toEqual([]);
  });

  it('fails the controls the kit ships', () => {
    expect(check('native-control', '<input type="date" bind:value={cutoff} />')).toHaveLength(1);
    // The kit ships both pickers. DatePicker drops the time half of a
    // datetime-local value, so the message names DateTimePicker.
    expect(check('native-control', '<input type="datetime-local" name="at" />')[0]).toContain(
      'DateTimePicker',
    );
    expect(check('native-control', '<input type="password" name="pw" />')[0]).toContain(
      'PasswordInput',
    );
    // The select and its option are two findings: either alone is refused.
    expect(check('native-control', '<select name="region"><option>eu</option></select>')).toHaveLength(2);
    expect(check('native-control', '<textarea name="body"></textarea>')).toHaveLength(1);
    // A disclosure and its summary are two findings, as the select and its
    // option are.
    expect(check('native-control', '<details open><summary>More</summary><pre>x</pre></details>')).toHaveLength(2);
    expect(check('native-control', '<details class="w-full">x</details>')[0]).toContain('Collapsible');
    expect(check('native-control', '<dialog open>x</dialog>')[0]).toContain('Modal');
    expect(check('native-control', '<input type="checkbox" bind:checked={enabled} />')).toHaveLength(1);
    expect(check('native-control', '<input\n\ttype="number"\n\tmin="0"\n/>')).toHaveLength(1);
    expect(check('native-control', '<input name="q" class="border border-line" />')[0]).toContain(
      'no type',
    );
  });

  it('leaves the two natives with no component alone', () => {
    expect(check('native-control', '<input type="hidden" name="id" value={row.id} />')).toEqual([]);
    // The hidden picker a Button clicks. There is no other way to open a file
    // dialog, so the pattern has to stay legal.
    expect(
      check('native-control', '<input type="file" class="hidden" bind:this={picker} multiple />'),
    ).toEqual([]);
  });

  it('reads the markup and not the script', () => {
    expect(
      check('native-control', "<script>\n\tconst sample = '<select><option>a</option></select>';\n</script>\n<Select {options} />"),
    ).toEqual([]);
  });

  it('says nothing about a type it cannot read', () => {
    expect(check('native-control', '<input type={field.inputType} name={field.name} />')).toEqual([]);
  });
});

describe('page-title', () => {
  it('accepts a page whose PageShell titles the tab', () => {
    expect(check('page-title', '<PageShell title="Users"></PageShell>')).toEqual([]);
    expect(check('page-title', '<PageShell title="Email" documentTitle="Email providers"></PageShell>')).toEqual([]);
  });

  it('accepts a page without a PageShell that names its tab title', () => {
    expect(check('page-title', '<PageTitle title="Sign in" />\n<AuthShell title="Sign in to your account"></AuthShell>')).toEqual([]);
  });

  it('leaves a page that only redirects alone', () => {
    expect(check('page-title', '<!--\n\tNever rendered.\n-->\n')).toEqual([]);
  });

  it('fails a page that renders with no tab title', () => {
    expect(check('page-title', '<AuthShell title="Sign in"></AuthShell>')).toHaveLength(1);
    expect(check('page-title', '<!-- <PageTitle title="Users" /> -->\n<div></div>')).toHaveLength(1);
  });

  it('fails a page that writes two tab titles', () => {
    expect(check('page-title', '<PageTitle title="Users" />\n<PageShell title="Users"></PageShell>')).toHaveLength(1);
  });
});

describe('page-shell', () => {
  const head = '<svelte:head>\n\t<title>Users</title>\n</svelte:head>\n';

  it('accepts a page whose body starts with the shell', () => {
    expect(check('page-shell', `${head}<PageShell title="Users">\n\t<Table />\n</PageShell>`)).toEqual([]);
  });

  it('looks past the tab title, which renders into the head', () => {
    expect(check('page-shell', `<PageShell title="Users">\n\t<Table />\n</PageShell>`)).toEqual([]);
    expect(check('page-shell', `<PageTitle title="Users" />\n<div class="mx-auto max-w-7xl"></div>`)).toHaveLength(1);
  });

  it('looks past the snippets and the control flow a page opens with', () => {
    const src = `${head}<!-- a note -->\n{#snippet empty()}\n\t<Server size={22} />\n{/snippet}\n\n{#if licensed}\n\t<PageShell title="Analytics"><Chart /></PageShell>\n{/if}`;
    expect(check('page-shell', src)).toEqual([]);
  });

  it('fails a page that opens its own frame', () => {
    const hits = check('page-shell', `${head}<div class="mx-auto w-full max-w-7xl">\n\t<PageHeader title="Dashboard" />\n</div>`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('<div>');
  });
});

describe('page-cap', () => {
  it('accepts a shell that names a role instead of a measurement', () => {
    expect(check('page-cap', '<PageShell title="Jobs" width="wide">x</PageShell>')).toEqual([]);
  });

  it('accepts a cap deeper in the page, where it is a component and not the frame', () => {
    expect(
      check('page-cap', '<PageShell title="Jobs">\n\t<div class="max-w-md">a form column</div>\n</PageShell>'),
    ).toEqual([]);
  });

  it('fails a cap or a centering on the page root', () => {
    expect(check('page-cap', '<PageShell title="Jobs" class="max-w-5xl">x</PageShell>')).toHaveLength(1);
    expect(check('page-cap', '<div class="max-w-7xl mx-auto">x</div>')).toHaveLength(2);
    expect(check('page-cap', '<PageShell title="Jobs" class="lg:max-w-[90rem]">x</PageShell>')).toHaveLength(1);
  });
});

describe('page-width', () => {
  it('accepts a page that names its role', () => {
    expect(check('page-width', '<PageShell title="Jobs" width="wide">x</PageShell>')).toEqual([]);
  });

  it('accepts a fill page, which owns the viewport and takes no cap', () => {
    expect(check('page-width', '<PageShell title="Schema Builder" fill>x</PageShell>')).toEqual([]);
  });

  it('fails a page that leaves the width to the fallback', () => {
    // PageShell falls back to default, so an unset width reads as a choice
    // nobody made.
    expect(check('page-width', '<PageShell title="Jobs">x</PageShell>')).toHaveLength(1);
  });

  it('fails a page at another width, so neighboring screens share one edge', () => {
    expect(check('page-width', '<PageShell title="Locales" width="default">x</PageShell>')).toHaveLength(1);
    expect(check('page-width', '<PageShell title="Invite" width="narrow">x</PageShell>')).toHaveLength(1);
    expect(check('page-width', '<PageShell title="Canvas" width="full">x</PageShell>')).toEqual([]);
  });
});

describe('raw-count', () => {
  it('accepts a count that goes through the formatter', () => {
    expect(check('raw-count', '<p>{formatCount(data.total)} rows</p>')).toEqual([]);
  });

  it('leaves a formatted date alone', () => {
    // An options object is a deliberate shape, not a grouped number.
    expect(check('raw-count', "<p>{d.toLocaleString('en-US', { month: 'short' })}</p>")).toEqual([]);
  });

  it('fails a number grouped at the call site', () => {
    // With no locale the same count renders 1,234 or 1.234. With a locale
    // named here the next number still has to remember.
    expect(check('raw-count', '<p>{n.toLocaleString()}</p>')).toHaveLength(1);
    expect(check('raw-count', "<p>{n.toLocaleString('en-US')}</p>")).toHaveLength(1);
  });
});

describe('raw-date', () => {
  it('accepts a moment that goes through the formatter', () => {
    expect(check('raw-date', '<td>{formatTime(r.at)}</td><td>{formatDateTime(r.created_at)}</td>')).toEqual([]);
  });

  it('leaves a call that names its locale alone', () => {
    expect(check('raw-date', "<p>{d.toLocaleDateString('en-US', { month: 'short' })}</p>")).toEqual([]);
    expect(check('raw-date', "const axis = new Intl.DateTimeFormat('en-US', { hour: '2-digit' });")).toEqual([]);
  });

  it('leaves a name that only starts like the method alone', () => {
    expect(check('raw-date', 'const prefs = toLocalePreferences(raw);')).toEqual([]);
  });

  it('fails a date or a time with no locale, in each spelling', () => {
    // With no locale the same moment renders 14:32:07 or 2:32:07 PM.
    expect(check('raw-date', 'received = [{ at: new Date().toLocaleTimeString() }];')).toHaveLength(1);
    expect(check('raw-date', '<p>{d.toLocaleDateString()}</p>')).toHaveLength(1);
    expect(check('raw-date', "<p>{d.toLocaleDateString(undefined, { month: 'short' })}</p>")).toHaveLength(1);
    expect(check('raw-date', 'const fmt = new Intl.DateTimeFormat();')).toHaveLength(1);
  });
});

describe('trapped-scroll', () => {
  it('accepts a scrolling pane that may shrink', () => {
    expect(check('trapped-scroll', '<div class="min-h-0 flex-1 overflow-auto p-6">x</div>')).toEqual([]);
  });

  it('fails a scrolling pane that cannot', () => {
    // It grows to its content, pushes the column past the window, and the
    // frame behind it takes a second scrollbar.
    expect(check('trapped-scroll', '<div class="flex-1 overflow-auto p-6">x</div>')).toHaveLength(1);
    expect(check('trapped-scroll', '<div class="flex min-w-0 flex-1 overflow-y-auto">x</div>')).toHaveLength(1);
  });

  it('leaves a pane that scrolls a child alone', () => {
    expect(
      check('trapped-scroll', '<div class="min-w-0 flex-1 [&_textarea]:overflow-auto">x</div>'),
    ).toEqual([]);
  });

  it('leaves a scrolling box that is not a flex item alone', () => {
    expect(check('trapped-scroll', '<div class="overflow-auto rounded-xl">x</div>')).toEqual([]);
  });
});

describe('unscoped-header', () => {
  it('accepts a header that says what it heads', () => {
    expect(check('unscoped-header', '<th scope="col">Name</th>')).toEqual([]);
    expect(check('unscoped-header', '<th scope="row">Tenant</th>')).toEqual([]);
  });

  it('fails a header with no scope', () => {
    // Without it a screen reader guesses, and it guesses per table.
    expect(check('unscoped-header', '<th>Name</th>')).toHaveLength(1);
    expect(check('unscoped-header', '<th class="text-right">Cost</th>')).toHaveLength(1);
  });

  it('leaves a data cell alone', () => {
    expect(check('unscoped-header', '<td>Value</td>')).toEqual([]);
  });
});

describe('unnamed-table', () => {
  it('accepts a table that names its region', () => {
    expect(check('unnamed-table', '<Table label="Webhooks"><tbody></tbody></Table>')).toEqual([]);
  });

  it('fails a table with no accessible name', () => {
    // The scroll box is focusable, so without a label it is a stop that
    // announces "region" and nothing else.
    expect(check('unnamed-table', '<Table><tbody></tbody></Table>')).toHaveLength(1);
    expect(check('unnamed-table', '<Table dense><tbody></tbody></Table>')).toHaveLength(1);
  });
});

describe('icon-size', () => {
  it('accepts a rung named through the ladder', () => {
    for (const rung of ['xs', 'sm', 'md', 'lg', 'placeholder']) {
      expect(check('icon-size', `<Trash2 size={ICON.${rung}} class="text-danger" />`)).toEqual([]);
    }
  });

  it('fails a bare number even when it is on the ladder', () => {
    // A value is not a vocabulary: the module says what each rung is for, and
    // a literal at the call site reaches none of it.
    expect(check('icon-size', '<Trash2 size={14} />')).toHaveLength(1);
  });

  it('fails a size between two rungs', () => {
    // 13 and 15 sit either side of a rung, which is how one row action drifts.
    expect(check('icon-size', '<Trash2 size={13} />')).toHaveLength(1);
    expect(check('icon-size', '<Trash2 size={15} />')).toHaveLength(1);
    expect(check('icon-size', '<Shield size={18} aria-hidden="true" />')).toHaveLength(1);
  });

  it('fails an icon sized by a class instead of a rung', () => {
    expect(check('icon-size', '<Pencil class="h-4 w-4" />')).toHaveLength(1);
    expect(check('icon-size', '<CheckCircle class="h-5 w-5 text-success" />')).toHaveLength(1);
  });

  it('fails a half-step class as well as a whole one', () => {
    expect(check('icon-size', '<Check class="h-3.5 w-3.5" />')).toEqual([
      'h-3.5 w-3.5 sizes an icon by class; pass size={...} instead',
    ]);
    expect(check('icon-size', '<Loader class="h-2.5 w-2.5 animate-spin" />')).toHaveLength(1);
  });

  it('leaves a box that is not an icon alone', () => {
    // The rule reads a component tag, so a sized div or span is not its subject.
    expect(check('icon-size', '<div class="h-4 w-4 rounded-full bg-brand"></div>')).toEqual([]);
    expect(check('icon-size', '<Spinner size={ICON.lg} />')).toEqual([]);
  });
});

describe('page-gutter', () => {
  it('accepts a shell that names a width instead of a padding', () => {
    expect(check('page-gutter', '<PageShell title="Jobs" width="full">\n\t<div class="p-3">deeper padding is not the gutter</div>\n</PageShell>')).toEqual([]);
  });

  it('fails padding on the page root, on the shell as well as a div', () => {
    expect(check('page-gutter', '<PageShell title="Jobs" class="p-6">x</PageShell>')).toHaveLength(1);
    expect(check('page-gutter', '<div class="px-6 py-4 max-w-2xl mx-auto">x</div>')).toHaveLength(2);
    expect(check('page-gutter', '<PageShell title="Jobs" class="sm:pt-6">x</PageShell>')).toHaveLength(1);
  });
});

describe('weak-focus', () => {
  it('accepts an outline swapped for a ring on the same element', () => {
    expect(
      check(
        'weak-focus',
        '<a class="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-brand" href="#main">Skip</a>',
      ),
    ).toEqual([]);
  });

  it('leaves alpha alone where it is not the focus indicator', () => {
    expect(check('weak-focus', '<div class="rounded-lg border border-line/40 bg-brand/10 p-3">x</div>')).toEqual([]);
  });

  it('fails an outline removed with nothing put back', () => {
    expect(check('weak-focus', '<button class="rounded focus:outline-none">Prune</button>')).toHaveLength(1);
  });

  it('fails a focus color at partial alpha', () => {
    expect(check('weak-focus', '<input class="focus:ring-2 focus:ring-brand/50" />')).toHaveLength(1);
    expect(check('weak-focus', '<div class="focus-within:border-brand/50">x</div>')).toHaveLength(1);
  });
});

describe('nested-interactive', () => {
  it('accepts a Button that carries the href itself', () => {
    expect(
      check('nested-interactive', '<Button href="/admin/content/{name}" variant="ghost">Back</Button>'),
    ).toEqual([]);
  });

  it('accepts a link and a button that are siblings', () => {
    expect(check('nested-interactive', '<a href="/admin/schema">Schema</a>\n<Button>New</Button>')).toEqual([]);
  });

  it('fails a link wrapped around a button', () => {
    expect(
      check('nested-interactive', '<a href="/admin/jobs">\n\t<Button variant="ghost">Back</Button>\n</a>'),
    ).toHaveLength(1);
    expect(check('nested-interactive', '<a href="/x"><button>Back</button></a>')).toHaveLength(1);
  });

  it('fails a container made interactive by role or tabindex', () => {
    expect(
      check('nested-interactive', '<div role="button" tabindex="0"><CopyButton value="x" /></div>'),
    ).toHaveLength(1);
  });

  it('fails a clickable Card holding its own control', () => {
    // Card takes role="button" and tabindex inside the component, so nothing
    // in the page markup says the container is a control.
    const hits = check('nested-interactive', '<Card onclick={pick}><button>Add</button></Card>');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('<Card onclick>');
  });

  it('passes a plain card holding one control', () => {
    expect(check('nested-interactive', '<Card><button>Add</button></Card>')).toEqual([]);
  });
});

describe('unicode-icon', () => {
  it('leaves the same characters inside a sentence alone', () => {
    expect(check('unicode-icon', '<p class="text-xs text-muted">Rendered at 1920 × 1080</p>')).toEqual([]);
    expect(check('unicode-icon', '<p>The request moves left → right through the chain.</p>')).toEqual([]);
  });

  it('leaves an expression and the script alone', () => {
    expect(check('unicode-icon', "<span>{showToken ? tokenResult : '•'.repeat(48)}</span>")).toEqual([]);
    expect(
      check('unicode-icon', "<script>\n\tconst ABBR = { relation: '→', url: '↗' };\n</script>\n<span>{typeAbbr(f)}</span>"),
    ).toEqual([]);
    expect(check('unicode-icon', '<!-- Group status codes → presentation -->\n<Badge>{code}</Badge>')).toEqual([]);
  });

  it('fails a glyph stuck to the edge of a label', () => {
    // The shape an arrow actually arrives in. A rule that fired only on a node
    // of nothing but glyphs would miss every one of these.
    expect(check('unicode-icon', '<a href="/x">Next \u2192</a>')).toHaveLength(1);
    expect(check('unicode-icon', '<Button>\u2190 Prev</Button>')).toHaveLength(1);
  });

  it('fails a label handed to a component as a string', () => {
    expect(check('unicode-icon', `<Stat sub={on ? 'manage \u2192' : 'off'} />`)).toHaveLength(1);
  });

  it('passes a glyph between two words, which is punctuation', () => {
    expect(check('unicode-icon', '<p>Settings \u2192 API keys</p>')).toEqual([]);
  });

  it('passes a class list, which holds styling rather than words', () => {
    expect(check('unicode-icon', '<div class="mx-2 px-2">ok</div>')).toEqual([]);
  });

  it('fails a character standing on its own as an icon', () => {
    expect(check('unicode-icon', '<span class="text-faint">→</span>')).toHaveLength(1);
    expect(check('unicode-icon', '<Button aria-label="Close">×</Button>')).toHaveLength(1);
    expect(check('unicode-icon', '<li>• </li>')).toHaveLength(1);
    expect(check('unicode-icon', '<span>✓</span>')).toHaveLength(1);
  });
});

describe('raw-button on a link', () => {
  it('fails a link painted as a filled button', () => {
    // A link painted as a filled button: bg-brand, padded, rounded, an <a>.
    expect(
      check('raw-button', '<a href="/admin/schema" class="inline-flex px-4 py-2 rounded bg-brand">Go</a>'),
    ).toHaveLength(1);
  });

  it('passes a tinted chip and a padded navigation link', () => {
    expect(check('raw-button', '<a class="rounded-md bg-brand/10 px-2 py-1">New</a>')).toEqual([]);
    expect(check('raw-button', '<a class="rounded-lg px-2 py-1 hover:bg-surface-2">Docs</a>')).toEqual([]);
  });

  it('fails a bordered control with uniform padding', () => {
    // An outline button with uniform padding and a border, rolled by hand.
    expect(
      check('raw-button', '<button class="p-2 rounded-lg border border-line-strong">x</button>'),
    ).toHaveLength(1);
    // A rounded p-1 icon toggle is the copy button the prose leaves alone.
    expect(check('raw-button', '<button class="rounded p-1 text-faint">x</button>')).toEqual([]);
  });
});

describe('action-button', () => {
  const page = (actions, body = '') =>
    `<PageShell title="T">{#snippet actions()}${actions}{/snippet}${body}</PageShell>`;

  it('sizes the page header actions sm, with an icon on a create', () => {
    expect(check('action-button', page('<Button variant="primary"><Plus size={14} /> New</Button>'))).toHaveLength(1);
    expect(check('action-button', page('<Button variant="primary" size="sm">Add Provider</Button>'))).toHaveLength(1);
    expect(check('action-button', page('<Button variant="primary" size="sm"><Plus size={14} /> New</Button>'))).toEqual([]);
    expect(check('action-button', page('<Button variant="secondary" size="sm">Add role</Button>'))).toHaveLength(1);
    expect(check('action-button', page('<Button variant="secondary" size="sm"><Plus size={16} /> New tenant</Button>'))).toHaveLength(1);
    expect(check('action-button', page('<Button variant="secondary" size="sm"><Skull class="h-4 w-4" /> Dead letters</Button>'))).toHaveLength(1);
    expect(check('action-button', page('<Button variant="secondary" size="sm"><Skull size={14} /> Dead letters</Button>'))).toEqual([]);
    expect(check('action-button', page('<Button variant={on ? "secondary" : "ghost"} size="sm">6h</Button>'))).toEqual([]);
    // A SectionHeading carries an actions snippet of its own, which is not the header.
    expect(
      check('action-button', '<SectionHeading>{#snippet actions()}<Button variant="secondary">Add</Button>{/snippet}</SectionHeading>'),
    ).toEqual([]);
  });

  it('keeps the empty state action secondary and default size', () => {
    const empty = (b) => `<EmptyState title="None">{#snippet action()}${b}{/snippet}</EmptyState>`;
    expect(check('action-button', empty('<Button variant="primary"><Plus size={14} /> New key</Button>'))).toHaveLength(1);
    expect(check('action-button', empty('<Button variant="secondary" size="sm"><Plus size={14} /> New key</Button>'))).toHaveLength(1);
    expect(check('action-button', empty('<Button variant="secondary">New key</Button>'))).toHaveLength(1);
    expect(check('action-button', empty('<Button variant="secondary"><Plus size={14} /> New key</Button>'))).toEqual([]);
    // A link elsewhere is not a create and needs no icon.
    expect(check('action-button', empty('<Button variant="secondary" href="/x">Go to the schema builder</Button>'))).toEqual([]);
  });

  it('makes a row edit or delete an icon-only ghost named by aria-label', () => {
    // A text Edit beside a filled red Delete in a repeated card.
    const cards = (b) => `{#each rows as r}<Card>${b}</Card>{/each}`;
    expect(check('action-button', cards('<Button variant="ghost" size="sm">Edit</Button>'))).toHaveLength(2);
    expect(check('action-button', cards('<Button variant="danger" size="sm">Delete</Button>'))).toHaveLength(3);
    expect(
      check('action-button', cards('<Button variant="ghost" size="sm" aria-label="Delete r"><Trash2 size={14} /></Button>')),
    ).toHaveLength(1);
    expect(
      check('action-button', cards('<Button variant="ghost" size="sm" aria-label="Delete r"><Trash2 size={14} class="text-danger" /></Button>')),
    ).toEqual([]);
    // A table row is a row whatever it holds. A Configure link in one is not a CRUD control.
    expect(check('action-button', '<tr><td><Button variant="ghost" size="sm">Configure</Button></td></tr>')).toEqual([]);
    expect(check('action-button', '<tr><td><Button variant="ghost" size="sm">Edit</Button></td></tr>')).toHaveLength(2);
  });

  it('keeps a footer text only, default size, Cancel first', () => {
    const modal = (b) => `<Modal open title="T">${b}</Modal>`;
    expect(
      check('action-button', modal('<div><Button variant="ghost">Cancel</Button><Button variant="primary">Save</Button></div>')),
    ).toHaveLength(2);
    expect(
      check('action-button', modal('<div><Button variant="secondary">Cancel</Button><Button variant="danger"><Trash2 size={14} /> Delete</Button></div>')),
    ).toHaveLength(1);
    expect(
      check('action-button', modal('<div><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></div>')),
    ).toEqual([]);
    // An icon-only copy control in the body is not a footer button.
    expect(
      check('action-button', modal('<Button variant="ghost" size="sm" aria-label="Copy">{#if c}<Check size={16} />{:else}<Copy size={16} />{/if}</Button>')),
    ).toEqual([]);
    // A variant chosen by an expression is left alone.
    expect(
      check('action-button', modal("{#snippet footer()}<Button variant=\"secondary\">Cancel</Button><Button variant={d ? 'danger' : 'primary'}>Go</Button>{/snippet}")),
    ).toEqual([]);
    // A delete may lead a footer of three, apart from the primary.
    expect(
      check('action-button', modal('<div><Button variant="danger">Delete</Button><Button variant="secondary">Cancel</Button><Button variant="primary">Save</Button></div>')),
    ).toEqual([]);
    // Only one delete may lead, and Cancel still comes next.
    expect(
      check('action-button', modal('<div><Button variant="danger">Delete</Button><Button variant="primary">Save</Button><Button variant="secondary">Cancel</Button></div>')),
    ).toHaveLength(1);
    expect(
      check('action-button', modal('<div><Button variant="danger">Delete</Button><Button variant="secondary">Cancel</Button><Button variant="danger">Remove</Button></div>')),
    ).toHaveLength(1);
    expect(
      check('action-button', modal('<div><Button variant="danger">Delete</Button><Button variant="primary">Save</Button></div>')),
    ).toHaveLength(1);
  });
});

describe('heading-icon', () => {
  it('leaves a text heading and its actions snippet alone', () => {
    expect(check('heading-icon', '<SectionHeading level={2}>Export subject data</SectionHeading>')).toEqual([]);
    expect(
      check(
        'heading-icon',
        '<SectionHeading level={3}>Changelog{#snippet actions()}<Button size="sm"><ChevronDown size={ICON.sm} /></Button>{/snippet}</SectionHeading>',
      ),
    ).toEqual([]);
  });

  it('fails an icon set beside the heading', () => {
    expect(
      check(
        'heading-icon',
        '<div class="flex items-center gap-2"><Database size={ICON.md} class="text-muted" /><SectionHeading level={2}>Connection pool</SectionHeading></div>',
      ),
    ).toHaveLength(1);
  });

  it('fails an icon in front of the heading text', () => {
    expect(
      check(
        'heading-icon',
        '<SectionHeading level={2}><span class="flex items-center gap-2"><Download size={ICON.md} aria-hidden="true" /> Export subject data</span></SectionHeading>',
      ),
    ).toHaveLength(1);
  });
});

describe('title-case', () => {
  it('leaves sentence case, acronyms and inner capitals alone', () => {
    expect(check('title-case', '<SectionHeading>External API access</SectionHeading>')).toEqual([]);
    expect(check('title-case', '<PageShell title="OAuth providers" width="default">')).toEqual([]);
    expect(check('title-case', '<Input id="a" label="Subject (email or ID)" />')).toEqual([]);
    expect(check('title-case', '<Option label="Google Sheets" />')).toEqual([]);
  });

  it('reads each part of a tab title as its own phrase', () => {
    expect(check('title-case', '<PageTitle title="Retention and holds - Audit log" />')).toEqual([]);
    expect(check('title-case', '<PageTitle title="Retention And Holds - Audit log" />')).toHaveLength(1);
    expect(check('title-case', '<PageShell title="Audit log" documentTitle="Retention and holds - Audit log"></PageShell>')).toEqual([]);
    expect(check('title-case', '<PageShell title="Audit log" documentTitle="Retention And Holds - Audit log"></PageShell>')).toHaveLength(1);
  });

  it('leaves a label built by an expression alone', () => {
    expect(check('title-case', '<PageShell title={p?.name ?? \'Provider\'} width="default">')).toEqual([]);
  });

  it('fails a Title Case heading, title and label', () => {
    expect(check('title-case', '<SectionHeading>Delete Subject Data</SectionHeading>')).toHaveLength(1);
    expect(check('title-case', '<Card title="Recent Activity" />')).toHaveLength(1);
    expect(check('title-case', '<Input id="a" label="Expires At" />')).toHaveLength(1);
  });
});

describe('the rule set', () => {
  it('selects files for every rule', () => {
    for (const rule of rules) expect(rule.files.length, rule.id).toBeGreaterThan(0);
  });
});
