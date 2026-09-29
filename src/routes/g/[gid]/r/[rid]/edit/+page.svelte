<script lang="ts">
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import {
		friendlyError,
		getMyMember,
		getOrder,
		getRestaurant,
		listMembers,
		saveOrder
	} from '$lib/api';
	import { formatItems } from '$lib/format';
	import type { Member, Restaurant } from '$lib/types';
	import Header from '$lib/components/Header.svelte';
	import OrderItemsEditor, {
		cleanItems,
		newRow,
		type EditorRow
	} from '$lib/components/OrderItemsEditor.svelte';
	import { toast } from '$lib/components/Toast.svelte';

	const gid = $derived(page.params.gid ?? '');
	const rid = $derived(page.params.rid ?? '');
	const mParam = $derived(page.url.searchParams.get('m'));
	const backHref = $derived(`/g/${gid}/r/${rid}`);

	let status = $state<'loading' | 'ready' | 'not-member' | 'error'>('loading');
	let loadError = $state('');
	let restaurant = $state<Restaurant | null>(null);
	let member = $state<Member | null>(null);
	let isMe = $state(true);

	let rows = $state<EditorRow[]>([]);
	let trying = $state('');
	let hadUsual = $state(false);
	let initialSnapshot = $state('');

	let saving = $state(false);
	let saveError = $state('');
	let saved = false;
	let barEl = $state<HTMLElement | null>(null);

	let loadSeq = 0;

	function snapshot() {
		return JSON.stringify({ items: cleanItems(rows), trying: trying.trim() });
	}

	const cleaned = $derived(cleanItems(rows));
	const preview = $derived(formatItems(cleaned.map((it, i) => ({ ...it, sort_order: i }))));
	const dirty = $derived(status === 'ready' && snapshot() !== initialSnapshot);

	$effect(() => {
		const g = gid;
		const r = rid;
		const m = mParam;
		untrack(() => load(g, r, m));
	});

	async function load(g: string, r: string, m: string | null) {
		const seq = ++loadSeq;
		status = 'loading';
		loadError = '';
		saveError = '';
		try {
			const [me, rest] = await Promise.all([getMyMember(g, auth.user!.id), getRestaurant(r)]);
			if (seq !== loadSeq) return;
			if (!me) {
				status = 'not-member';
				return;
			}
			let target: Member = me;
			if (m && m !== me.id) {
				const members = await listMembers(g);
				const found = members.find((x) => x.id === m);
				if (!found) throw new Error("That person isn't in this group anymore.");
				target = found;
			}
			const order = await getOrder(r, target.id);
			if (seq !== loadSeq) return;

			restaurant = rest;
			member = target;
			isMe = target.id === me.id;
			const items = order?.order_items ?? [];
			hadUsual = items.length > 0;
			rows = items.length ? items.map((it) => newRow(it)) : [newRow()];
			trying = order?.trying_note ?? '';
			saved = false;
			initialSnapshot = snapshot();
			status = 'ready';
		} catch (e) {
			if (seq !== loadSeq) return;
			loadError = friendlyError(e);
			status = 'error';
		}
	}

	function makeUsual() {
		const text = trying.trim();
		if (!text) return;
		if (cleaned.length > 0 && !confirm(`Replace ${isMe ? 'your' : 'this'} usual with "${text}"?`))
			return;
		rows = [newRow({ item_name: text, quantity: 1, modifiers: null })];
		trying = '';
		toast('Swapped in. Tap Save to keep it.');
	}

	// ------------------------------------------------------------ save + guard

	async function save() {
		if (!member || saving) return;
		const items = cleaned;
		if (items.length === 0 && hadUsual && !confirm('Clear this usual?')) return;
		saving = true;
		saveError = '';
		try {
			await saveOrder(rid, member.id, items, trying.trim() || null);
			saved = true;
			toast('Saved');
			await goto(backHref);
		} catch (e) {
			saveError = friendlyError(e);
		} finally {
			saving = false;
		}
	}

	beforeNavigate((nav) => {
		if (saved || !dirty) return;
		if (nav.type === 'leave') {
			// Tab close / reload: triggers the browser's own "leave site?" prompt.
			nav.cancel();
			return;
		}
		if (!confirm('Leave without saving your changes?')) nav.cancel();
	});

	/** Keep the focused field visible above the sticky bar (and the on-screen keyboard). */
	function onFocusIn(e: FocusEvent) {
		const el = e.target as HTMLElement | null;
		if (!el || !barEl || !el.matches('input, textarea')) return;
		setTimeout(() => {
			if (document.activeElement !== el || !barEl) return;
			const rect = el.getBoundingClientRect();
			const vv = window.visualViewport;
			const visibleBottom = Math.min(
				barEl.getBoundingClientRect().top,
				vv ? vv.offsetTop + vv.height : window.innerHeight
			);
			const overlap = rect.bottom - (visibleBottom - 12);
			if (overlap > 0) window.scrollBy({ top: overlap, behavior: 'smooth' });
		}, 320);
	}

	const subtitle = $derived(
		status !== 'ready' || !member
			? null
			: isMe
				? 'Your usual'
				: `Editing ${member.display_name}'s order`
	);
