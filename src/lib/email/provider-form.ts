import {
	API_METHODS,
	TRANSPORTS,
	WEBHOOK_EVENTS,
	type EmailProviderBody,
	type EmailTransport,
} from '$lib/api/email';
import { checked } from '$lib/checkbox';

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

function isTransport(v: string): v is EmailTransport {
	return (TRANSPORTS as string[]).includes(v);
}

/** Key-value rows the form sends as two parallel lists. A blank key is an unused row. */
function pairs(data: FormData, keyName: string, valueName: string): Record<string, string> {
	const keys = data.getAll(keyName).map(String);
	const values = data.getAll(valueName).map(String);
	const out: Record<string, string> = {};
	keys.forEach((k, i) => {
		const key = k.trim();
		if (key) out[key] = (values[i] ?? '').trim();
	});
	return out;
}

/**
 * What the email provider form sends, checked before it reaches the plugin. A secret is sent
 * only when typed: the plugin's update route touches what arrives, so a blank
 * on edit keeps the stored one. The key is required all the same when the row
 * is new or when the transport changed, because an smtp row holds no key.
 */
export function parseProvider(
	data: FormData,
	editing: boolean,
): { body: EmailProviderBody } | { error: string } {
	const name = text(data, 'name');
	if (!name) return { error: 'Enter a name.' };
	const transport = text(data, 'transport') || 'smtp';
	if (!isTransport(transport)) return { error: 'Choose SMTP or API.' };
	const from_addr = text(data, 'from_addr');
	if (!from_addr) return { error: 'Enter a from address.' };

	const body: EmailProviderBody = {
		name,
		transport,
		from_addr,
		priority: Number(text(data, 'priority')) || 0,
		max_per_hour: Number(text(data, 'max_per_hour')) || 0,
	};
	const status = text(data, 'status');
	if (status) body.status = status;

	if (transport === 'smtp') {
		body.host = text(data, 'host');
		if (!body.host) return { error: 'Enter the SMTP host.' };
		const port = Number(text(data, 'port'));
		if (port) body.port = port;
		body.username = text(data, 'username');
		body.use_tls = checked(data, 'use_tls');
		const password = text(data, 'password');
		if (password) body.password = password;
		return { body };
	}

	const keyKept = editing && text(data, 'stored_transport') === 'api';
	const api_key = text(data, 'api_key');
	if (api_key) body.api_key = api_key;
	else if (!keyKept) return { error: 'Enter the API key.' };
	body.api_base_url = text(data, 'api_base_url');
	if (!body.api_base_url) return { error: 'Enter the API base URL.' };
	const webhook_secret = text(data, 'webhook_secret');
	if (webhook_secret) body.webhook_secret = webhook_secret;
	body.api_method = (text(data, 'api_method') || 'POST').toUpperCase();
	if (!(API_METHODS as readonly string[]).includes(body.api_method)) return { error: 'Choose POST, PUT or PATCH.' };
	body.api_path = text(data, 'api_path');
	if (body.api_path && !body.api_path.startsWith('/')) return { error: 'Start the path with /.' };
	if (/[?#]/.test(body.api_path)) return { error: 'Leave the query and fragment out of the path. Put them in the body template.' };
	body.api_headers = pairs(data, 'api_header_key', 'api_header_value');
	body.api_body = String(data.get('api_body') ?? '').trim();
	body.api_message_id_path = text(data, 'api_message_id_path');
	body.api_webhook_event_path = text(data, 'api_webhook_event_path');
	body.api_webhook_recipient_path = text(data, 'api_webhook_recipient_path');
	body.api_webhook_message_id_path = text(data, 'api_webhook_message_id_path');
	body.api_webhook_reason_path = text(data, 'api_webhook_reason_path');
	const map = pairs(data, 'event_map_key', 'event_map_value');
	const bad = Object.entries(map).find(([, v]) => !(WEBHOOK_EVENTS as string[]).includes(v));
	if (bad) return { error: `"${bad[0]}" maps to ${bad[1] || 'nothing'}. Choose one of ${WEBHOOK_EVENTS.join(', ')}.` };
	body.api_webhook_event_map = map;
	return { body };
}
