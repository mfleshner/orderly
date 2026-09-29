<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { createGroup, friendlyError } from '$lib/api';

	const LAST_NAME_KEY = 'uo:lastName';

	let groupName = $state('');
	let yourName = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let groupInput = $state<HTMLInputElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	onMount(() => {
		try {
			yourName = localStorage.getItem(LAST_NAME_KEY) ?? '';
		} catch {
			// storage unavailable (private mode etc.)
		}
		groupInput?.focus();
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
			const id = await createGroup(g, n);
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
				{busy ? 'Creating…' : 'Create group'}
			</button>
		</div>
	</div>
</div>
