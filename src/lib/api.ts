import { supabase } from './supabase';
import type {
	Group,
	InvitePreview,
	Member,
	MemberOrder,
	OpenRunSummary,
	Order,
	OrderItem,
	Restaurant,
	Run,
	RunParticipant
} from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
	if (res.error) throw new Error(res.error.message);
	return res.data as T;
}

/** Map Postgres exception text from our RPCs to friendly messages. */
export function friendlyError(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	if (msg.includes('name_taken')) return 'That name is taken in this group.';
	if (msg.includes('invalid_code')) return "That invite code doesn't match any group.";
	if (msg.includes('not_allowed')) return "You're not in this group.";
	if (msg.includes('duplicate key') && msg.includes('display_name'))
		return 'That name is taken in this group.';
	if (msg.toLowerCase().includes('failed to fetch'))
		return "Can't reach the server. Check your connection and try again.";
	return msg;
}

// ---------------------------------------------------------------- groups

/** Groups the current user belongs to, newest first. */
export async function listMyGroups(userId: string): Promise<Group[]> {
	const rows = check(
		await supabase.from('members').select('groups(*)').eq('user_id', userId).is('removed_at', null)
	) as unknown as { groups: Group | null }[];
	return rows
		.map((r) => r.groups)
		.filter((g): g is Group => !!g)
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getGroup(groupId: string): Promise<Group> {
	return check(await supabase.from('groups').select('*').eq('id', groupId).single());
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
	check(await supabase.from('groups').update({ name: name.trim() }).eq('id', groupId));
}

/** Creates the group and the caller's member row. Returns the new group id. */
export async function createGroup(groupName: string, memberName: string): Promise<string> {
	return check(
		await supabase.rpc('create_group', { group_name: groupName, member_name: memberName })
	) as string;
}

/** Returns null if the code doesn't exist. */
export async function previewInvite(code: string): Promise<InvitePreview | null> {
	return check(await supabase.rpc('preview_invite', { code })) as InvitePreview | null;
}

/** Join by code. Throws 'name_taken' if the name exists and reclaim is false. Returns group id. */
export async function joinGroup(code: string, memberName: string, reclaim = false): Promise<string> {
	return check(
		await supabase.rpc('join_group', { code, member_name: memberName, reclaim })
	) as string;
}

// ---------------------------------------------------------------- members

/** Active (non-removed) members, alphabetical. */
export async function listMembers(groupId: string): Promise<Member[]> {
	return check(
		await supabase
			.from('members')
			.select('*')
			.eq('group_id', groupId)
			.is('removed_at', null)
			.order('display_name')
	);
}

/** The current user's member row in a group, or null. */
export async function getMyMember(groupId: string, userId: string): Promise<Member | null> {
	return check(
		await supabase
			.from('members')
			.select('*')
			.eq('group_id', groupId)
			.eq('user_id', userId)
			.is('removed_at', null)
			.maybeSingle()
	);
}

/** Soft remove (or leave, for your own member): hides the member; their row and orders are kept. */
export async function removeMember(memberId: string): Promise<void> {
	check(await supabase.rpc('remove_member', { mid: memberId }));
}

export async function updateMember(
	memberId: string,
	patch: Partial<Pick<Member, 'display_name' | 'color'>>
): Promise<void> {
	check(await supabase.from('members').update(patch).eq('id', memberId));
}

// ---------------------------------------------------------------- restaurants

export async function listRestaurants(groupId: string): Promise<Restaurant[]> {
	return check(
		await supabase.from('restaurants').select('*').eq('group_id', groupId).order('name')
	);
}

export async function getRestaurant(restaurantId: string): Promise<Restaurant> {
	return check(await supabase.from('restaurants').select('*').eq('id', restaurantId).single());
}

export async function addRestaurant(
	groupId: string,
	name: string,
	note?: string
): Promise<Restaurant> {
	return check(
		await supabase
			.from('restaurants')
			.insert({ group_id: groupId, name: name.trim(), note: note?.trim() || null })
			.select()
			.single()
	);
}

export async function updateRestaurant(
	restaurantId: string,
	patch: Partial<Pick<Restaurant, 'name' | 'note'>>
): Promise<void> {
	check(await supabase.from('restaurants').update(patch).eq('id', restaurantId));
}

export async function deleteRestaurant(restaurantId: string): Promise<void> {
	check(await supabase.from('restaurants').delete().eq('id', restaurantId));
}

/** Map of restaurant_id -> number of active members with a non-empty usual. For the list screen. */
export async function usualCounts(groupId: string): Promise<Record<string, number>> {
	const rows = check(
		await supabase
			.from('orders')
			.select(
				'restaurant_id, order_items(id), restaurants!inner(group_id), members!inner(removed_at)'
			)
			.eq('restaurants.group_id', groupId)
			.is('members.removed_at', null)
	) as unknown as { restaurant_id: string; order_items: { id: string }[] }[];
	const counts: Record<string, number> = {};
	for (const r of rows) {
		if (r.order_items.length > 0) counts[r.restaurant_id] = (counts[r.restaurant_id] ?? 0) + 1;
	}
	return counts;
}

// ---------------------------------------------------------------- orders

/** Every active member in the group paired with their order at this restaurant (or null). */
export async function getRestaurantOrders(
	groupId: string,
	restaurantId: string
): Promise<MemberOrder[]> {
	const [members, ordersRes] = await Promise.all([
		listMembers(groupId),
		supabase.from('orders').select('*, order_items(*)').eq('restaurant_id', restaurantId)
	]);
	const orders = check(ordersRes) as Order[];
	const byMember = new Map(orders.map((o) => [o.member_id, o]));
	return members.map((member) => {
		const order = byMember.get(member.id) ?? null;
		order?.order_items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
		return { member, order };
	});
}

export async function getOrder(restaurantId: string, memberId: string): Promise<Order | null> {
	const order = check(
		await supabase
			.from('orders')
			.select('*, order_items(*)')
			.eq('restaurant_id', restaurantId)
			.eq('member_id', memberId)
			.maybeSingle()
	) as Order | null;
	order?.order_items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
	return order;
}

/** Replace a member's usual + trying note in one call. Empty item names are dropped server-side. */
export async function saveOrder(
	restaurantId: string,
	memberId: string,
	items: Pick<OrderItem, 'item_name' | 'quantity' | 'modifiers'>[],
	tryingNote: string | null
): Promise<string> {
	return check(
		await supabase.rpc('save_order', {
			rid: restaurantId,
			mid: memberId,
			items,
			trying: tryingNote ?? ''
		})
	) as string;
}

// ---------------------------------------------------------------- runs (RUNS.md)

/** Start a run at a restaurant; the caller is added as the first participant. Returns run id. */
export async function startRun(restaurantId: string, note?: string): Promise<string> {
	return check(
		await supabase.rpc('start_run', { rid: restaurantId, run_note: note ?? null })
	) as string;
}

export async function getRun(runId: string): Promise<Run> {
	return check(await supabase.from('runs').select('*').eq('id', runId).single());
}

export async function listParticipants(runId: string): Promise<RunParticipant[]> {
	return check(
		await supabase.from('run_participants').select('*').eq('run_id', runId).order('created_at')
	);
}

/** Add someone to a run (or update their override if already in). Null override = their usual. */
export async function addParticipant(
	runId: string,
	memberId: string,
	overrideText: string | null
): Promise<void> {
	check(
		await supabase
			.from('run_participants')
			.upsert(
				{ run_id: runId, member_id: memberId, override_text: overrideText?.trim() || null },
				{ onConflict: 'run_id,member_id' }
			)
	);
}

export async function setOverride(participantId: string, overrideText: string | null): Promise<void> {
	check(
		await supabase
			.from('run_participants')
			.update({ override_text: overrideText?.trim() || null })
			.eq('id', participantId)
	);
}

export async function removeParticipant(participantId: string): Promise<void> {
	check(await supabase.from('run_participants').delete().eq('id', participantId));
}

export async function closeRun(runId: string): Promise<void> {
	check(
		await supabase
			.from('runs')
			.update({ status: 'closed', closed_at: new Date().toISOString() })
			.eq('id', runId)
	);
}

/** Open runs in a group (optionally at one restaurant), newest first, with participant counts. */
export async function listOpenRuns(groupId: string, restaurantId?: string): Promise<OpenRunSummary[]> {
	let q = supabase
		.from('runs')
		.select('*, restaurants(name), starter:members(display_name), run_participants(count)')
		.eq('group_id', groupId)
		.eq('status', 'open')
		.order('created_at', { ascending: false });
	if (restaurantId) q = q.eq('restaurant_id', restaurantId);
	const rows = check(await q) as unknown as (Run & {
		restaurants: { name: string } | null;
		starter: { display_name: string } | null;
		run_participants: { count: number }[];
	})[];
	return rows.map(({ restaurants, starter, run_participants, ...run }) => ({
		...run,
		restaurant_name: restaurants?.name ?? '',
		starter_name: starter?.display_name ?? null,
		participant_count: run_participants[0]?.count ?? 0
	}));
}

/**
 * When each member last joined a run at this restaurant (member_id -> ISO time).
 * Used to sort "Everyone else" with recent participants first.
 */
export async function recentParticipation(
	restaurantId: string,
	excludeRunId?: string
): Promise<Record<string, string>> {
	let q = supabase
		.from('run_participants')
		.select('member_id, created_at, runs!inner(restaurant_id)')
		.eq('runs.restaurant_id', restaurantId)
		.order('created_at', { ascending: false })
		.limit(300);
	if (excludeRunId) q = q.neq('run_id', excludeRunId);
	const rows = check(await q) as unknown as { member_id: string; created_at: string }[];
	const last: Record<string, string> = {};
	for (const r of rows) if (!last[r.member_id]) last[r.member_id] = r.created_at;
	return last;
}
