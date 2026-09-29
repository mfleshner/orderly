export interface Group {
	id: string;
	name: string;
	invite_code: string;
	created_by: string;
	created_at: string;
}

export interface Member {
	id: string;
	group_id: string;
	user_id: string | null;
	display_name: string;
	color: string;
	removed_at: string | null;
	created_at: string;
}

export interface Restaurant {
	id: string;
	group_id: string;
	name: string;
	note: string | null;
	created_at: string;
}

export interface OrderItem {
	id?: string;
	item_name: string;
	quantity: number;
	modifiers: string | null;
	sort_order?: number;
}

export interface Order {
	id: string;
	restaurant_id: string;
	member_id: string;
	trying_note: string | null;
	updated_at: string;
	order_items: OrderItem[];
}

/** A member row on the restaurant screen: the member plus their order there, if any. */
export interface MemberOrder {
	member: Member;
	order: Order | null;
}

export interface InvitePreview {
	id: string;
	name: string;
	members: { id: string; display_name: string; claimed: boolean }[];
	already_member: boolean;
}
