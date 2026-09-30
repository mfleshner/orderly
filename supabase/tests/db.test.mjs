import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

// Runs the migrations + seed in an in-memory Postgres (PGlite) with a stubbed Supabase auth schema,
// then exercises the RPCs and row-level security as different users. Run: npm run test:db
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const db = new PGlite();

// Minimal Supabase stand-ins
await db.exec(`
  create role authenticated nologin;
  create role anon nologin;
  create schema auth;
  create table auth.users (id uuid primary key, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant usage on schema public to authenticated;
`);
await db.exec(fs.readFileSync(`${root}/migrations/0001_init.sql`, 'utf8'));
await db.exec(fs.readFileSync(`${root}/migrations/0002_runs.sql`, 'utf8'));
await db.exec(fs.readFileSync(`${root}/migrations/0003_copy_restaurants.sql`, 'utf8'));

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
await db.exec(`insert into auth.users(id) values ('${A}'),('${B}'),('${C}')`);
await db.exec(fs.readFileSync(`${root}/seed.sql`, 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); };

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.uid', '${uid}', false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function throws(uid, sql, params, match) {
  try { await as(uid, sql, params); return false; }
  catch (e) { return match ? String(e.message).includes(match) : true; }
}

// Seed sanity
const seeded = await db.query(`select count(*)::int n from members m join groups g on g.id=m.group_id where g.invite_code='TEST1'`);
ok(seeded.rows[0].n === 3, 'seed created 3 members');

// A creates a group
const g = (await as(A, `select create_group('Lunch Crew','Alice') id`)).rows[0].id;
ok(!!g, 'create_group returns id');
const code = (await db.query(`select invite_code from groups where id=$1`, [g])).rows[0].invite_code;
ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(code), `invite code ${code} uses safe alphabet`);

// Isolation: B cannot see A's group before joining
ok((await as(B, `select * from groups where id=$1`, [g])).rows.length === 0, 'non-member cannot read group');
ok((await as(B, `select * from members where group_id=$1`, [g])).rows.length === 0, 'non-member cannot read members');
ok(await throws(B, `insert into restaurants(group_id,name) values ($1,'X')`, [g]), 'non-member cannot add restaurant');

// Preview then join
const prev = (await as(B, `select preview_invite($1) p`, [code.toLowerCase()])).rows[0].p;
ok(prev && prev.name === 'Lunch Crew' && prev.members.length === 1 && !prev.already_member, 'preview_invite works (case-insensitive)');
ok((await as(B, `select preview_invite('ZZZZZ') p`)).rows[0].p === null, 'preview of bad code is null');
ok(await throws(B, `select join_group($1,'alice',false)`, [code], 'name_taken'), 'joining with taken name (any case) raises name_taken');
await as(B, `select join_group($1,'Bob',false)`, [code]);
ok((await as(B, `select * from members where group_id=$1`, [g])).rows.length === 2, 'B sees both members after join');
const again = (await as(B, `select join_group($1,'Whatever',false) id`, [code])).rows[0].id;
ok(again === g && (await db.query(`select count(*)::int n from members where group_id=$1`, [g])).rows[0].n === 2, 'rejoin is idempotent');
const colors = (await db.query(`select color from members where group_id=$1`, [g])).rows.map(r => r.color);
ok(new Set(colors).size === 2, 'members get distinct colors');

// Restaurants + orders
const r = (await as(A, `insert into restaurants(group_id,name,note) values ($1,'Torchys','Eldorado') returning id`, [g])).rows[0].id;
const bob = (await db.query(`select id from members where group_id=$1 and display_name='Bob'`, [g])).rows[0].id;
const items = JSON.stringify([{ item_name: 'Trailer Park', quantity: 1, modifiers: 'trashy' }, { item_name: '  ', quantity: 3 }, { item_name: 'Queso', quantity: 150, modifiers: '' }]);
await as(A, `select save_order($1,$2,$3::json,'Brushfire')`, [r, bob, items]); // A edits B's order: allowed
let rows = (await as(B, `select oi.item_name, oi.quantity, oi.modifiers, oi.sort_order, o.trying_note from orders o join order_items oi on oi.order_id=o.id where o.restaurant_id=$1 order by sort_order`, [r])).rows;
ok(rows.length === 2, 'blank item dropped');
ok(rows[1].quantity === 99 && rows[1].modifiers === null, 'quantity clamped, empty modifiers null');
ok(rows[0].trying_note === 'Brushfire', 'trying note saved');
await as(B, `select save_order($1,$2,$3::json,'')`, [r, bob, JSON.stringify([{ item_name: 'Brushfire', quantity: 1 }])]);
rows = (await as(B, `select oi.item_name, o.trying_note from orders o join order_items oi on oi.order_id=o.id where o.restaurant_id=$1`, [r])).rows;
ok(rows.length === 1 && rows[0].item_name === 'Brushfire' && rows[0].trying_note === null, 'save replaces items and clears trying note');
ok(await throws(C, `select save_order($1,$2,'[]'::json,'')`, [r, bob], 'not_allowed'), 'outsider cannot save_order');
ok((await as(C, `select * from order_items`)).rows.every(x => false) , 'outsider sees no order_items from Lunch Crew');

