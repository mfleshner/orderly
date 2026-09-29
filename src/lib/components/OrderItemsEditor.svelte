<script lang="ts" module>
	import type { OrderItem } from '$lib/types';

	/** One editable item row. `key` is a stable local id for keyed each + focus. */
	export type EditorRow = { key: number; item_name: string; quantity: number; modifiers: string };

	let nextKey = 1;

	export function newRow(item?: Partial<OrderItem>): EditorRow {
		return {
			key: nextKey++,
			item_name: item?.item_name ?? '',
			quantity: item?.quantity ?? 1,
			modifiers: item?.modifiers ?? ''
		};
	}

	/** Items exactly as they'll be saved: empty names dropped, trimmed, qty clamped. */
	export function cleanItems(list: EditorRow[]) {
		return list
			.filter((r) => r.item_name.trim() !== '')
			.map((r) => ({
				item_name: r.item_name.trim(),
				quantity: Math.min(99, Math.max(1, Math.round(r.quantity) || 1)),
				modifiers: r.modifiers.trim() || null
			}));
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';

	/**
	 * Item-list editor: name / modifiers / qty stepper / remove / reorder, plus "Add item".
	 * Enter on an item jumps to the next one, adds a new one after the last, or calls
	 * `onDone` when the last item is empty (e.g. to focus the next field on the page).
	 */
	let {
		items = $bindable(),
		onDone,
		idPrefix = 'item-name',
		firstPlaceholder = 'What do you get?'
	}: {
		items: EditorRow[];
		onDone?: () => void;
		idPrefix?: string;
		firstPlaceholder?: string;
	} = $props();

	async function focusName(key: number) {
		await tick();
		document.getElementById(`${idPrefix}-${key}`)?.focus();
	}

	function addRow() {
		const row = newRow();
		items.push(row);
		focusName(row.key);
	}

	function removeRow(i: number) {
		if (items.length === 1) {
			items[0] = newRow();
			focusName(items[0].key);
			return;
		}
		items.splice(i, 1);
	}

	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= items.length) return;
		const a = items[i];
		items[i] = items[j];
		items[j] = a;
	}

	function setQty(row: EditorRow, q: number) {
		row.quantity = Math.min(99, Math.max(1, q));
	}

	/** Enter/"next" on an item: jump to the next item, or add a new one after the last. */
	function onItemEnter(e: KeyboardEvent, i: number) {
		if (e.key !== 'Enter' || e.isComposing) return;
		e.preventDefault();
		if (i < items.length - 1) {
			focusName(items[i + 1].key);
		} else if (items[i].item_name.trim()) {
			addRow();
		} else {
			onDone?.();
		}
	}
</script>

<ul class="flex flex-col gap-3">
	{#each items as row, i (row.key)}
		<li class="card p-3" animate:flip={{ duration: 180 }}>
			<div class="flex items-start gap-1.5">
				<input
					id="{idPrefix}-{row.key}"
					class="input font-semibold"
					type="text"
					bind:value={row.item_name}
					placeholder={i === 0 ? firstPlaceholder : 'Another item'}
					aria-label="Item {i + 1} name"
					autocapitalize="sentences"
					autocomplete="off"
					enterkeyhint="next"
					onkeydown={(e) => onItemEnter(e, i)}
				/>
				<button
					type="button"
					class="flex h-12 w-11 shrink-0 items-center justify-center rounded-xl text-ink-3 active:bg-line/60 active:text-danger"
					aria-label="Remove item {i + 1}"
					onclick={() => removeRow(i)}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
				</button>
			</div>

			<input
				class="mt-2 min-h-11 w-full rounded-lg border border-line bg-paper/60 px-3 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
				type="text"
				bind:value={row.modifiers}
				placeholder="no onions, extra sauce"
				aria-label="Item {i + 1} modifiers"
				autocapitalize="none"
				autocomplete="off"
				enterkeyhint="next"
				onkeydown={(e) => onItemEnter(e, i)}
			/>

			<div class="mt-2 flex items-center justify-between">
				<div class="flex items-center rounded-xl border border-line bg-paper/60">
					<button
						type="button"
						class="flex h-11 w-11 items-center justify-center rounded-l-xl text-accent-ink active:bg-line/60 disabled:text-ink-3 disabled:opacity-40"
						aria-label="Decrease quantity"
						disabled={row.quantity <= 1}
						onclick={() => setQty(row, row.quantity - 1)}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14" /></svg>
					</button>
					<span
						class="w-8 text-center text-[17px] font-semibold tabular-nums"
						aria-live="polite"
						aria-label="Quantity {row.quantity}">{row.quantity}</span
					>
					<button
						type="button"
						class="flex h-11 w-11 items-center justify-center rounded-r-xl text-accent-ink active:bg-line/60 disabled:text-ink-3 disabled:opacity-40"
						aria-label="Increase quantity"
						disabled={row.quantity >= 99}
						onclick={() => setQty(row, row.quantity + 1)}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					</button>
				</div>

				{#if items.length > 1}
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-line/60 disabled:opacity-25"
							aria-label="Move item {i + 1} up"
							disabled={i === 0}
							onclick={() => move(i, -1)}
						>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
						</button>
						<button
							type="button"
							class="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-line/60 disabled:opacity-25"
							aria-label="Move item {i + 1} down"
							disabled={i === items.length - 1}
							onclick={() => move(i, 1)}
						>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
						</button>
					</div>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<button
	type="button"
	class="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-card border border-dashed border-line text-[17px] font-semibold text-accent-ink active:bg-accent-soft"
	onclick={addRow}
>
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
	Add item
</button>
