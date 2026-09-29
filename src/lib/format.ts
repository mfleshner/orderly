import type { MemberOrder, OrderItem } from './types';

/** "2x Fried Avocado (no pico)": quantity only when >1, modifiers in parentheses. */
export function formatItem(item: OrderItem): string {
	const qty = item.quantity > 1 ? `${item.quantity}x ` : '';
	const mods = item.modifiers?.trim() ? ` (${item.modifiers.trim()})` : '';
	return `${qty}${item.item_name.trim()}${mods}`;
}

export function formatItems(items: OrderItem[]): string {
	return [...items]
		.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
		.map(formatItem)
		.join(', ');
}

/**
 * The one text block for pasting into a delivery app:
 *   Torchy's Tacos
 *   Matt: Trailer Park (trashy), Green chile queso
 * Members without a usual are omitted.
 */
export function formatCopyOrder(restaurantName: string, rows: MemberOrder[]): string {
	const lines = rows
		.filter((r) => r.order && r.order.order_items.length > 0)
		.map((r) => `${r.member.display_name}: ${formatItems(r.order!.order_items)}`);
	return [restaurantName, ...lines].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Fallback for older iOS Safari / non-secure contexts
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	}
}

export function inviteLink(code: string): string {
	return `${window.location.origin}/join/${code}`;
}
