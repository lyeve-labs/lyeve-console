import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, section, type Gate, type Section } from '$lib/api/gate';
import { errorCodeOf } from '$lib/api/limits';
import {
	ADDRESS_DUPLICATE,
	ADDRESS_LIST_FULL,
	ADDRESS_SELF_LOCKOUT,
	cidrIsSound,
	clearTenantGlobal,
	createAddressEntry,
	deleteAddressEntry,
	listAddressEntries,
	readTenantGlobal,
	setTenantGlobal,
	type AddressListRead,
	type TenantGlobalRead,
} from '$lib/api/rate-limit';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	if (notRunning(plugins, PLUGIN.rateLimit)) {
		const gate: Gate = { state: 'absent' };
		return {
			gate,
			limit: { ok: false, gate } as Section<TenantGlobalRead>,
			addresses: { ok: false, gate } as Section<AddressListRead>,
		};
	}

	const client = authedClient(event);
	const [limit, addresses] = await Promise.all([
		section(
			readTenantGlobal(client),
			'Could not load the tenant limit.',
		),
		section(
			listAddressEntries(client),
			'Could not load the address lists.',
		),
	]);

	return { gate: GATE_OK as Gate, limit, addresses };
};

function num(raw: FormDataEntryValue | null): number {
	const n = Number(raw);
	return Number.isFinite(n) ? n : Number.NaN;
}

export const actions: Actions = {
	setLimit: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const rate = num(form.get('rate'));
		const burst = Math.floor(num(form.get('burst')));
		if (!Number.isFinite(rate) || rate <= 0) {
			return fail(400, { action: 'limit', error: 'Enter a rate above zero, in requests per second.' });
		}
		if (!Number.isFinite(burst) || burst < 1) {
			return fail(400, { action: 'limit', error: 'Enter a burst of at least one request.' });
		}
		try {
			await setTenantGlobal(authedClient(event), { rate, burst, enabled: form.get('enabled') === 'true' });
		} catch (err) {
			return tagged('limit', actionFailure(err, 'Could not save the tenant limit. Try again.'));
		}
		return { savedLimit: true };
	},

	// Clearing puts the tenant back on the install-wide limit, and is always allowed.
	clearLimit: asked(
		{
			question: 'Clear the tenant limit?',
			detail: 'This tenant goes back to the global limit alone.',
			label: 'Clear',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			try {
				await clearTenantGlobal(authedClient(event));
			} catch (err) {
				return tagged('clear', actionFailure(err, 'Could not clear the tenant limit. Try again.'));
			}
			return { clearedLimit: true };
		},
	),

	addAddress: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const cidr = String(form.get('cidr') ?? '').trim();
		const list = form.get('list') === 'deny' ? 'deny' : 'allow';
		const note = String(form.get('note') ?? '').trim();
		if (!cidrIsSound(cidr)) {
			return fail(400, { action: 'address', error: 'Enter one address, such as 203.0.113.7, or a range, such as 203.0.113.0/24 or 2001:db8::/32.' });
		}
		if (note.length > 255) return fail(400, { action: 'address', error: 'Enter a note of at most 255 characters.' });
		try {
			await createAddressEntry(authedClient(event), { cidr, list, note });
		} catch (err) {
			// Three refusals share 409, so the page reads the plugin's code. A
			// deny entry that would shut out the address the request came from
			// is refused because only an operator could undo it, and the page
			// says why and how to proceed rather than relaying a bare 409.
			switch (errorCodeOf(err)) {
				case ADDRESS_SELF_LOCKOUT:
					return fail(409, { action: 'address', error: 'That entry would lock you out.', lockout: cidr });
				case ADDRESS_LIST_FULL:
					return fail(409, {
						action: 'address',
						error: 'This tenant has reached its limit of address entries. Remove one before adding another.',
						listFull: true,
					});
				case ADDRESS_DUPLICATE:
					return fail(409, { action: 'address', error: `${cidr} is already on the ${list} list.`, duplicate: cidr });
			}
			return tagged('address', actionFailure(err, 'Could not add the address. Try again.'));
		}
		return { savedAddress: cidr, list };
	},

	deleteAddress: asked(
		{
			question: 'Remove this address from the list?',
			detail: 'Requests from it are treated like any other from the next request.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '').trim();
			if (!id) return fail(400, { action: 'deleteAddress', error: 'This form is missing its entry. Reload the page and try again.' });
			try {
				await deleteAddressEntry(authedClient(event), id);
			} catch (err) {
				return tagged('deleteAddress', actionFailure(err, 'Could not remove the entry. Try again.'));
			}
			return { removedAddress: id };
		},
	),
};
