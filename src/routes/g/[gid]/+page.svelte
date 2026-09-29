<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { auth } from '$lib/auth.svelte';
	import {
		addRestaurant,
		friendlyError,
		getGroup,
		getMyMember,
		listOpenRuns,
		listRestaurants,
		usualCounts
	} from '$lib/api';
	import type { Group, Member, OpenRunSummary, Restaurant } from '$lib/types';

	/** Open runs older than this drop off the banner (RUNS.md open decision). */
	const STALE_RUN_MS = 12 * 60 * 60 * 1000;

	const gid = $derived(page.params.gid ?? '');

	let loading = $state(true);
	let error = $state<string | null>(null);
	let notMember = $state(false);
	let group = $state<Group | null>(null);
	let me = $state<Member | null>(null);
	let restaurants = $state<Restaurant[]>([]);
	let counts = $state<Record<string, number>>({});
	let openRuns = $state<OpenRunSummary[]>([]);

	let query = $state('');
	let adding = $state(false);
	let newName = $state('');
	let newNote = $state('');
	let saving = $state(false);
	let addError = $state<string | null>(null);
	let noteInput = $state<HTMLInputElement | null>(null);

	async function load(groupId: string) {
		loading = true;
		error = null;
		notMember = false;
		try {
			const member = await getMyMember(groupId, auth.user!.id);
			if (!member) {
				notMember = true;
				return;
			}
			me = member;
			const [g, rs, c, runs] = await Promise.all([
				getGroup(groupId),
				listRestaurants(groupId),
				usualCounts(groupId),
				// Banners are a nice-to-have: a failure here just hides them.
				listOpenRuns(groupId).catch(() => [] as OpenRunSummary[])
			]);
			group = g;
			restaurants = rs;
			counts = c;
			const cutoff = Date.now() - STALE_RUN_MS;
			openRuns = runs.filter((r) => {
				const t = Date.parse(r.created_at);
				return Number.isNaN(t) || t >= cutoff;
			});
		} catch (e) {
			error = friendlyError(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (gid) load(gid);
	});

	const q = $derived(query.trim().toLowerCase());
	const filtered = $derived(
		q
			? restaurants.filter(
					(r) => r.name.toLowerCase().includes(q) || (r.note ?? '').toLowerCase().includes(q)
				)
			: restaurants
	);
	const exactMatch = $derived(restaurants.some((r) => r.name.trim().toLowerCase() === q));
	const showAddRow = $derived(q.length > 0 && !exactMatch && !adding);

	async function openAdd() {
		newName = query.trim();
		newNote = '';
		addError = null;
		adding = true;
		await tick();
		noteInput?.focus();
	}

	function cancelAdd() {
		adding = false;
		addError = null;
	}

	async function submitAdd(e: SubmitEvent) {
		e.preventDefault();
		if (!newName.trim() || saving) return;
		saving = true;
		addError = null;
		try {
			const r = await addRestaurant(gid, newName, newNote);
			await goto(`/g/${gid}/r/${r.id}`);
		} catch (err) {
			addError = friendlyError(err);
		} finally {
			saving = false;
		}
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		if (showAddRow) openAdd();
		else if (filtered.length === 1) goto(`/g/${gid}/r/${filtered[0].id}`);
	}

	function usualLabel(n: number | undefined) {
		if (!n) return 'No usuals yet';
		return n === 1 ? '1 usual' : `${n} usuals`;
	}
</script>

<svelte:head>
	<title>{group?.name ?? 'Group'} · Usual Order</title>
</svelte:head>

<Header title={group?.name ?? (notMember ? 'Not in this group' : '')} back="/">
	{#snippet right()}
		{#if group}
			<a
				href={`/g/${gid}/members`}
				aria-label="Members"
				class="flex h-11 w-11 items-center justify-center rounded-full text-accent-ink active:bg-line/60"
			>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.8a3.2 3.2 0 0 1 0 6.3" /><path d="M18 14.8c2 .7 3.2 2.5 3.5 5.2" /></svg>
			</a>
		{/if}
	{/snippet}
</Header>

<main class="px-4 pt-4 pb-16">
	{#if loading}
		<div class="flex justify-center py-16">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"></div>
		</div>
	{:else if notMember}
		<div class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-[20px] font-bold">You're not in this group</p>
			<p class="text-ink-2">Ask a friend for the invite link to join.</p>
			<a href="/" class="btn-secondary mt-2">Go home</a>
		</div>
	{:else if error}
		<div class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-[20px] font-bold">Hmm, that didn't load</p>
			<p class="text-ink-2">{error}</p>
			<button class="btn-secondary mt-2" onclick={() => load(gid)}>Try again</button>
		</div>
	{:else}
		{#if openRuns.length}
			<div class="mb-3 flex flex-col gap-2">
				{#each openRuns as run (run.id)}
					{@const note = run.note?.trim()}
					<a
						href={`/g/${gid}/run/${run.id}`}
						class="flex min-h-14 items-center gap-3 rounded-card border border-accent/25 bg-accent-soft px-4 py-3 text-accent-ink active:scale-[0.99] active:bg-accent/15"
					>
						<span class="relative flex h-3 w-3 shrink-0" aria-hidden="true">
							<span class="absolute inset-0 animate-ping rounded-full bg-accent opacity-60"></span>
							<span class="relative h-3 w-3 rounded-full bg-accent"></span>
						</span>
						<span class="min-w-0 flex-1 text-[17px] leading-snug break-words">
							{#if run.starter_name}{run.starter_name} is going to <span class="font-bold">{run.restaurant_name || 'get food'}</span>{:else}<span class="font-bold">{run.restaurant_name || 'Food'} run</span>{/if}
							{#if note}· {note}{/if} · {run.participant_count} in
						</span>
						<svg class="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
					</a>
				{/each}
			</div>
		{/if}

		<!-- Search doubles as "add restaurant" -->
		<div class="relative">
			<svg class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
			<input
				class="input pr-11 pl-11"
				type="search"
				placeholder={restaurants.length ? 'Find or add a restaurant' : 'Add a restaurant'}
				bind:value={query}
				onkeydown={onSearchKey}
				oninput={() => adding && cancelAdd()}
				autocapitalize="words"
				autocomplete="off"
				enterkeyhint={showAddRow ? 'done' : 'search'}
				aria-label="Find or add a restaurant"
			/>
			{#if query}
				<button
					type="button"
					aria-label="Clear"
					class="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 active:bg-line/60"
					onclick={() => {
						query = '';
						cancelAdd();
					}}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
				</button>
			{/if}
		</div>

		{#if adding}
			<form class="card mt-3 p-4" onsubmit={submitAdd}>
				<label class="label" for="new-name">Restaurant</label>
				<input
					id="new-name"
					class="input"
					bind:value={newName}
					autocapitalize="words"
					autocomplete="off"
					enterkeyhint="next"
					required
				/>
				<label class="label mt-4" for="new-note">Note <span class="normal-case tracking-normal font-normal">(optional)</span></label>
				<input
					id="new-note"
					class="input"
					bind:this={noteInput}
					bind:value={newNote}
					placeholder="Which one? e.g. the one on Eldorado"
					autocapitalize="sentences"
					autocomplete="off"
					enterkeyhint="done"
				/>
				{#if addError}
					<p class="mt-3 text-[15px] text-danger">{addError}</p>
				{/if}
				<div class="mt-4 flex gap-2">
					<button type="button" class="btn-secondary flex-1" onclick={cancelAdd}>Cancel</button>
					<button type="submit" class="btn-primary flex-[2]" disabled={saving || !newName.trim()}>
						{saving ? 'Adding…' : 'Add restaurant'}
					</button>
				</div>
			</form>
		{/if}

		{#if restaurants.length === 0 && !showAddRow && !adding}
			<div class="flex flex-col items-center gap-2 px-6 py-14 text-center">
				<div class="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
					<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10" /><path d="M17 21V3c-2.2 1.2-3.5 3.8-3.5 7v3H17" /></svg>
				</div>
				<p class="text-[20px] font-bold">No restaurants yet</p>
				<p class="text-ink-2">Type your crew's go-to spot above to add the first one.</p>
			</div>
		{:else if showAddRow || filtered.length > 0}
			<ul class="card divide-hair mt-3 overflow-hidden">
				{#if showAddRow}
					<li>
						<button
							type="button"
							class="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-accent-soft"
							onclick={openAdd}
						>
							<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
							</span>
							<span class="min-w-0 flex-1 text-[17px] font-semibold break-words text-accent-ink">
								Add “{query.trim()}”
							</span>
						</button>
					</li>
				{/if}
				{#each filtered as r (r.id)}
					<li>
						<a
							href={`/g/${gid}/r/${r.id}`}
							class="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-line/40"
						>
							<div class="min-w-0 flex-1">
								<p class="text-[17px] leading-snug font-semibold break-words">{r.name}</p>
								{#if r.note}
									<p class="text-[14px] leading-snug break-words text-ink-3">{r.note}</p>
								{/if}
							</div>
							<span
								class="shrink-0 text-[13px] font-medium {counts[r.id]
									? 'text-ink-2'
									: 'text-ink-3'}">{usualLabel(counts[r.id])}</span
							>
							<svg class="shrink-0 text-ink-3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