// Remove + reclaim on a new device
await as(A, `select remove_member($1)`, [bob]);
ok((await as(B, `select * from groups where id=$1`, [g])).rows.length === 0, 'removed member loses access');
ok((await db.query(`select count(*)::int n from orders where member_id=$1`, [bob])).rows[0].n === 1, 'removed member orders kept');
await as(C, `select join_group($1,'bob',true)`, [code]);
const bobRow = (await db.query(`select user_id, removed_at from members where id=$1`, [bob])).rows[0];
ok(bobRow.user_id === C && bobRow.removed_at === null, 'reclaim reassigns + restores member row');

// Leave group (self remove)
const alice = (await db.query(`select id from members where group_id=$1 and display_name='Alice'`, [g])).rows[0].id;
await as(A, `select remove_member($1)`, [alice]);
ok((await as(A, `select * from members where group_id=$1`, [g])).rows.length === 0, 'leaving works and hides group');
ok(await throws(A, `select remove_member($1)`, [bob], 'not_allowed'), 'ex-member cannot remove others');

// TEST1 reclaim flow the README describes
await as(A, `select join_group('TEST1','Matt',true)`);
const torchys = (await as(A, `select r.name, count(oi.id)::int n from restaurants r join orders o on o.restaurant_id=r.id join order_items oi on oi.order_id=o.id join groups g on g.id=r.group_id where g.invite_code='TEST1' group by r.name order by r.name`)).rows;
ok(torchys.length === 2, 'reclaimed seed member can read seed orders');

// ------------------------------------------------------------ runs
const MATT = (await db.query(`select m.id from members m join groups g on g.id=m.group_id where g.invite_code='TEST1' and display_name='Matt'`)).rows[0].id;
const seedRun = (await as(A, `select r.id, r.status, (select count(*)::int from run_participants p where p.run_id=r.id) n from runs r join groups g on g.id=r.group_id where g.invite_code='TEST1'`)).rows;
ok(seedRun.length === 1 && seedRun[0].status === 'open' && seedRun[0].n === 2, 'seed open run with 2 participants visible to member');
ok((await as(B, `select * from runs`)).rows.length === 0, 'non-member cannot see TEST1 runs');

await as(B, `select join_group($1,'Dana',false)`, [code]);
const dana = (await db.query(`select id from members where group_id=$1 and display_name='Dana'`, [g])).rows[0].id;
const runId = (await as(C, `select start_run($1,'  leaving 12  ') id`, [r])).rows[0].id;
const run = (await db.query(`select * from runs where id=$1`, [runId])).rows[0];
ok(run.started_by === bob && run.note === 'leaving 12' && run.status === 'open', 'start_run sets starter + trimmed note');
ok((await db.query(`select member_id from run_participants where run_id=$1`, [runId])).rows.map(x => x.member_id).join() === bob, 'starter auto-added as participant');
ok(await throws(A, `select start_run($1,null)`, [r], 'not_allowed'), 'ex-member cannot start run');

await as(C, `insert into run_participants(run_id,member_id,override_text) values ($1,$2,'something else')`, [runId, dana]);
ok((await as(B, `select * from run_participants where run_id=$1`, [runId])).rows.length === 2, 'participants visible to all members');
ok(await throws(C, `insert into run_participants(run_id,member_id) values ($1,$2)`, [runId, MATT]), 'cannot add member from another group');
await as(B, `update run_participants set override_text=null where run_id=$1 and member_id=$2`, [runId, dana]);
ok((await db.query(`select override_text from run_participants where run_id=$1 and member_id=$2`, [runId, dana])).rows[0].override_text === null, 'override can be cleared');
ok(await throws(A, `insert into run_participants(run_id,member_id) values ($1,$2)`, [runId, alice]), 'ex-member cannot add participants');

