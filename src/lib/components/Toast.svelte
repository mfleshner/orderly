<script lang="ts" module>
	/** Tiny global toast. Call `toast('Copied!')` from anywhere. */
	let message = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	export function toast(msg: string, ms = 1800) {
		message = msg;
		clearTimeout(timer);
		timer = setTimeout(() => (message = null), ms);
	}
</script>

{#if message}
	<div
		class="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-50 flex justify-center px-6"
		role="status"
		aria-live="polite"
	>
		<div class="rounded-full bg-ink px-4 py-2.5 text-[15px] font-medium text-paper shadow-lg">
			{message}
		</div>
	</div>
{/if}
