<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Header from '$lib/components/Header.svelte';
	import { toast } from '$lib/components/Toast.svelte';
	import OrderItemsEditor, {
		cleanItems,
		newRow,
		type EditorRow
	} from '$lib/components/OrderItemsEditor.svelte';
	import { auth } from '$lib/auth.svelte';
	import {
		addParticipant,
		closeRun,
		friendlyError,
		getMyMember,
		getRestaurant,
		getRestaurantOrders,
		getRun,
		listParticipants,
		recentParticipation,
		removeParticipant,
		saveOrder,
		setOverride
	} from '$lib/api';
	import { copyText, formatItems, formatRunCopy } from '$lib/format';
	import type { Member, MemberOrder, OrderItem, Restaurant, Run, RunParticipant } from '$lib/types';

	type JoinStep = 'confirm' | 'different' | 'make-usual' | 'new';
	type Sheet =
		| { kind: 'join'; memberId: string; step: JoinStep; participantId?: string }
		| { kind: 'in'; participantId: string };

	const gid = $derived(page.params.gid ?? '');
	const runId = $derived(page.params.runid ?? '');

	let loading = $state(true);
	let error = $state<string | null>(null);
	let notMember = $state(false);
	let me = $state<Member | null>(null);
	let run = $state<Run | null>(null);
	let restaurant = $state<Restaurant | null>(null);
	let orders = $state<MemberOrder[]>([]);
	let participants = $state<RunParticipant[]>([]);
	let recent = $state<Record<string, string>>({});

	let sheet = $state<Sheet | null>(null);
	let sheetText = $state('');
	let editorRows = $state<EditorRow[]>([]);
	let sheetBusy = $state(false);
	let sheetError = $state<string | null>(null);
	let textEl = $state<HTMLTextAreaElement | null>(null);
	let closing = $state(false);

	/** Visual viewport tracking so the sheet rides above the iOS keyboard. */
	let kbInset = $state(0);
	let vvHeight = $state(0);

	let seq = 0;

	/** `quiet` refreshes in place (focus / after actions) without the spinner or clobbering on error. */
	async function load(groupId: string, id: string, quiet = false) {
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
			const r = await getRun(id);
			if (mine !== seq) return;
			if (r.group_id !== groupId) throw new Error("That run isn't in this group.");
			const [rest, ords, parts, rec] = await Promise.all([
				getRestaurant(r.restaurant_id),
				getRestaurantOrders(groupId, r.restaurant_id),
				listParticipants(id),
				recentParticipation(r.restaurant_id, id)
			]);
			if (mine !== seq) return;
			me = member;
			run = r;
			restaurant = rest;
			orders = ords;
			participants = parts;
			recent = rec;
			error = null;
		} catch (e) {
			if (mine === seq && !quiet) error = friendlyError(e);
		} finally {
			if (mine === seq) loading = false;
		}
	}

	function refresh() {
		if (gid && runId) load(gid, runId, true);
	}

	$effect(() => {
		if (gid && runId) load(gid, runId);
	});

	onMount(() => {
		// People pass the phone around, and others may join from their own phones later.
		const onVisible = () => {
			if (document.visibilityState === 'visible' && !loading && !sheet && !sheetBusy) refresh();
		};
		window.addEventListener('focus', onVisible);
		document.addEventListener('visibilitychange', onVisible);

		const vv = window.visualViewport;
		const onViewport = () => {
			if (!vv) return;
			vvHeight = vv.height;
			kbInset = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
		};
		onViewport();
		vv?.addEventListener('resize', onViewport);
		vv?.addEventListener('scroll', onViewport);

		return () => {
			window.removeEventListener('focus', onVisible);
			document.removeEventListener('visibilitychange', onVisible);
			vv?.removeEventListener('resize', onViewport);
			vv?.removeEventListener('scroll', onViewport);
		};
	});

	// ------------------------------------------------------------ derived

	const isOpen = $derived(run?.status === 'open');
	const orderByMember = $derived(new Map(orders.map((o) => [o.member.id, o])));

	function usualItems(mo: MemberOrder | undefined): OrderItem[] {
		return mo?.order?.order_items ?? [];
	}

	/** Participants in join order, paired with their member + usual. Removed members drop out. */
	const inRows = $derived(
		participants
			.map((p) => ({ p, mo: orderByMember.get(p.member_id) }))
			.filter((r): r is { p: RunParticipant; mo: MemberOrder } => !!r.mo)
	);

	const everyoneElse = $derived.by(() => {
		const inIds = new Set(participants.map((p) => p.member_id));
		const time = (id: string) => (recent[id] ? Date.parse(recent[id]) : 0);
		return orders
			.filter((o) => !inIds.has(o.member.id))
			.sort(
				(a, b) =>
					time(b.member.id) - time(a.member.id) ||
					a.member.display_name.localeCompare(b.member.display_name, undefined, {
						sensitivity: 'base'
					})
			);
	});

	const copyRows = $derived(
		inRows.map(({ p, mo }) => ({
			member: mo.member,
			override_text: p.override_text,
			items: usualItems(mo)
		}))
	);
	const copyCount = $derived(
		copyRows.filter((r) => r.override_text?.trim() || r.items.length > 0).length
	);
	const orderText = $derived(restaurant ? formatRunCopy(restaurant.name, copyRows) : '');

	const subtitle = $derived(
		run ? [run.note, run.status === 'open' ? 'Open' : 'Closed'].filter(Boolean).join(' · ') : null
	);
	const backHref = $derived(run ? `/g/${gid}/r/${run.restaurant_id}` : `/g/${gid}`);

	const sheetParticipant = $derived.by(() => {
		const s = sheet;
		if (!s) return null;
		if (s.kind === 'in') return participants.find((p) => p.id === s.participantId) ?? null;
		return null;
	});
	const sheetMO = $derived.by(() => {
		const s = sheet;
		if (!s) return undefined;
		const mid = s.kind === 'join' ? s.memberId : sheetParticipant?.member_id;
		return mid ? orderByMember.get(mid) : undefined;
	});

	function whenText(iso: string): string {
		const d = new Date(iso);
		const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		if (d.toDateString() === new Date().toDateString()) return `today at ${time}`;
		return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
	}

	// ------------------------------------------------------------ bottom bar

	async function copyOrder() {
		if (!copyCount) return;
		const ok = await copyText(orderText);
		toast(ok ? 'Copied — paste it anywhere' : "Couldn't copy. Try again.");
	}

	async function onCloseRun() {
		if (!run || !isOpen || closing) return;
		if (!confirm('Close this run? It stays copyable.')) return;
		closing = true;
		try {
			await closeRun(run.id);
			toast('Run closed');
			await load(gid, runId, true);
		} catch (e) {
			toast(friendlyError(e), 3000);
		} finally {
			closing = false;
		}
	}

	// ------------------------------------------------------------ sheets

	function resetSheet() {
		sheetText = '';
		sheetError = null;
		editorRows = [newRow()];
	}

	function openJoin(mo: MemberOrder) {
		if (!isOpen) return;
		resetSheet();
		sheet = {
			kind: 'join',
			memberId: mo.member.id,
			step: usualItems(mo).length > 0 ? 'confirm' : 'new'
		};
	}

	function openIn(p: RunParticipant) {
		if (!isOpen || p.id.startsWith('pending-')) return;
		resetSheet();
		sheetText = p.override_text ?? '';
		sheet = { kind: 'in', participantId: p.id };
	}

	function closeSheet() {
		if (sheetBusy || !sheet) return;
		// Dismissing the "make it your usual?" step = "no"; they're already in.
		if (sheet.kind === 'join' && sheet.step === 'make-usual' && sheetMO) {
			toast(`${sheetMO.member.display_name} is in`);
		}
		sheet = null;
		refresh();
	}

	/** Run a sheet action with busy + error handling. */
	async function act(fn: () => Promise<void>) {
		if (sheetBusy) return;
		sheetBusy = true;
		sheetError = null;
		try {
			await fn();
		} catch (e) {
			sheetError = friendlyError(e);
		} finally {
			sheetBusy = false;
		}
	}

	/** Show someone in "In" right away; the refresh that follows swaps in the real row. */
	function optimisticAdd(memberId: string) {
		if (!run || participants.some((p) => p.member_id === memberId)) return;
		participants = [
			...participants,
			{
				id: `pending-${memberId}`,
				run_id: run.id,
				member_id: memberId,
				override_text: null,
				created_at: new Date().toISOString()
			}
		];
	}

	function done(msg: string) {
		sheet = null;
		toast(msg);
		refresh();
	}

	async function focusText() {
		await tick();
		textEl?.focus();
	}

	// Join: returning person, usual as-is (the fast path).
	const thatsIt = () =>
		act(async () => {
			const s = sheet;
			const mo = sheetMO;
			if (s?.kind !== 'join' || !mo || !run) return;
			await addParticipant(run.id, mo.member.id, null);
			optimisticAdd(mo.member.id);
			done(`${mo.member.display_name} is in`);
		});

	function somethingDifferent() {
		const s = sheet;
		if (s?.kind !== 'join') return;
		sheetError = null;
		sheet = { ...s, step: 'different' };
		focusText();
	}

	const addDifferent = () =>
		act(async () => {
			const s = sheet;
			const mo = sheetMO;
			const text = sheetText.trim();
			if (s?.kind !== 'join' || !mo || !run || !text) return;
			await addParticipant(run.id, mo.member.id, text);
			const parts = await listParticipants(run.id);
			participants = parts;
			const pid = parts.find((p) => p.member_id === mo.member.id)?.id;
			sheet = { ...s, step: 'make-usual', participantId: pid };
		});

	const makeUsualYes = () =>
		act(async () => {
			const s = sheet;
			const mo = sheetMO;
			const text = sheetText.trim();
			if (s?.kind !== 'join' || !mo || !text) return;
			await saveOrder(
				restaurant!.id,
				mo.member.id,
				[{ item_name: text, quantity: 1, modifiers: null }],
				mo.order?.trying_note ?? null
			);
			// It IS their usual now, so drop the one-off (copy text stays identical).
			if (s.participantId) await setOverride(s.participantId, null);
			done(`${mo.member.display_name} is in · usual saved`);
		});

	function makeUsualNo() {
		if (sheetMO) done(`${sheetMO.member.display_name} is in`);
	}

	// Join: first time here, build a usual.
	const cleanedNew = $derived(cleanItems(editorRows));
	const saveAndAdd = () =>
		act(async () => {
			const s = sheet;
			const mo = sheetMO;
			if (s?.kind !== 'join' || !mo || !run || cleanedNew.length === 0) return;
			await saveOrder(run.restaurant_id, mo.member.id, cleanedNew, mo.order?.trying_note ?? null);
			await addParticipant(run.id, mo.member.id, null);
			optimisticAdd(mo.member.id);
			done(`${mo.member.display_name} is in`);
		});

	// Participant sheet.
	const saveOneOff = () =>
		act(async () => {
			const p = sheetParticipant;
			if (!p) return;
			await setOverride(p.id, sheetText.trim() || null);
			done('Updated');
		});

	const useUsual = () =>
		act(async () => {
			const p = sheetParticipant;
			if (!p) return;
			await setOverride(p.id, null);
			done('Back to the usual');
		});

	const removeFromRun = () =>
		act(async () => {
			const p = sheetParticipant;
			const mo = sheetMO;
			if (!p) return;
			await removeParticipant(p.id);
			done(mo ? `${mo.member.display_name} is out` : 'Removed');
		});

	function onTextKey(e: KeyboardEvent, submit: () => void) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			submit();
		}
	}
