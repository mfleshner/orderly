<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Sticky top bar. `back` is an href for the chevron; `right` is an optional snippet
	 * for a trailing action (icon button). Title truncates on narrow phones.
	 */
	let {
		title,
		subtitle,
		back,
		right
	}: { title: string; subtitle?: string | null; back?: string; right?: Snippet } = $props();
</script>

<header class="pt-safe sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur-md">
	<div class="flex min-h-14 items-center gap-1 px-2">
		{#if back}
			<a
				href={back}
				aria-label="Back"
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-ink active:bg-line/60"
			>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
			</a>
		{:else}
			<div class="w-2"></div>
		{/if}
		<div class="min-w-0 flex-1 py-2">
			<h1 class="truncate text-[19px] leading-tight font-bold">{title}</h1>
			{#if subtitle}
				<p class="truncate text-[13px] text-ink-3">{subtitle}</p>
			{/if}
		</div>
		{#if right}
			<div class="flex shrink-0 items-center">{@render right()}</div>
		{/if}
	</div>
</header>
