<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { friendlyError, joinGroup, previewInvite } from '$lib/api';
	import type { InvitePreview } from '$lib/types';

	const LAST_NAME_KEY = 'uo:lastName';

	let code = $derived((page.params.code ?? '').replace(/\s+/g, '').toUpperCase());

	let preview = $state<InvitePreview | null>(null);
	let status = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading');
	let loadError = $state<string | null>(null);

	let name = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	/** Set when the typed name matches an existing member: show "Is this you?". */
	let confirmName = $state<string | null>(null);
	let showDifferentHint = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);

	let loadToken = 0;

	async function load(c: string) {
		const token = ++loadToken;
		status = 'loading';
		loadError = null;
		try {
			const p = await previewInvite(c);
			if (token !== loadToken) return;
			if (!p) {
				status = 'invalid';
				return;
			}
			if (p.already_member) {
				goto(`/g/${p.id}`, { replaceState: true });
				return;
			}
			preview = p;
			status = 'ready';
		} catch (e) {
			if (token !== loadToken) return;
			loadError = friendlyError(e);
			status = 'error';
		}
	}

	$effect(() => {
		const c = code;
		untrack(() => load(c));
	});

	onMount(() => {
		try {
			const last = localStorage.getItem(LAST_NAME_KEY);
			if (last && !name) name = last;
		} catch {
			// storage unavailable
		}
	});

	function saveLastName(n: string) {
		try {
			localStorage.setItem(LAST_NAME_KEY, n);
		} catch {
			// ignore
		}
	}

	function pickChip(displayName: string) {
		name = displayName;
		error = null;
		showDifferentHint = false;
		confirmName = null;
	}

	async function doJoin(n: string, reclaim: boolean) {
		busy = true;
		error = null;
		try {
			const gid = await joinGroup(code, n, reclaim);
			saveLastName(n);
			await goto(`/g/${gid}`, { replaceState: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (!reclaim && msg.includes('name_taken')) {
				// Someone grabbed it between preview and join (or it's a removed member's name).
				confirmName = n;
				nameInput?.blur();
			} else {
				error = friendlyError(e);
			}
			busy = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!preview || busy) return;
		const n = name.trim().replace(/\s+/g, ' ');
		if (!n) {
			nameInput?.focus();
			return;
		}
		const match = preview.members.find((m) => m.display_name.toLowerCase() === n.toLowerCase());
		if (match) {
			confirmName = match.display_name;
			nameInput?.blur();
			return;
		}
		doJoin(n, false);
	}

	function itsMe() {
		if (confirmName) doJoin(confirmName, true);
	}

	function someoneElse() {
		confirmName = null;
		name = '';
		showDifferentHint = true;
		nameInput?.focus(); // synchronous so iOS opens the keyboard
	}

	function onNameInput() {
		error = null;
		if (confirmName) confirmName = null;
	}
</script>

{#if status === 'loading'}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"></div>
	</div>
{:else if status === 'invalid'}
	<div class="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
		<div
			class="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"
			aria-hidden="true"
		>
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6" /><path d="M11 6l.5-.5a4.2 4.2 0 016 6L17 12" /><path d="M13 18l-.5.5a4.2 4.2 0 01-6-6L7 12" /></svg>
		</div>
		<h1 class="text-[24px] font-extrabold tracking-tight">That link doesn't work</h1>
		<p class="max-w-[30ch] text-ink-2">
			Double-check the code <span class="font-semibold tracking-wider text-ink">{code}</span>, or ask
			whoever sent it for a fresh link.
		</p>
		<a href="/" class="btn-secondary mt-3 w-full max-w-[280px]">Go home</a>
	</div>
{:else if status === 'error'}
	<div class="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
		<p class="text-lg font-semibold">Couldn't open that invite</p>
		<p class="text-ink-2">{loadError}</p>
		<button class="btn-primary" onclick={() => load(code)}>Try again</button>
		<a href="/" class="btn-ghost">Go home</a>
	</div>
{:else if preview}
	<form id="join-form" class="pt-safe px-4 pb-36" onsubmit={submit}>
		<div class="px-1 pt-12 pb-7">
			<p class="text-[15px] font-semibold text-accent-ink">You're invited!</p>
			<h1 class="mt-0.5 text-[32px] leading-tight font-extrabold tracking-tight break-words">
				Join {preview.name}
			</h1>
		</div>

		<label class="block">
			<span class="label px-1">Your name</span>
			<input
				bind:this={nameInput}
				bind:value={name}
				oninput={onNameInput}
				class="input"
				placeholder="What your friends call you"
				maxlength="30"
				autocomplete="off"
				autocapitalize="words"
				enterkeyhint="go"
			/>
		</label>

		{#if showDifferentHint && !confirmName}
			<p class="mt-2 px-1 text-[14px] text-ink-2">
				No problem. Pick a name that's different from everyone below, like adding a last initial.
			</p>
		{/if}

		{#if error}
			<p class="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-[15px] text-accent-ink" role="alert">
				{error}
			</p>
		{/if}

		{#if confirmName}
			<div class="mt-4 rounded-card border border-warn/30 bg-warn-soft p-4" role="alert">
				<p class="text-[17px] font-bold">Is this you?</p>
				<p class="mt-1 text-[15px] text-ink-2">
					There's already a <span class="font-semibold text-ink">{confirmName}</span> in {preview.name}.
				</p>
				<div class="mt-4 flex flex-col gap-2">
					<button type="button" class="btn-primary w-full" onclick={itsMe} disabled={busy}>
						{busy ? 'Joining…' : "Yes, that's me"}
					</button>
					<button type="button" class="btn-secondary w-full" onclick={someoneElse} disabled={busy}>
						No, I'm someone else
					</button>
				</div>
			</div>
		{/if}

		{#if preview.members.length > 0}
			<div class="mt-8">
				<p class="label px-1">Already here</p>
				<p class="mb-3 px-1 text-[14px] text-ink-3">Tap your name if you're one of them.</p>
				<div class="flex flex-wrap gap-2">
					{#each preview.members as m (m.id)}
						{@const selected = name.trim().toLowerCase() === m.display_name.toLowerCase()}
						<button
							type="button"
							class="min-h-11 rounded-full border px-4 text-[16px] font-medium transition-transform active:scale-[0.96] {selected
								? 'border-accent bg-accent-soft text-accent-ink'
								: 'border-line bg-card text-ink'}"
							aria-pressed={selected}
							onclick={() => pickChip(m.display_name)}
						>
							{m.display_name}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</form>

	{#if !confirmName}
		<div class="fixed inset-x-0 bottom-0 z-20">
			<div class="pb-safe mx-auto max-w-[520px] border-t border-line bg-paper/90 backdrop-blur-md">
				<div class="px-4 py-3">
					<button type="submit" form="join-form" class="btn-primary w-full" disabled={busy}>
						<span class="truncate">{busy ? 'Joining…' : `Join ${preview.name}`}</span>
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