await as(C, `update runs set status='closed', closed_at=now() where id=$1`, [runId]);
ok((await db.query(`select status from runs where id=$1`, [runId])).rows[0].status === 'closed', 'run closes');
ok(await throws(B, `insert into run_participants(run_id,member_id) values ($1,$2)`, [runId, alice]), 'closed run rejects new participants');
ok((await as(C, `delete from run_participants where run_id=$1 returning id`, [runId])).rows.length === 0, 'closed run participants cannot be removed');
ok((await as(C, `update runs set status='open' where id=$1 returning id`, [runId])).rows.length === 0, 'closed run cannot be reopened');
ok((await as(C, `select * from run_participants where run_id=$1`, [runId])).rows.length === 2, 'closed run still readable');

// ------------------------------------------------------------ copy restaurants into a new group
// A is an active member of TEST1 (reclaimed Matt) and has left Lunch Crew.
const dupes = (await as(A, `select create_group('Dupes','Matt') id`)).rows[0].id;
ok((await db.query(`select count(*)::int n from restaurants where group_id=$1`, [dupes])).rows[0].n === 0, 'old two-argument create_group still works');
await as(A, `insert into restaurants(group_id,name,note) values ($1,'  torchy''s TACOS ','The one on Eldorado'), ($1,'Chuy''s',null), ($1,'Torchy''s Tacos','downtown')`, [dupes]);

const list = (await as(A, `select copyable_restaurants() j`)).rows[0].j;
const names = list.map((x) => `${x.name.trim().toLowerCase()}|${(x.note ?? '').toLowerCase()}`);
ok(list.length === 4, `copyable list deduped to 4 (got ${list.length}: ${names.join(', ')})`);
const merged = list.find((x) => (x.note ?? '').toLowerCase() === 'the one on eldorado');
ok(merged && merged.groups.length === 2, 'merged restaurant lists both source groups');
ok(merged && merged.items.map((i) => i.item_name).join() === 'Trailer Park,Green chile queso', 'merged restaurant carries the copy that has my usual');
ok(!list.some((x) => x.name === 'Torchys'), 'restaurants from a group I left are not offered');
ok((await as(B, `select copyable_restaurants() j`)).rows[0].j.every((x) => x.groups.includes('Lunch Crew')), 'other users only see their own groups');

const lunchR = r; // Lunch Crew restaurant, A is no longer a member there
const ids = [...list.map((x) => x.id), lunchR];
const fresh = (await as(A, `select create_group('Family','Matt',$1::uuid[]) id`, [ids])).rows[0].id;
const copied = (await db.query(`select name, note from restaurants where group_id=$1 order by name, note`, [fresh])).rows;
ok(copied.length === 4, `new group got 4 restaurants (got ${copied.length})`);
ok(!copied.some((x) => x.name === 'Torchys'), 'restaurant from a group I left was not copied');
const meFresh = (await db.query(`select id from members where group_id=$1`, [fresh])).rows[0].id;
const usual = (await db.query(`select r.name, r.note, oi.item_name, oi.quantity, oi.modifiers, oi.sort_order from orders o join restaurants r on r.id=o.restaurant_id join order_items oi on oi.order_id=o.id where o.member_id=$1 order by r.name, oi.sort_order`, [meFresh])).rows;
ok(usual.filter((x) => x.note === 'the one on Eldorado').map((x) => `${x.item_name}/${x.modifiers}`).join() === 'Trailer Park/trashy,Green chile queso/null', 'my Torchy\'s usual copied with modifiers and order');
ok(usual.some((x) => x.name === 'Whataburger' && x.item_name === '#1 Whataburger'), 'my Whataburger usual copied');
ok(!usual.some((x) => x.name === "Chuy's"), 'restaurant without a usual copied with no order');
ok((await db.query(`select count(*)::int n from orders o join restaurants r on r.id=o.restaurant_id where r.group_id=$1`, [fresh])).rows[0].n === 2, 'only my own orders were copied');

