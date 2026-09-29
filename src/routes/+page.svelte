<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import { friendlyError, listMyGroups } from '$lib/api';
	import type { Group } from '$lib/types';

	let groups = $state<Group[] | null>(null);
	let loadError = $state<string | null>(null);

	// "Have a link? Open it"
	let linkOpen = $state(false);
	let linkValue = $state('');
	let linkError = $state<string | null>(null);
	let linkInput = $state<HTMLInputElement | null>(null);

	async function load() {
		loadError = null;
		try {
			groups = await listMyGroups(auth.user!.id);
		} catch (e) {
			loadError = friendlyError(e);
		}
	}

	onMount(load);

	async function revealLink() {
		linkOpen = true;
		await tick();
		linkInput?.focus();
	}

	/** Accepts a bare code ("7kq 4m") or a pasted link (".../join/7KQ4M"). */
	function extractCode(raw: string): string {
		const m = raw.match(/\/join\/([A-Za-z0-9 ]+)/);
		return (m ? m[1] : raw).replace(/\s+/g, '').toUpperCase();
	}

	function openLink(e: SubmitEvent) {
		e.preventDefault();
		const code = extractCode(linkValue);
		if (!code) {
			linkError = 'Paste the link or type the 5-character code.';
			return;
		}
		if (!/^[A-Z0-9]{5}$/.test(code)) {
			linkError = "That doesn't look right. Codes are 5 letters and numbers, like 7KQ4M.";
			return;
		}
		linkError = null;
		goto(`/join/${code}`);
	}
</script>

{#snippet linkForm()}
	{#if linkOpen}
		<form class="mt-3 flex flex-col gap-2" onsubmit={openLink}>
			<div class="flex gap-2">
				<input
					bind:this={linkInput}
					bind:value={linkValue}
					oninput={() => (linkError = null)}
					class="input flex-1 font-semibold tracking-wide"
					placeholder="Code or link"
					aria-label="Invite code or link"
					autocomplete="off"
					autocapitalize="characters"
					autocorrect="off"
					spellcheck="false"
					enterkeyhint="go"
				/>
				<button type="submit" class="btn-primary shrink-0 px-5" disabled={!linkValue.trim()}>
					Open
				</button>
			</div>
			{#if linkError}
				<p class="px-1 text-[14px] text-danger" role="alert">{linkError}</p>
			{/if}
		</form>
	{:else}
		<button type="button" class="btn-ghost mt-1 w-full" onclick={revealLink}>
			Have a link? Open it
		</button>
	{/if}
{/snippet}

{#if loadError}
	<div class="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
		<p class="text-lg font-semibold">Couldn't load your groups</p>
		<p class="text-ink-2">{loadError}</p>
		<button class="btn-primary" onclick={load}>Try again</button>
	</div>
{:else if groups === null}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"></div>
	</div>
{:else if groups.length > 0}
	<!-- In some groups: list them -->
	<div class="pt-safe px-4 pb-10">
		<div class="flex items-end justify-between gap-3 pt-8 pb-5">
			<div class="px-1">
				<p class="text-[15px] font-bold tracking-tight text-accent-ink">Usual Order</p>
				<h1 class="text-[30px] leading-tight font-extrabold tracking-tight">Your groups</h1>
			</div>
		</div>

		<ul class="card divide-hair overflow-hidden">
			{#each groups as g (g.id)}
				<li>
					<a
						href={`/g/${g.id}`}
						class="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-line/40"
					>
						<span
							class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[19px] font-extrabold text-accent-ink"
							aria-hidden="true"
						>
							{g.name.trim().charAt(0).toUpperCase() || '?'}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[17px] font-semibold">{g.name}</span>
							<span class="block text-[13px] tracking-wider text-ink-3">{g.invite_code}</span>
						</span>
						<svg
							class="shrink-0 text-ink-3"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg
						>
					</a>
				</li>
			{/each}
		</ul>

		<div class="mt-6">
			<a href="/new" class="btn-secondary w-full">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
					stroke-linecap="round"
					aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
				>
				New group
			</a>
			{@render linkForm()}
		</div>
	</div>
{:else}
	<!-- First visit: warm welcome -->
	<div class="pt-safe flex min-h-dvh flex-col px-6">
		<div class="pt-14">
			<h1 class="text-[44px] leading-[1.02] font-extrabold tracking-tight">
				Usual<br />Order<span class="text-accent">.</span>
			</h1>
			<p class="mt-3 max-w-[20ch] text-[20px] leading-snug text-ink-2">
				Everyone's usual order, one tap to copy.
			</p>
		</div>

		<!-- Decorative preview of the core screen -->
		<div class="flex flex-1 items-center justify-center py-8" aria-hidden="true">
			<div class="card w-full max-w-[320px] -rotate-2 p-4 shadow-[0_8px_30px_-12px_rgba(60,40,20,0.25)]">
				<p class="text-[15px] font-bold">Torchy's Tacos</p>
				<ul class="mt-2 space-y-2 text-[14px]">
					<li class="flex items-start gap-2">
						<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#2f7fd6]"></span>
						<span><b class="font-semibold">Matt</b> <span class="text-ink-2">Trailer Park (trashy), Queso</span></span>
					</li>
					<li class="flex items-start gap-2">
						<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#2aa876]"></span>
						<span><b class="font-semibold">Jake</b> <span class="text-ink-2">2x Fried Avocado (no pico)</span></span>
					</li>
					<li class="flex items-start gap-2">
						<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#9256d9]"></span>
						<span><b class="font-semibold">Sam</b> <span class="text-ink-2">Kids quesadilla</span></span>
					</li>
				</ul>
				<div
					class="mt-3 flex h-9 items-center justify-center rounded-lg bg-accent text-[14px] font-semibold text-white"
				>
					Copy order
				</div>
			</div>
		</div>

		<div class="pb-safe">
			<div class="pb-6">
				<a href="/new" class="btn-primary w-full">Create a group</a>
				{@render linkForm()}
			</div>
		</div>
	</div>
{/if}
