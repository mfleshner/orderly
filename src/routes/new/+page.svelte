<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { copyableRestaurants, createGroup, friendlyError } from '$lib/api';
	import { formatItems } from '$lib/format';
	import type { CopyableRestaurant } from '$lib/types';

	const LAST_NAME_KEY = 'uo:lastName';

	let groupName = $state('');
	let yourName = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let groupInput = $state<HTMLInputElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	// Restaurants from your other groups, all checked by default.
	let copyable = $state<CopyableRestaurant[]>([]);
	let picked = $state<Record<string, boolean>>({});
	const pickedIds = $derived(copyable.filter((r) => picked[r.id]).map((r) => r.id));
	const allPicked = $derived(copyable.length > 0 && pickedIds.length === copyable.length);

	function toggleAll() {
		const next = !allPicked;
		picked = Object.fromEntries(copyable.map((r) => [r.id, next]));
	}

	onMount(() => {
		try {
			yourName = localStorage.getItem(LAST_NAME_KEY) ?? '';
		} catch {
			// storage unavailable (private mode etc.)
		}
		groupInput?.focus();
		copyableRestaurants()
			.then((list) => {
				copyable = list;
				picked = Object.fromEntries(list.map((r) => [r.id, true]));
			})
			.catch(() => {
				// Not critical: without the list, the group just starts empty.
			});
	});

	function nextField(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			nameInput?.focus();
		}
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const g = groupName.trim();
		const n = yourName.trim();
		if (!g) return groupInput?.focus();
		if (!n) return nameInput?.focus();
		if (busy) return;
		busy = true;
		error = null;
		try {
			const id = await createGroup(g, n, pickedIds);
			try {
				localStorage.setItem(LAST_NAME_KEY, n);
			} catch {
				// ignore
			}
			await goto(`/g/${id}/members?created=1`, { replaceState: true });
		} catch (err) {
			error = friendlyError(err);
			busy = false;
		}
	}
</script>

<Header title="New group" back="/" />

<form id="new-group" class="px-4 pt-6 pb-32" onsubmit={submit}>
	<p class="px-1 pb-6 text-[16px] text-ink-2">
		Name it, add yourself, and you'll get a link to text your friends.
	</p>

	<label class="block">
		<span class="label px-1">Group name</span>
		<input
			bind:this={groupInput}
			bind:value={groupName}
			class="input"
			placeholder="Friday lunch crew"
			maxlength="40"
			autocomplete="off"
			autocapitalize="words"
			enterkeyhint="next"
			onkeydown={nextField}
		/>
	</label>

	<label class="mt-5 block">
		<span class="label px-1">Your name</span>
		<input
			bind:this={nameInput}
			bind:value={yourName}
			class="input"
			placeholder="What your friends call you"
			maxlength="30"
			autocomplete="off"
			autocapitalize="words"
			enterkeyhint="go"
		/>
	</label>

	{#if copyable.length}
		<section class="mt-8">
			<div class="flex items-end justify-between gap-3 px-1 pb-2">
				<div>
					<h2 class="text-[17px] font-bold">Bring your restaurants</h2>
					<p class="text-[14px] text-ink-3">Your usuals come too.</p>
				</div>
				<button type="button" class="min-h-11 shrink-0 px-1 text-[15px] font-semibold text-accent-ink" onclick={toggleAll}>
					{allPicked ? 'Select none' : 'Select all'}
				</button>
			</div>
			<div class="card divide-hair overflow-hidden">
				{#each copyable as r (r.id)}
					{@const usual = formatItems(r.items)}
					<label class="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 active:bg-line/40">
						<input type="checkbox" class="peer sr-only" bind:checked={picked[r.id]} />
						<span
							class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-line bg-card text-white transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
							aria-hidden="true"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
						</span>
						<span class="min-w-0 flex-1">
							<span class="block text-[17px] leading-snug font-semibold break-words">{r.name}</span>
							<span class="block text-[13px] leading-snug text-ink-3 break-words">
								{#if r.note}{r.note} · {/if}from {r.groups.join(', ')}
							</span>
							<span class="mt-0.5 block text-[15px] leading-snug break-words {usual ? 'text-ink-2' : 'text-ink-3 italic'}">
								{usual ? `Your usual: ${usual}` : 'No usual yet'}
							</span>
						</span>
					</label>
				{/each}
			</div>
		</section>
	{/if}

	{#if error}
		<p class="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-[15px] text-accent-ink" role="alert">
			{error}
		</p>
	{/if}
</form>

<div class="fixed inset-x-0 bottom-0 z-20">
	<div class="pb-safe mx-auto max-w-[520px] border-t border-line bg-paper/90 backdrop-blur-md">
		<div class="px-4 py-3">
			<button type="submit" form="new-group" class="btn-primary w-full" disabled={busy}>
				{busy
					? 'Creating…'
					: pickedIds.length
						? `Create group · ${pickedIds.length} ${pickedIds.length === 1 ? 'restaurant' : 'restaurants'}`
						: 'Create group'}
			</button>
		</div>
	</div>
</div>
