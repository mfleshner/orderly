<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { toast } from '$lib/components/Toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import {
		deleteRestaurant,
		friendlyError,
		getMyMember,
		getRestaurant,
		getRestaurantOrders,
		updateRestaurant
	} from '$lib/api';
	import { copyText, formatCopyOrder, formatItems } from '$lib/format';
	import type { Member, MemberOrder, Restaurant } from '$lib/types';

	const gid = $derived(page.params.gid ?? '');
	const rid = $derived(page.params.rid ?? '');

	let loading = $state(true);
	let error = $state<string | null>(null);
	let notMember = $state(false);
	let me = $state<Member | null>(null);
	let restaurant = $state<Restaurant | null>(null);
	let rows = $state<MemberOrder[]>([]);
	let canShare = $state(false);

	// Rename / delete sheet
	let sheetOpen = $state(false);
	let editName = $state('');
	let editNote = $state('');
	let sheetBusy = $state(false);
	let sheetError = $state<string | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	let seq = 0;

	/** `quiet` refreshes in place (focus / visibility) without the spinner or clobbering on error. */
	async function load(groupId: string, restaurantId: string, quiet = false) {
		const mine = ++seq;
		if (!quiet) {
			loading = true;
			error = null;
			notMember = false;
		}
		try {
			const member = await getMyMember(groupId, auth.user!.id);
			if (mine !== seq) return;
			if (!member) {
				notMember = true;
				return;
			}
			const [r, orders] = await Promise.all([
				getRestaurant(restaurantId),
				getRestaurantOrders(groupId, restaurantId)
			]);
			if (mine !== seq) return;
			me = member;
			restaurant = r;
			rows = orders;
			error = null;
		} catch (e) {
			if (mine === seq && !quiet) error = friendlyError(e);
		} finally {
			if (mine === seq) loading = false;
		}
	}

	$effect(() => {
		if (gid && rid) load(gid, rid);
	});

	onMount(() => {
		canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
		const refresh = () => {
			if (document.visibilityState === 'visible' && !loading && !sheetOpen && gid && rid) {
				load(gid, rid, true);
			}
		};
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

	const hasUsual = (r: MemberOrder) => !!r.order && r.order.order_items.length > 0;

	const sorted = $derived.by(() => {
		const byName = (a: MemberOrder, b: MemberOrder) =>
			a.member.display_name.localeCompare(b.member.display_name, undefined, {
				sensitivity: 'base'
			});
		const mine = rows.filter((r) => r.member.id === me?.id);
		const others = rows.filter((r) => r.member.id !== me?.id);
		return [
			...mine,
			...others.filter(hasUsual).sort(byName),
			...others.filter((r) => !hasUsual(r)).sort(byName)
		];
	});

	const usualCount = $derived(rows.filter(hasUsual).length);
	const orderText = $derived(restaurant ? formatCopyOrder(restaurant.name, sorted) : '');

	function editHref(memberId: string) {
		return `/g/${gid}/r/${rid}/edit?m=${memberId}`;
	}

	async function copyOrder() {
		if (!usualCount) return;
		const ok = await copyText(orderText);
		toast(ok ? 'Copied — paste it anywhere' : "Couldn't copy. Try Share instead.");
	}

	async function shareOrder() {
		if (!usualCount) return;
		try {
			await navigator.share({ text: orderText });
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			const ok = await copyText(orderText);
			if (ok) toast('Copied — paste it anywhere');
		}
	}

	async function openSheet() {
		if (!restaurant) return;
		editName = restaurant.name;
		editNote = restaurant.note ?? '';
		sheetError = null;
		sheetOpen = true;
		await tick();
		nameInput?.focus();
	}

	function closeSheet() {
		if (!sheetBusy) sheetOpen = false;
	}

	async function saveRestaurant(e: SubmitEvent) {
		e.preventDefault();
		if (!restaurant || !editName.trim() || sheetBusy) return;
		sheetBusy = true;
		sheetError = null;
		const patch = { name: editName.trim(), note: editNote.trim() || null };
		try {
			await updateRestaurant(restaurant.id, patch);
			restaurant = { ...restaurant, ...patch };
			sheetOpen = false;
			toast('Saved');
		} catch (err) {
			sheetError = friendlyError(err);
		} finally {
			sheetBusy = false;
		}
	}

	async function removeRestaurant() {
		if (!restaurant || sheetBusy) return;
		const n = usualCount;
		const extra = n ? ` Everyone's usuals here (${n}) go with it.` : '';
		if (!confirm(`Delete ${restaurant.name}?${extra}`)) return;
		sheetBusy = true;
		sheetError = null;
		try {
			await deleteRestaurant(restaurant.id);
			sheetOpen = false;
			toast('Restaurant deleted');
			await goto(`/g/${gid}`, { replaceState: true });
		} catch (err) {
			sheetError = friendlyError(err);
		} finally {
			sheetBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{restaurant?.name ?? 'Restaurant'} · Usual Order</title>
</svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && sheetOpen && closeSheet()} />

<Header
	title={restaurant?.name ?? (notMember ? 'Not in this group' : '')}
	subtitle={restaurant?.note}
	back={`/g/${gid}`}
>
	{#snippet right()}
		{#if restaurant}
			<button
				type="button"
				aria-label="Rename or delete restaurant"
				class="flex h-11 w-11 items-center justify-center rounded-full text-accent-ink active:bg-line/60"
				onclick={openSheet}
			>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
			</button>
		{/if}
	{/snippet}
</Header>

<main class="px-4 pt-4 pb-36">
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
			<button class="btn-secondary mt-2" onclick={() => load(gid, rid)}>Try again</button>
		</div>
	{:else}
		<ul class="card divide-hair overflow-hidden">
			{#each sorted as row (row.member.id)}
				{@const isMe = row.member.id === me?.id}
				{@const trying = row.order?.trying_note?.trim()}
				<li class="flex items-start gap-3 py-4 pr-2 pl-4">
					<span
						class="mt-[7px] h-3.5 w-3.5 shrink-0 rounded-full"
						style:background-color={row.member.color}
						aria-hidden="true"
					></span>
					<div class="min-w-0 flex-1">
						<p class="text-[19px] leading-snug font-bold break-words">
							{row.member.display_name}
							{#if isMe}<span class="font-normal text-ink-3">(you)</span>{/if}
						</p>
						{#if hasUsual(row)}
							<p class="mt-1 text-[18px] leading-normal break-words text-ink">
								{formatItems(row.order!.order_items)}
							</p>
						{:else}
							<a
								href={editHref(row.member.id)}
								class="-mx-1 mt-0.5 inline-flex min-h-11 items-center rounded-lg px-1 text-[17px] font-semibold text-accent-ink active:bg-accent-soft"
							>
								No usual yet — add one
							</a>
						{/if}
						{#if trying}
							<p
								class="mt-2 inline-block rounded-lg bg-warn-soft px-2.5 py-1 text-[15px] leading-snug break-words text-warn"
							>
								<span class="font-semibold">Trying:</span>
								{trying}
							</p>
						{/if}
					</div>
					{#if hasUsual(row) || trying}
						<a
							href={editHref(row.member.id)}
							aria-label={`Edit ${row.member.display_name}'s order`}
							class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 active:bg-line/60 active:text-accent-ink"
						>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
		{#if rows.length === 0}
			<p class="py-10 text-center text-ink-3">No one's in this group yet.</p>
		{/if}
	{/if}
</main>

{#if !loading && !error && !notMember && restaurant}
	<div class="fixed inset-x-0 bottom-0 z-30">
		<div
			class="pb-safe mx-auto max-w-[520px] border-t border-line bg-paper/90 backdrop-blur-md"
		>
			<div class="flex gap-2 px-4 pt-3 pb-3">
				{#if canShare}
					<button
						type="button"
						class="btn-secondary min-h-14 shrink-0 px-4"
						onclick={shareOrder}
						disabled={!usualCount}
						aria-label="Share order"
					>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
						<span class="text-[15px]">Share</span>
					</button>
				{/if}
				<button
					type="button"
					class="btn-primary min-h-14 flex-1 text-[18px]"
					onclick={copyOrder}
					disabled={!usualCount}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
					{#if usualCount}
						Copy order · {usualCount} {usualCount === 1 ? 'person' : 'people'}
					{:else}
						No usuals to copy yet
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if sheetOpen && restaurant}
	<div class="fixed inset-0 z-40">
		<button
			type="button"
			class="absolute inset-0 bg-ink/40"
			aria-label="Close"
			onclick={closeSheet}
		></button>
		<div class="absolute inset-x-0 bottom-0">
			<form
				class="pb-safe mx-auto max-w-[520px] rounded-t-[20px] border-t border-line bg-card shadow-2xl"
				onsubmit={saveRestaurant}
			>
				<div class="px-4 pt-3 pb-4">
					<div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line"></div>
					<p class="mb-4 text-[19px] font-bold">Edit restaurant</p>
					<label class="label" for="r-name">Name</label>
					<input
						id="r-name"
						class="input"
						bind:this={nameInput}
						bind:value={editName}
						autocapitalize="words"
						autocomplete="off"
						enterkeyhint="next"
						required
					/>
					<label class="label mt-4" for="r-note"
						>Note <span class="font-normal tracking-normal normal-case">(optional)</span></label
					>
					<input
						id="r-note"
						class="input"
						bind:value={editNote}
						placeholder="Which one? e.g. the one on Eldorado"
						autocapitalize="sentences"
						autocomplete="off"
						enterkeyhint="done"
					/>
					{#if sheetError}
						<p class="mt-3 text-[15px] text-danger">{sheetError}</p>
					{/if}
					<div class="mt-5 flex gap-2">
						<button type="button" class="btn-secondary flex-1" onclick={closeSheet}>Cancel</button>
						<button
							type="submit"
							class="btn-primary flex-[2]"
							disabled={sheetBusy || !editName.trim()}
						>
							{sheetBusy ? 'Saving…' : 'Save'}
						</button>
					</div>
					<button
						type="button"
						class="btn mt-3 w-full text-danger active:bg-danger/10"
						onclick={removeRestaurant}
						disabled={sheetBusy}
					>
						Delete restaurant
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
