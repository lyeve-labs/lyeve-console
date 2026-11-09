<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		Input,
		MultiSelect,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Textarea,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from '@lucide/svelte';
	import { confirmed } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';
	import { ROLE_CHOICES, editablePage, type Block, type BlockType, type CustomPage } from '$lib/api/customization';
	import type { PageData, ActionData } from './$types';
	import GateNotice from '$lib/components/GateNotice.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The page is edited as one document and sent whole: a block list is
	 * reordered and edited in place, and a partial save would leave a page the
	 * engine never validated as a whole. The copy is filled out so every
	 * field a control binds exists, whatever the engine left out.
	 */
	// svelte-ignore state_referenced_locally
	let page = $state<CustomPage>(editablePage(data.customPage));
	$effect.pre(() => {
		page = editablePage(data.customPage);
	});
	let saving = $state(false);

	const roleOptions = ROLE_CHOICES.map((r) => ({ value: r, label: r }));
	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));

	/**
	 * The schema options with the ones a block already names added, so a block
	 * keeps its schemas on screen when the list could not be read.
	 */
	function withOwn(own: readonly (string | undefined)[]) {
		const names = new Set(data.schemas);
		const extra = own.filter((s): s is string => !!s && !names.has(s));
		return [...schemaOptions, ...extra.map((s) => ({ value: s, label: s }))];
	}
	const toneOptions = [
		{ value: 'brand', label: 'Brand' },
		{ value: 'neutral', label: 'Neutral' },
		{ value: 'success', label: 'Success' },
		{ value: 'warn', label: 'Warning' },
		{ value: 'danger', label: 'Danger' },
	];
	const statusOptions = [
		{ value: '', label: 'Any status' },
		{ value: 'published', label: 'Published' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	const BLOCK_LABELS: Record<BlockType, string> = {
		markdown: 'Text',
		callout: 'Callout',
		content: 'Content list',
		stats: 'Counts',
		links: 'Links',
	};

	function newBlock(type: BlockType): Block {
		switch (type) {
			case 'markdown':
				return { type, title: '', body: '' };
			case 'callout':
				return { type, title: '', body: '', tone: 'brand' };
			case 'content':
				return { type, title: '', schema: data.schemas[0] ?? '', status: '', limit: 5 };
			case 'stats':
				return { type, title: '', schemas: [] };
			case 'links':
				return { type, title: '', links: [{ label: '', url: 'https://' }] };
		}
	}

	function addBlock(type: BlockType) {
		page.blocks = [...page.blocks, newBlock(type)];
	}
	function move(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= page.blocks.length) return;
		const next = [...page.blocks];
		[next[i], next[j]] = [next[j], next[i]];
		page.blocks = next;
	}
	function remove(i: number) {
		page.blocks = page.blocks.filter((_, k) => k !== i);
	}

	const save: SubmitFunction = () => {
		saving = true;
		return async ({ update }) => {
			saving = false;
			await update({ reset: false, invalidateAll: true });
		};
	};

	// Built at submit time, so the question carries the title as edited.
	const confirmDelete: SubmitFunction = (input) =>
		confirmed(`Delete ${page.title}?`, 'Its menu entry is removed too, and the dashboard stops showing it.', {
			confirmLabel: 'Delete',
		})(input);
</script>

<PageShell
	title={data.customPage.title}
	documentTitle={`${page.title || 'Page'} - Customization`}
	description="Build the page from blocks."
	width="wide"
	back={{ href: '/admin/settings/customization/pages', label: 'Customization' }}
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		<Button variant="secondary" size="sm" href="/admin/pages/{data.customPage.slug}">
			<ExternalLink size={ICON.sm} /> View page
		</Button>
	{/snippet}

	<form method="POST" action="?/save" class="flex flex-col gap-6" use:enhance={save}>
		<input type="hidden" name="page" value={JSON.stringify(page)} />
		{#if form?.error}
			<Alert tone="danger">{form.error}</Alert>
		{:else if form && 'saved' in form}
			<Alert tone="success" autoDismiss>Page saved.</Alert>
		{/if}

		{#if data.schemasGate.state !== 'ok'}
			<GateNotice
				level={2}
				gate={data.schemasGate}
				title="The content type list"
				absent="The content type list is not included in this build, so you cannot choose a content type below."
			/>
		{/if}

		<Card pad="md">
			{#snippet header()}
				<SectionHeading level={2}>Page</SectionHeading>
			{/snippet}
			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Input id="page-title" label="Title" required bind:value={page.title} />
				<CheckboxGroup label="Seen by" hint="Leave empty for everyone in this tenant." orientation="horizontal" options={roleOptions} bind:value={page.roles} />
				<div class="lg:col-span-2">
					<Textarea id="page-description" label="Description" rows={2} hint="Shown under the title." bind:value={page.description} />
				</div>
			</div>
		</Card>

		{#each page.blocks as block, i (i)}
			<Card pad="md">
				{#snippet header()}
					<div class="flex items-center justify-between gap-2">
						<SectionHeading level={3}>{i + 1}. {BLOCK_LABELS[block.type]}</SectionHeading>
						<div class="flex items-center gap-1">
							<Button variant="ghost" size="sm" type="button" aria-label="Move block {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}>
								<ArrowUp size={ICON.sm} />
							</Button>
							<Button variant="ghost" size="sm" type="button" aria-label="Move block {i + 1} down" disabled={i === page.blocks.length - 1} onclick={() => move(i, 1)}>
								<ArrowDown size={ICON.sm} />
							</Button>
							<Button variant="ghost" size="sm" type="button" aria-label="Remove block {i + 1}" onclick={() => remove(i)}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					</div>
				{/snippet}
				<div class="flex flex-col gap-4">
					<Input id="block-{i}-title" label="Heading" hint="Optional." bind:value={block.title} />
					{#if block.type === 'markdown'}
						<Textarea id="block-{i}-body" label="Text" rows={8} mono hint="Markdown: headings, lists, links, bold, italic and code." bind:value={block.body} />
					{:else if block.type === 'callout'}
						<Textarea id="block-{i}-body" label="Text" rows={3} bind:value={block.body} />
						<Select id="block-{i}-tone" label="Tone" options={toneOptions} value={block.tone || 'brand'} onvaluechange={(v) => (block.tone = v as Block['tone'])} />
					{:else if block.type === 'content'}
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<Select id="block-{i}-schema" label="Content type" searchable options={withOwn([block.schema])} value={block.schema ?? ''} onvaluechange={(v) => (block.schema = v)} />
							<SegmentedControl label="Status" options={statusOptions} value={block.status ?? ''} onchange={(v) => (block.status = v as Block['status'])} />
							<NumberInput id="block-{i}-limit" label="Entries" min={1} max={50} bind:value={block.limit} />
						</div>
					{:else if block.type === 'stats'}
						<MultiSelect
							id="block-{i}-schemas"
							label="Content types to count"
							placeholder="Choose content types"
							hint="Up to 12."
							searchable
							options={withOwn(block.schemas ?? [])}
							bind:value={block.schemas}
						/>
					{:else if block.type === 'links'}
						<div class="flex flex-col gap-3">
							<!-- No field in the row carries a hint, so every control ends on
							     one line and the remove button centers on it. The one hint
							     the addresses share sits under the list. -->
							{#each block.links ?? [] as link, j (j)}
								<div class="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
									<Input id="block-{i}-link-{j}-label" label="Label" bind:value={link.label} />
									<Input id="block-{i}-link-{j}-url" label="Address" mono bind:value={link.url} />
									<div class="flex h-control items-center">
										<Button variant="ghost" size="sm" type="button" aria-label="Remove link {j + 1}" onclick={() => (block.links = (block.links ?? []).filter((_, k) => k !== j))}>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</div>
								</div>
							{/each}
							<p class="text-xs text-faint">Use an https URL or an admin path starting /admin/.</p>
							<div>
								<Button variant="secondary" size="sm" type="button" onclick={() => (block.links = [...(block.links ?? []), { label: '', url: 'https://' }])}>
									<Plus size={ICON.sm} /> Add link
								</Button>
							</div>
						</div>
					{/if}
				</div>
			</Card>
		{/each}

		<section class="flex flex-col gap-3">
			<SectionHeading level={2}>Add a block</SectionHeading>
			<div class="flex flex-wrap gap-2">
				<Button variant="secondary" size="sm" type="button" onclick={() => addBlock('markdown')}><Plus size={ICON.sm} /> Add text</Button>
				<Button variant="secondary" size="sm" type="button" onclick={() => addBlock('callout')}><Plus size={ICON.sm} /> Add callout</Button>
				<Button variant="secondary" size="sm" type="button" onclick={() => addBlock('content')}><Plus size={ICON.sm} /> Add content list</Button>
				<Button variant="secondary" size="sm" type="button" onclick={() => addBlock('stats')}><Plus size={ICON.sm} /> Add counts</Button>
				<Button variant="secondary" size="sm" type="button" onclick={() => addBlock('links')}><Plus size={ICON.sm} /> Add links</Button>
			</div>
		</section>

		<div class="flex items-center gap-2">
			<Button variant="primary" type="submit" loading={saving}>Save</Button>
		</div>
	</form>

	<form method="POST" action="?/delete" use:enhance={confirmDelete}>
		<Button variant="danger" size="sm" type="submit"><Trash2 size={ICON.sm} /> Delete page</Button>
	</form>
</PageShell>
