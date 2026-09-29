<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { auth, ensureSession } from '$lib/auth.svelte';
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();

	onMount(() => {
		ensureSession();
		if ('serviceWorker' in navigator && import.meta.env.PROD) {
			navigator.serviceWorker.register('/sw.js').catch(() => {});
		}
	});
</script>

<svelte:head>
	<title>Usual Order</title>
</svelte:head>

<div class="mx-auto min-h-dvh max-w-[520px]">
	{#if !auth.ready}
		<div class="flex min-h-dvh items-center justify-center">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"></div>
		</div>
	{:else if auth.error || !auth.user}
		<div class="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
			<p class="text-lg font-semibold">Couldn't start</p>
			<p class="text-ink-2">{auth.error ?? 'Unknown error'}</p>
			<p class="text-sm text-ink-3">
				If this is the first load in a while, the database may be waking up. Try again in a few
				seconds.
			</p>
			<button class="btn-primary" onclick={() => location.reload()}>Try again</button>
		</div>
	{:else}
		{@render children()}
	{/if}
</div>

<Toast />
