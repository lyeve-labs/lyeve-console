import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';

// A dev or preview server refuses a Host header it does not recognize, which
// is what keeps a public name from being pointed at a developer's machine.
// Serving the app under a tunnel means naming the domains it may answer for.
// A leading dot covers the domain and its subdomains. Unset leaves the default
// of localhost only, so nothing is relaxed until a domain is named.
const allowedHosts = (process.env.DEV_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

// The captcha providers' own origins, from each one's published CSP guidance.
const CAPTCHA_SCRIPT_ORIGINS = [
	'https://challenges.cloudflare.com',
	'https://hcaptcha.com',
	'https://*.hcaptcha.com',
	'https://www.google.com/recaptcha/',
	'https://www.gstatic.com/recaptcha/',
];
const CAPTCHA_FRAME_ORIGINS = [
	'https://challenges.cloudflare.com',
	'https://hcaptcha.com',
	'https://*.hcaptcha.com',
	'https://www.google.com/recaptcha/',
	'https://recaptcha.google.com/recaptcha/',
];

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// Throw on an accessibility warning rather than printing one. The
			// application has none, so the gate fires only on a new one.
			//
			// Both spellings are tested. Svelte 5 spells every warning code in
			// snake_case, so a gate written as startsWith('a11y-') would match
			// nothing and reject nothing while still reading as a working gate.
			onwarn: (warning, handler) => {
				if (/^a11y[-_]/.test(warning.code ?? '')) {
					throw new Error(`a11y violation: ${warning.code}: ${warning.message}`);
				}
				handler?.(warning);
			},
			preprocess: vitePreprocess(),
			adapter: adapter(),
			// CSP via SvelteKit so its inline hydration scripts get nonces automatically.
			// The fonts ship with the build, so no font origin is allowed. The sign-in
			// challenge loads its widget from whichever provider the captcha plugin
			// is configured for (Turnstile, hCaptcha or
			// reCAPTCHA), so those origins are allowed for scripts and frames. The list
			// matches captchaScriptURL in src/lib/captcha.ts. Everything else is locked
			// to 'self'.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', ...CAPTCHA_SCRIPT_ORIGINS],
					'style-src': ['self', 'unsafe-inline', 'https://hcaptcha.com', 'https://*.hcaptcha.com'],
					'font-src': ['self', 'data:'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self', 'https://hcaptcha.com', 'https://*.hcaptcha.com'],
					'frame-src': CAPTCHA_FRAME_ORIGINS,
					'frame-ancestors': ['none'],
					'form-action': ['self'],
					'base-uri': ['self'],
					'object-src': ['none']
				}
			}
		}),
	],
	// Never emit source maps in the production bundle. They expose original
	// TypeScript source to anyone who can reach the built assets.
	build: { sourcemap: false },
	// The runtime image ships build/ without node_modules. adapter-node leaves
	// every package in dependencies as a bare import, and Vite keeps plain
	// JavaScript packages external, so the engine clients have to be bundled
	// here or the server cannot load them. tools/check-server-bundle.mjs fails
	// the image build when another one is left outside. qrcode is not listed:
	// only the browser loads it, and listing it makes the dev server evaluate
	// its CommonJS as an ES module.
	ssr: { noExternal: ['@lyeve-labs/client', '@lyeve-labs/client-rest'] },
	// Under vitest, resolve Svelte to its browser build so components can be
	// mounted with @testing-library/svelte. Guarded by VITEST so the production
	// build is unaffected. Component test files opt into jsdom per-file with
	// `// @vitest-environment jsdom`. The default env stays node so the SSR
	// (no-window) code paths remain testable.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		// Node 26 owns the `localStorage` global and leaves it undefined unless
		// the process was started with --localstorage-file. Under jsdom that
		// global is the only one there is, so every test touching storage fails
		// with "Cannot read properties of undefined" and nothing names the Node
		// version as the cause.
		setupFiles: ['./vitest.setup.ts'],
		// Vitest's default include glob walks the whole project root, so a nested
		// checkout under the project root would be collected as a second copy of
		// the suite. Naming `src/` on the command line does not help, because
		// that is a substring filter and the nested checkout's `src/` matches it.
		//
		// Vitest replaces this list rather than merging, so its own defaults are
		// repeated here. Dropping one silently starts collecting build output.
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/cypress/**',
			'**/.{idea,git,cache,output,temp}/**',
			'**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
			'**/.worktrees/**',
			'**/.svelte-kit/**',
			'**/build/**',
		],
		// content-form.test.ts pins a timezone per case to assert datetime
		// literals. A worker thread holds a copy of process.env, so assigning TZ
		// there never reaches V8 and every case would silently read the machine's
		// zone. A forked child has the real environment.
		//
		// Forks is Vitest's default pool, but it is named here so the timezone
		// cases never depend on a default.
		pool: 'forks',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			exclude: [
				// SvelteKit page shells. Rendered markup, not testable logic.
				'src/routes/**/+*.svelte',
				// Build output and tooling.
				'.svelte-kit/**',
				'build/**',
			],
		},
	},
	server: {
		allowedHosts,
		proxy: {
			// Admin server: schema, user mgmt, auth (port 3001)
			'/api/admin': {
				target: process.env.PROXY_ADMIN_TARGET || 'http://localhost:3001',
				changeOrigin: true,
			},
			// Content API server (port 3002)
			'/api/v1': {
				target: process.env.PROXY_API_TARGET || 'http://localhost:3002',
				changeOrigin: true,
			},
			// A flow's own URL: every other path under /api is the content
			// server's, as the proxy in front of a deployment routes it.
			'/api': {
				target: process.env.PROXY_API_TARGET || 'http://localhost:3002',
				changeOrigin: true,
			},
		},
	},
});