const sneaky = (await as(B, `select create_group('Sneaky','Bee',$1::uuid[]) id`, [list.map((x) => x.id)])).rows[0].id;
ok((await db.query(`select count(*)::int n from restaurants where group_id=$1`, [sneaky])).rows[0].n === 0, 'cannot copy restaurants from groups I am not in');

// ------------------------------------------------------------ joining fills your usuals from other groups
// Fresh users: W (wife) has usuals in "Home"; M creates "Weekend" copying Home's restaurants; W joins.
const W = '44444444-4444-4444-4444-444444444444', M = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into auth.users(id) values ('${W}'),('${M}')`);
const home = (await as(M, `select create_group('Home','Matt') id`)).rows[0].id;
const homeCode = (await db.query(`select invite_code from groups where id=$1`, [home])).rows[0].invite_code;
await as(W, `select join_group($1,'Wife',false)`, [homeCode]);
const hChuys = (await as(M, `insert into restaurants(group_id,name,note) values ($1,'Chuy''s','north') returning id`, [home])).rows[0].id;
const hPho = (await as(M, `insert into restaurants(group_id,name) values ($1,'Pho Place') returning id`, [home])).rows[0].id;
const wifeHome = (await db.query(`select id from members where group_id=$1 and display_name='Wife'`, [home])).rows[0].id;
await as(W, `select save_order($1,$2,$3::json,'queso next time')`, [hChuys, wifeHome, JSON.stringify([{ item_name: 'Chicka-Chicka Boom-Boom', quantity: 1, modifiers: 'extra sauce' }])]);
await as(W, `select save_order($1,$2,$3::json,'')`, [hPho, wifeHome, JSON.stringify([{ item_name: 'Pho tai', quantity: 2 }])]);

const homeList = (await as(M, `select copyable_restaurants() j`)).rows[0].j.filter((x) => x.groups.includes('Home'));
const weekend = (await as(M, `select create_group('Weekend','Matt',$1::uuid[]) id`, [homeList.map((x) => x.id)])).rows[0].id;
const wkCode = (await db.query(`select invite_code from groups where id=$1`, [weekend])).rows[0].invite_code;
await as(W, `select join_group($1,'Wife',false)`, [wkCode]);
const wifeWk = (await db.query(`select id from members where group_id=$1 and display_name='Wife'`, [weekend])).rows[0].id;
const wkOrders = (await db.query(`select r.name, o.trying_note, oi.item_name, oi.quantity, oi.modifiers from orders o join restaurants r on r.id=o.restaurant_id join order_items oi on oi.order_id=o.id where o.member_id=$1 order by r.name`, [wifeWk])).rows;
ok(wkOrders.length === 2, `joining filled 2 usuals from my other group (got ${wkOrders.length})`);
ok(wkOrders.some((x) => x.name === "Chuy's" && x.item_name === 'Chicka-Chicka Boom-Boom' && x.modifiers === 'extra sauce' && x.trying_note === 'queso next time'), 'filled usual keeps items, modifiers, trying note');
ok(wkOrders.some((x) => x.name === 'Pho Place' && x.quantity === 2), 'filled usual keeps quantity');

// Never overwrite: W edits her Weekend Pho usual, leaves, reclaims; it stays as edited.
const wkPho = (await db.query(`select id from restaurants where group_id=$1 and name='Pho Place'`, [weekend])).rows[0].id;
await as(W, `select save_order($1,$2,$3::json,'')`, [wkPho, wifeWk, JSON.stringify([{ item_name: 'Bun bo hue', quantity: 1 }])]);
await as(W, `select remove_member($1)`, [wifeWk]);
await as(W, `select join_group($1,'wife',true)`, [wkCode]);
const pho = (await db.query(`select oi.item_name from orders o join order_items oi on oi.order_id=o.id where o.member_id=$1 and o.restaurant_id=$2`, [wifeWk, wkPho])).rows;
ok(pho.length === 1 && pho[0].item_name === 'Bun bo hue', 'rejoin never overwrites an existing usual');

ok((await db.query(`select count(*)::int n from orders o join members m on m.id=o.member_id where m.group_id=$1 and m.display_name='Matt'`, [weekend])).rows[0].n === 0, 'other members untouched when someone joins');
ok(await throws(W, `select fill_usuals_from_other_groups($1)`, [wifeWk]), 'fill function is not callable from the browser');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