</script>

<svelte:head>
	<title>{restaurant ? `Run · ${restaurant.name}` : 'Run'} · Usual Order</title>
</svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && sheet && closeSheet()} />

<Header
	title={restaurant?.name ?? (notMember ? 'Not in this group' : '')}
	{subtitle}
	back={backHref}
/>

{#snippet dot(color: string, size = 'h-3.5 w-3.5')}
	<span class="{size} inline-block shrink-0 rounded-full" style:background-color={color} aria-hidden="true"
	></span>
{/snippet}

{#snippet youTag(memberId: string)}
	{#if memberId === me?.id}<span class="font-normal text-ink-3">(you)</span>{/if}
{/snippet}

{#snippet inRowBody(p: RunParticipant, mo: MemberOrder)}
	<span class="mt-[7px]">{@render dot(mo.member.color)}</span>
	<div class="min-w-0 flex-1">
		<p class="text-[19px] leading-snug font-bold break-words">
			{mo.member.display_name}
			{@render youTag(mo.member.id)}
		</p>
		{#if p.override_text?.trim()}
			<p class="mt-1 text-[18px] leading-normal break-words text-ink">{p.override_text}</p>
			<span
				class="mt-1.5 inline-block rounded-md bg-warn-soft px-2 py-0.5 text-[13px] font-semibold text-warn"
				>just this time</span
			>
		{:else if usualItems(mo).length > 0}
			<p class="mt-1 text-[18px] leading-normal break-words text-ink">
				{formatItems(usualItems(mo))}
			</p>
		{:else}
			<p class="mt-1 text-[17px] text-ink-3 italic">No usual</p>
		{/if}
	</div>
{/snippet}

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
	{:else if error || !run || !restaurant}
		<div class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-[20px] font-bold">Hmm, that didn't load</p>
			<p class="text-ink-2">{error ?? 'Something went wrong.'}</p>
			<button class="btn-secondary mt-2" onclick={() => load(gid, runId)}>Try again</button>
		</div>
	{:else}
		{#if !isOpen && run.closed_at}
			<p
				class="mb-4 flex items-center gap-2 rounded-card bg-line/50 px-4 py-3 text-[15px] text-ink-2"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
				Closed {whenText(run.closed_at)}. Still copyable.
			</p>
		{/if}

		<section>
			<h2 class="label px-1">In ({inRows.length})</h2>
			{#if inRows.length}
				<ul class="card divide-hair overflow-hidden">
					{#each inRows as { p, mo } (p.id)}
						<li>
							{#if isOpen}
								<button
									type="button"
									class="flex w-full items-start gap-3 py-4 pr-3 pl-4 text-left active:bg-line/40"
									onclick={() => openIn(p)}
									aria-label={`Change ${mo.member.display_name}'s order for this run`}
								>
									{@render inRowBody(p, mo)}
									<svg class="mt-1 shrink-0 text-ink-3" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
								</button>
							{:else}
								<div class="flex items-start gap-3 py-4 pr-3 pl-4">
									{@render inRowBody(p, mo)}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="card px-4 py-6 text-center text-ink-3">
					{isOpen ? 'Nobody yet. Pass the phone!' : 'Nobody joined this run.'}
				</p>
			{/if}
		</section>

		{#if isOpen}
			<section class="mt-8">
				<h2 class="label px-1">Everyone else</h2>
				{#if everyoneElse.length}
					<p class="mb-2.5 flex items-center gap-2 px-1 text-[16px] font-semibold text-accent-ink">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
						Pass the phone — tap your name
					</p>
					<ul class="card divide-hair overflow-hidden">
						{#each everyoneElse as mo (mo.member.id)}
							{@const usual = formatItems(usualItems(mo))}
							<li>
								<button
									type="button"
									class="flex min-h-16 w-full items-center gap-3 py-3 pr-3 pl-4 text-left active:bg-accent-soft"
									onclick={() => openJoin(mo)}
								>
									{@render dot(mo.member.color, 'h-4 w-4')}
									<div class="min-w-0 flex-1">
										<p class="truncate text-[20px] leading-snug font-bold">
											{mo.member.display_name}
											{@render youTag(mo.member.id)}
										</p>
										<p class="truncate text-[15px] text-ink-3">
											{usual || 'No usual yet'}
										</p>
									</div>
									<svg class="shrink-0 text-accent" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="card px-4 py-6 text-center text-ink-3">Everyone's in. Nice.</p>
				{/if}
			</section>
		{/if}
	{/if}
</main>

{#if !loading && !error && !notMember && run && restaurant}
	<div class="fixed inset-x-0 bottom-0 z-30">
		<div class="pb-safe mx-auto max-w-[520px] border-t border-line bg-paper/90 backdrop-blur-md">
			<div class="flex gap-2 px-4 pt-3 pb-3">
				{#if isOpen}
					<button
						type="button"
						class="btn-secondary min-h-14 shrink-0 px-4 text-[16px]"
						onclick={onCloseRun}
						disabled={closing}
					>
						{closing ? 'Closing…' : 'Close run'}
					</button>
				{/if}
				<button
					type="button"
					class="btn-primary min-h-14 flex-1 text-[18px]"
					onclick={copyOrder}
					disabled={!copyCount}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
					{#if copyCount}
						Copy order · {copyCount} {copyCount === 1 ? 'person' : 'people'}
					{:else}
						Nothing to copy yet
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if sheet && sheetMO}
	{@const s = sheet}
	{@const mo = sheetMO}
	{@const name = mo.member.display_name}
	{@const usual = formatItems(usualItems(mo))}
	<div class="fixed inset-0 z-40">
		<button
			type="button"
			class="absolute inset-0 bg-ink/40"
			aria-label="Close"
			onclick={closeSheet}
			transition:fade={{ duration: 180 }}
		></button>
		<div
			class="absolute inset-x-0 bottom-0"
			style:bottom="{kbInset}px"
			transition:fly={{ y: 320, duration: 260, easing: cubicOut }}
		>
			<div
				class="pb-safe mx-auto flex max-h-[85dvh] max-w-[520px] flex-col overflow-hidden rounded-t-[20px] border-t border-line bg-card shadow-2xl"
				style:max-height={kbInset && vvHeight ? `${Math.round(vvHeight * 0.92)}px` : undefined}
				role="dialog"
				aria-modal="true"
				aria-labelledby="sheet-title"
			>
				<!-- Head -->
				<div class="shrink-0 px-4 pt-3">
					<div class="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line"></div>
					<div class="flex items-center gap-2.5">
						{@render dot(mo.member.color, 'h-4 w-4')}
						<p id="sheet-title" class="min-w-0 flex-1 truncate text-[20px] font-bold">
							{#if s.kind === 'join' && s.step === 'confirm'}
								{name}'s usual
							{:else if s.kind === 'join' && s.step === 'new'}
								{name}, what's your usual here?
							{:else if s.kind === 'join' && s.step === 'make-usual'}
								{name} is in!
							{:else}
								{name}
							{/if}
						</p>
						<button
							type="button"
							class="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 active:bg-line/60"
							aria-label="Close"
							onclick={closeSheet}
						>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
						</button>
					</div>
				</div>

				<!-- Body -->
				<div class="min-h-0 flex-1 overflow-auto overscroll-contain px-4 pt-2 pb-4">
					{#if s.kind === 'join'}
						{#if s.step === 'confirm'}
							<p class="text-[22px] leading-snug font-semibold break-words text-ink">{usual}</p>
						{:else if s.step === 'different'}
							{#if usual}
								<p class="mb-3 text-[15px] text-ink-3">
									Usually: <span class="text-ink-2">{usual}</span>
								</p>
							{/if}
							<label for="one-off" class="label">Just this time</label>
							<textarea
								id="one-off"
								bind:this={textEl}
								bind:value={sheetText}
								class="input resize-none py-3 leading-snug"
								rows="3"
								maxlength="300"
								placeholder="No queso today, add a taco"
								autocapitalize="sentences"
								enterkeyhint="done"
								onkeydown={(e) => onTextKey(e, addDifferent)}
							></textarea>
						{:else if s.step === 'make-usual'}
							<p class="text-[18px] leading-snug break-words text-ink">
								“{sheetText.trim()}”
							</p>
							<p class="mt-4 text-[20px] font-bold">Make this your usual?</p>
							{#if usual}
								<p class="mt-1 text-[15px] text-ink-3">It'd replace: {usual}</p>
							{/if}
						{:else if s.step === 'new'}
							<p class="mb-3 text-[15px] text-ink-3">We'll remember it for next time.</p>
							<OrderItemsEditor
								bind:items={editorRows}
								idPrefix="run-item"
								onDone={saveAndAdd}
							/>
						{/if}
					{:else if sheetParticipant}
						{#if usual}
							<p class="text-[15px] text-ink-3">
								Usual: <span class={sheetParticipant.override_text ? 'text-ink-3 line-through' : 'text-ink-2'}
									>{usual}</span
								>
							</p>
						{:else}
							<p class="text-[15px] text-ink-3 italic">No usual here yet.</p>
						{/if}
						<label for="one-off" class="label mt-4">Just this time</label>
						<textarea
							id="one-off"
							bind:value={sheetText}
							class="input resize-none py-3 leading-snug"
							rows="3"
							maxlength="300"
							placeholder="No queso today, add a taco"
							autocapitalize="sentences"
							enterkeyhint="done"
							onkeydown={(e) => onTextKey(e, saveOneOff)}
						></textarea>
						<a
							href={`/g/${gid}/r/${run?.restaurant_id}/edit?m=${mo.member.id}`}
							class="mt-2 inline-flex min-h-11 items-center px-1 text-[15px] font-semibold text-accent-ink"
						>
							Edit {name}'s usual
						</a>
					{/if}

					{#if sheetError}
						<p class="mt-3 text-[15px] text-danger" role="alert">{sheetError}</p>
					{/if}
				</div>

				<!-- Actions -->
				<div class="shrink-0 border-t border-line px-4 pt-3 pb-4">
					{#if s.kind === 'join'}
						{#if s.step === 'confirm'}
							<button
								type="button"
								class="btn-primary min-h-16 w-full text-[20px]"
								disabled={sheetBusy}
								onclick={thatsIt}
							>
								<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
								{sheetBusy ? 'Adding…' : "That's it"}
							</button>
							<button
								type="button"
								class="btn-secondary mt-2 w-full"
								disabled={sheetBusy}
								onclick={somethingDifferent}
							>
								Something different
							</button>
						{:else if s.step === 'different'}
							<div class="flex gap-2">
								<button
									type="button"
									class="btn-secondary flex-1"
									disabled={sheetBusy}
									onclick={() => {
										sheetError = null;
										sheet = { ...s, step: usual ? 'confirm' : 'new' };
									}}
								>
									Back
								</button>
								<button
									type="button"
									class="btn-primary min-h-14 flex-[2] text-[18px]"
									disabled={sheetBusy || !sheetText.trim()}
									onclick={addDifferent}
								>
									{sheetBusy ? 'Adding…' : 'Add me'}
								</button>
							</div>
						{:else if s.step === 'make-usual'}
							<div class="flex gap-2">
								<button
									type="button"
									class="btn-secondary min-h-14 flex-1"
									disabled={sheetBusy}
									onclick={makeUsualNo}
								>
									Just this time
								</button>
								<button
									type="button"
									class="btn-primary min-h-14 flex-1"
									disabled={sheetBusy}
									onclick={makeUsualYes}
								>
									{sheetBusy ? 'Saving…' : 'Yes, my usual'}
								</button>
							</div>
						{:else if s.step === 'new'}
							<button
								type="button"
								class="btn-primary min-h-14 w-full text-[18px]"
								disabled={sheetBusy || cleanedNew.length === 0}
								onclick={saveAndAdd}
							>
								{sheetBusy ? 'Saving…' : 'Save & add me'}
							</button>
							<button
								type="button"
								class="btn-ghost mt-1 w-full text-[16px]"
								disabled={sheetBusy}
								onclick={somethingDifferent}
							>
								Just this once — don't save it
							</button>
						{/if}
					{:else if sheetParticipant}
						{@const current = sheetParticipant.override_text ?? ''}
						<button
							type="button"
							class="btn-primary min-h-14 w-full text-[18px]"
							disabled={sheetBusy || sheetText.trim() === current.trim()}
							onclick={saveOneOff}
						>
							{sheetBusy ? 'Saving…' : sheetText.trim() ? 'Save for this run' : 'Use my usual'}
						</button>
						{#if current && sheetText.trim()}
							<button
								type="button"
								class="btn-secondary mt-2 w-full"
								disabled={sheetBusy}
								onclick={useUsual}
							>
								Use my usual
							</button>
						{/if}
						<button
							type="button"
							class="btn mt-2 w-full text-danger active:bg-danger/10"
							disabled={sheetBusy}
							onclick={removeFromRun}
						>
							Remove from run
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