</script>

<svelte:head>
	<title>{restaurant ? `Edit · ${restaurant.name}` : 'Edit order'} · Usual Order</title>
</svelte:head>

<Header title={restaurant?.name ?? 'Edit order'} {subtitle} back={backHref} />

{#if status === 'loading'}
	<div class="flex justify-center py-20">
		<div class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"></div>
	</div>
{:else if status === 'not-member'}
	<div class="flex flex-col items-center gap-3 px-6 py-20 text-center">
		<p class="text-lg font-semibold">You're not in this group</p>
		<p class="text-ink-2">Ask a friend for the invite link to join.</p>
		<a href="/" class="btn-secondary mt-2">Go home</a>
	</div>
{:else if status === 'error'}
	<div class="flex flex-col items-center gap-3 px-6 py-20 text-center">
		<p class="text-lg font-semibold">Couldn't load this order</p>
		<p class="text-ink-2">{loadError}</p>
		<button class="btn-primary mt-2" onclick={() => load(gid, rid, mParam)}>Try again</button>
	</div>
{:else if member}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="px-4 pt-4 pb-48" onfocusin={onFocusIn}>
		<div class="mb-2 flex items-center gap-2 px-1">
			<span class="h-3 w-3 shrink-0 rounded-full" style:background-color={member.color}></span>
			<h2 class="label !mb-0">{isMe ? 'Your usual' : `${member.display_name}'s usual`}</h2>
		</div>

		<OrderItemsEditor
			bind:items={rows}
			onDone={() => document.getElementById('trying-note')?.focus()}
		/>

		<section class="mt-8">
			<label for="trying-note" class="label flex items-center gap-1.5 px-1 !text-warn">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" /></svg>
				Trying next time
			</label>
			<textarea
				id="trying-note"
				class="input resize-none py-3 leading-snug focus:!border-warn"
				rows="2"
				bind:value={trying}
				placeholder="Brushfire taco, extra hot"
				autocapitalize="sentences"
			></textarea>
			{#if trying.trim()}
				<button
					type="button"
					class="btn-secondary mt-2 w-full text-[16px]"
					onclick={makeUsual}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
					Make this {isMe ? 'my' : 'their'} usual
				</button>
			{:else}
				<p class="mt-1.5 px-1 text-[14px] text-ink-3">Eyeing something new? Jot it here.</p>
			{/if}
		</section>
	</div>

	<div class="fixed inset-x-0 bottom-0 z-20">
		<div
			bind:this={barEl}
			class="pb-safe mx-auto max-w-[520px] border-t border-line bg-paper/90 backdrop-blur-md"
		>
			<div class="px-4 pt-2.5 pb-3">
				<p class="mb-2 line-clamp-2 text-[14px] leading-snug text-ink-2" aria-live="polite">
					<span class="font-semibold text-ink">{member.display_name}:</span>
					{#if preview}
						{preview}
					{:else}
						<span class="text-ink-3 italic">no usual</span>
					{/if}
				</p>
				{#if saveError}
					<p class="mb-2 text-[14px] text-danger" role="alert">{saveError}</p>
				{/if}
				<button
					type="button"
					class="btn-primary min-h-14 w-full"
					disabled={saving}
					onclick={save}
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}
