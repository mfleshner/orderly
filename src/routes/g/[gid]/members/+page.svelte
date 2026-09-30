<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { toast } from '$lib/components/Toast.svelte';
	import { auth, sendMagicLink, upgradeWithEmail } from '$lib/auth.svelte';
	import {
		friendlyError,
		getGroup,
		getMyMember,
		listMembers,
		removeMember,
		renameGroup,
		updateMember
	} from '$lib/api';
	import { copyText, inviteLink } from '$lib/format';
	import type { Group, Member } from '$lib/types';

	const gid = $derived(page.params.gid ?? '');
	const justCreated = $derived(page.url.searchParams.get('created') === '1');

	let loading = $state(true);
	let error = $state<string | null>(null);
	let notMember = $state(false);
	let group = $state<Group | null>(null);
	let me = $state<Member | null>(null);
	let members = $state<Member[]>([]);

	async function load(groupId: string) {
		loading = true;
		error = null;
		notMember = false;
		try {
			const member = await getMyMember(groupId, auth.user!.id);
			if (!member) {
				notMember = true;
				return;
			}
			me = member;
			const [g, ms] = await Promise.all([getGroup(groupId), listMembers(groupId)]);
			group = g;
			members = ms;
		} catch (e) {
			error = friendlyError(e);
		} finally {
			loading = false;
		}
	}

	async function refreshMembers() {
		try {
			members = await listMembers(gid);
			me = members.find((m) => m.id === me?.id) ?? me;
		} catch (e) {
			toast(friendlyError(e));
		}
	}

	$effect(() => {
		if (gid) load(gid);
	});

	// ------------------------------------------------------------ invite
	const link = $derived(group ? inviteLink(group.invite_code) : '');
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	async function copyLink() {
		if (!link) return;
		toast((await copyText(link)) ? 'Link copied' : "Couldn't copy. Long-press the link instead.");
	}

	async function shareLink() {
		if (!group) return;
		try {
			await navigator.share({
				title: 'Usual Order',
				text: `Join ${group.name} on Usual Order`,
				url: link
			});
		} catch (e) {
			// User cancelled the share sheet: nothing to do. Anything else: fall back to copying.
			if (e instanceof Error && e.name === 'AbortError') return;
			copyLink();
		}
	}

	// ------------------------------------------------------------ members
	let busyId = $state<string | null>(null);

	async function remove(m: Member) {
		if (!confirm(`Remove ${m.display_name}? Their orders are kept but hidden.`)) return;
		busyId = m.id;
		try {
			await removeMember(m.id);
			toast(`${m.display_name} removed`);
			await refreshMembers();
		} catch (e) {
			toast(friendlyError(e));
		} finally {
			busyId = null;
		}
	}

	let leaving = $state(false);
	async function leave() {
		if (!me || !group) return;
		if (!confirm(`Leave ${group.name}? Your orders are kept but hidden.`)) return;
		leaving = true;
		try {
			await removeMember(me.id);
			await goto('/');
		} catch (e) {
			toast(friendlyError(e));
			leaving = false;
		}
	}

	// Rename myself
	let editingMe = $state(false);
	let myName = $state('');
	let nameError = $state<string | null>(null);
	let savingName = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);

	// Same palette the database assigns from, plus a few extras.
	const PALETTE = [
		'#e0533c', '#2f7fd6', '#2aa876', '#d9a021', '#9256d9',
		'#d6479c', '#1fa3a3', '#e07a1f', '#5e6ad2', '#6e8b3d',
		'#8b5a2b', '#3c3c3c'
	];
	let myColor = $state('');
	const takenColors = $derived(new Set(members.filter((m) => m.id !== me?.id).map((m) => m.color)));

	async function startEditMe() {
		if (!me) return;
		myName = me.display_name;
		myColor = me.color;
		nameError = null;
		editingMe = true;
		await tick();
		nameInput?.focus();
		nameInput?.select();
	}

	async function saveMyName(e: SubmitEvent) {
		e.preventDefault();
		if (!me || savingName) return;
		const name = myName.trim();
		if (!name) return;
		const nameChanged = name !== me.display_name;
		const colorChanged = myColor !== me.color;
		if (!nameChanged && !colorChanged) {
			editingMe = false;
			return;
		}
		if (
			nameChanged &&
			members.some((m) => m.id !== me!.id && m.display_name.toLowerCase() === name.toLowerCase())
		) {
			nameError = 'That name is taken in this group.';
			return;
		}
		savingName = true;
		nameError = null;
		try {
			await updateMember(me.id, {
				...(nameChanged ? { display_name: name } : {}),
				...(colorChanged ? { color: myColor } : {})
			});
			editingMe = false;
			await refreshMembers();
			toast(nameChanged ? 'Name updated' : 'Color updated');
		} catch (err) {
			nameError = friendlyError(err);
		} finally {
			savingName = false;
		}
	}

	// Rename group
	let editingGroup = $state(false);
	let groupName = $state('');
	let groupError = $state<string | null>(null);
	let savingGroup = $state(false);
	let groupInput = $state<HTMLInputElement | null>(null);

	async function startEditGroup() {
		if (!group) return;
		groupName = group.name;
		groupError = null;
		editingGroup = true;
		await tick();
		groupInput?.focus();
		groupInput?.select();
	}

	async function saveGroupName(e: SubmitEvent) {
		e.preventDefault();
		if (!group || savingGroup) return;
		const name = groupName.trim();
		if (!name) return;
		if (name === group.name) {
			editingGroup = false;
			return;
		}
		savingGroup = true;
		groupError = null;
		try {
			await renameGroup(group.id, name);
			group.name = name;
			editingGroup = false;
			toast('Group renamed');
		} catch (err) {
			groupError = friendlyError(err);
		} finally {
			savingGroup = false;
		}
	}

	// ------------------------------------------------------------ keep my account
	const savedEmail = $derived(
		auth.user?.email && !auth.user.is_anonymous ? auth.user.email : null
	);
	const pendingEmail = $derived(auth.user?.new_email ?? null);

	let accountMode = $state<'save' | 'signin'>('save');
	let email = $state('');
	let accountBusy = $state(false);
	let accountMsg = $state<string | null>(null);
	let accountError = $state<string | null>(null);

	function switchMode(mode: 'save' | 'signin') {
		accountMode = mode;
		accountMsg = null;
		accountError = null;
	}

	async function submitAccount(e: SubmitEvent) {
		e.preventDefault();
		const addr = email.trim();
		if (!addr || accountBusy) return;
		accountBusy = true;
		accountMsg = null;
		accountError = null;
		try {
			if (accountMode === 'save') {
				await upgradeWithEmail(addr);
				accountMsg = 'Check your email to confirm.';
			} else {
				await sendMagicLink(addr);
				accountMsg = 'Check your email for a sign-in link.';
			}
		} catch (err) {
			const msg = friendlyError(err);
			accountError =
				accountMode === 'signin' && /signups not allowed|not found/i.test(msg)
					? "We don't have an account with that email."
					: msg;
		} finally {
			accountBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Members · {group?.name ?? 'Usual Order'}</title>
</svelte:head>

<Header title="Members" subtitle={group?.name} back={`/g/${gid}`} />

<main class="px-4 pt-4 pb-16">
	{#if loading}
		<div class="flex justify-center py-16">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"></div>
		</div>
	{:else if notMember}
		<div class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-[20px] font-bold">You're not in this group</p>
			<p class="text-ink-2">Ask a friend for the invite link to join.</p>
			<a href="/" class="btn-secondary mt-2">Go home</a>
		</div>
	{:else if error || !group || !me}
		<div class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-[20px] font-bold">Hmm, that didn't load</p>
			<p class="text-ink-2">{error ?? 'Something went wrong.'}</p>
			<button class="btn-secondary mt-2" onclick={() => load(gid)}>Try again</button>
		</div>
	{:else}
		{#if justCreated}
			<p class="mb-3 flex items-center gap-2 px-1 text-[16px] font-semibold text-accent-ink">
				<svg class="shrink-0" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l5-13 8 8-13 5z" /><path d="M14 4l1 2M19 5l-2 2M20 10l-2-.5M11 3.5l.3 1" /></svg>
				Group created! Send this link to your people.
			</p>
		{/if}

		<!-- Invite -->
		<section class="card p-4">
			<h2 class="text-[19px] font-bold">Invite friends</h2>
			<p class="mt-0.5 text-[15px] text-ink-2">Anyone with the link can join. No sign-up needed.</p>

			<p class="mt-4 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">Code</p>
			<p
				class="mt-0.5 font-mono text-[34px] leading-none font-bold tracking-[0.18em] text-ink"
				aria-label={`Invite code ${group.invite_code.split('').join(' ')}`}
			>
				{group.invite_code}
			</p>

			<button
				type="button"
				class="mt-4 block w-full truncate rounded-full border border-line bg-paper px-4 py-2.5 text-left font-mono text-[14px] text-ink-2 select-all active:bg-line/50"
				onclick={copyLink}
				aria-label="Invite link, tap to copy"
			>
				{link.replace(/^https?:\/\//, '')}
			</button>

			<div class="mt-4 flex gap-2">
				<button type="button" class="btn-primary flex-[2]" onclick={copyLink}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" /></svg>
					Copy link
				</button>
				{#if canShare}
					<button type="button" class="btn-secondary flex-1" onclick={shareLink}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" /><path d="M8 11H6.5A2.5 2.5 0 0 0 4 13.5v5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5H16" /></svg>
						Share
					</button>
				{/if}
			</div>
		</section>

		<!-- Members -->
		<h2 class="label mt-7 px-1">
			{members.length}
			{members.length === 1 ? 'member' : 'members'}
		</h2>
		<ul class="card divide-hair overflow-hidden">
			{#each members as m (m.id)}
				{@const isMe = m.id === me.id}
				<li>
					{#if isMe && editingMe}
						<form class="p-4" onsubmit={saveMyName}>
							<label class="label" for="my-name">Your name</label>
							<input
								id="my-name"
								class="input"
								bind:this={nameInput}
								bind:value={myName}
								maxlength="30"
								autocapitalize="words"
								autocomplete="off"
								enterkeyhint="done"
								required
							/>
							{#if nameError}
								<p class="mt-2 text-[15px] text-danger">{nameError}</p>
							{/if}

							<p class="label mt-4">Your color</p>
							<div class="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Your color">
								{#each PALETTE as c (c)}
									{@const selected = c === myColor}
									<button
										type="button"
										role="radio"
										aria-checked={selected}
										aria-label={takenColors.has(c) ? 'Color, used by someone else' : 'Color'}
										class="relative flex h-12 w-full items-center justify-center rounded-xl transition-transform active:scale-95"
										onclick={() => (myColor = c)}
									>
										<span
											class="flex h-8 w-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-card {selected ? 'ring-2 ring-ink' : ''}"
											style="background-color: {c}"
										>
											{#if selected}
												<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
											{/if}
										</span>
										{#if takenColors.has(c) && !selected}
											<span class="absolute right-1.5 bottom-1.5 h-2 w-2 rounded-full bg-ink-3" title="Used by someone else"></span>
										{/if}
									</button>
								{/each}
							</div>
							{#if takenColors.has(myColor)}
								<p class="mt-1.5 text-[13px] text-ink-3">Someone else uses this color, but that's allowed.</p>
							{/if}

							<div class="mt-3 flex gap-2">
								<button type="button" class="btn-secondary flex-1" onclick={() => (editingMe = false)}>
									Cancel
								</button>
								<button type="submit" class="btn-primary flex-[2]" disabled={savingName || !myName.trim()}>
									{savingName ? 'Saving…' : 'Save'}
								</button>
							</div>
						</form>
					{:else if isMe}
						<button
							type="button"
							class="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-line/40"
							onclick={startEditMe}
							aria-label="Change your name or color"
						>
							<span class="h-4 w-4 shrink-0 rounded-full" style="background-color: {m.color}"></span>
							<span class="min-w-0 flex-1 text-[17px] font-semibold break-words">
								{m.display_name} <span class="font-normal text-ink-3">(you)</span>
							</span>
							<span class="flex shrink-0 items-center gap-1 text-[14px] font-medium text-accent-ink">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /></svg>
								Edit
							</span>
						</button>
					{:else}
						<div class="flex min-h-14 items-center gap-3 py-1.5 pr-1.5 pl-4">
							<span class="h-4 w-4 shrink-0 rounded-full" style="background-color: {m.color}"></span>
							<span class="min-w-0 flex-1 text-[17px] font-semibold break-words">{m.display_name}</span>
							<button
								type="button"
								class="flex h-11 shrink-0 items-center rounded-full px-3 text-[14px] font-medium text-ink-3 active:bg-line/60 disabled:opacity-40"
								onclick={() => remove(m)}
								disabled={busyId === m.id}
								aria-label={`Remove ${m.display_name}`}
							>
								{busyId === m.id ? 'Removing…' : 'Remove'}
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if members.length === 1}
			<p class="mt-2 px-1 text-[14px] text-ink-3">Just you so far. Send the link above!</p>
		{/if}

		<!-- Group name -->
		<h2 class="label mt-7 px-1">Group name</h2>
		{#if editingGroup}
			<form class="card p-4" onsubmit={saveGroupName}>
				<input
					class="input"
					bind:this={groupInput}
					bind:value={groupName}
					aria-label="Group name"
					autocapitalize="words"
					autocomplete="off"
					enterkeyhint="done"
					required
				/>
				{#if groupError}
					<p class="mt-2 text-[15px] text-danger">{groupError}</p>
				{/if}
				<div class="mt-3 flex gap-2">
					<button type="button" class="btn-secondary flex-1" onclick={() => (editingGroup = false)}>
						Cancel
					</button>
					<button type="submit" class="btn-primary flex-[2]" disabled={savingGroup || !groupName.trim()}>
						{savingGroup ? 'Saving…' : 'Save'}
					</button>
				</div>
			</form>
		{:else}
			<button
				type="button"
				class="card flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-line/40"
				onclick={startEditGroup}
			>
				<span class="min-w-0 flex-1 text-[17px] font-semibold break-words">{group.name}</span>
				<span class="shrink-0 text-[14px] font-medium text-accent-ink">Rename</span>
			</button>
		{/if}

		<!-- Keep my account -->
		<section class="card mt-7 p-4">
			<h2 class="text-[17px] font-bold">Keep my account</h2>
			{#if savedEmail}
				<p class="mt-1 text-[15px] text-ink-2">
					Saved as <span class="font-semibold break-all text-ink">{savedEmail}</span>. Sign in with
					it on any device.
				</p>
			{:else}
				<p class="mt-1 text-[15px] text-ink-2">
					{#if accountMode === 'save'}
						Your account lives on this phone. Add an email to use it on another device.
					{:else}
						Get a sign-in link for the account you saved before. This phone will switch to it.
					{/if}
				</p>
				{#if pendingEmail && accountMode === 'save' && !accountMsg}
					<p class="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[14px] text-warn">
						Waiting for you to confirm <span class="font-semibold break-all">{pendingEmail}</span>.
					</p>
				{/if}
				<form class="mt-3" onsubmit={submitAccount}>
					<input
						class="input"
						type="email"
						bind:value={email}
						placeholder="you@example.com"
						aria-label="Email"
						inputmode="email"
						autocapitalize="off"
						autocomplete="email"
						spellcheck="false"
						enterkeyhint="send"
						required
					/>
					<button type="submit" class="btn-secondary mt-2 w-full" disabled={accountBusy || !email.trim()}>
						{#if accountBusy}
							Sending…
						{:else if accountMode === 'save'}
							Save my account
						{:else}
							Email me a sign-in link
						{/if}
					</button>
				</form>
				{#if accountMsg}
					<p class="mt-3 text-[15px] font-semibold text-accent-ink">{accountMsg}</p>
				{/if}
				{#if accountError}
					<p class="mt-3 text-[15px] text-danger">{accountError}</p>
				{/if}
				<button
					type="button"
					class="mt-2 min-h-11 text-[14px] font-medium text-ink-3 underline underline-offset-2 active:text-ink-2"
					onclick={() => switchMode(accountMode === 'save' ? 'signin' : 'save')}
				>
					{accountMode === 'save'
						? 'Already saved your account on another device? Sign in with email'
						: 'Never mind, keep this phone’s account'}
				</button>
			{/if}
		</section>

		<!-- Leave -->
		<div class="mt-8 flex justify-center">
			<button
				type="button"
				class="inline-flex min-h-12 items-center rounded-xl px-5 text-[17px] font-semibold text-danger active:bg-line/50 disabled:opacity-40"
				onclick={leave}
				disabled={leaving}
			>
				{leaving ? 'Leaving…' : 'Leave group'}
			</button>
		</div>
	{/if}
</main>
