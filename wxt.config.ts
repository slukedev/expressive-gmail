import { defineConfig } from "wxt";

// Firefox add-on id. It also fixes the OAuth redirect hash in docs/gmail-api-setup.md,
// and it can never change once the add-on is published on Firefox Add-ons.
const geckoId = "expressive-gmail@sluke.dev";

// One codebase, three browsers. Always build MV3 (`--mv3`): WXT would otherwise
// fall back to MV2 for Firefox and Safari.
export default defineConfig({
	hooks: {
		// Safari's webRequest needs a (non-persistent) background page, not a service worker.
		"build:manifestGenerated": (wxt, manifest) => {
			if (wxt.config.browser === "safari")
				manifest.background = {
					scripts: ["background.js"],
					persistent: false,
				} as never;
		},
	},
	srcDir: "src",
	outDir: ".output",
	// Firefox's source zip is for AMO reviewers rebuilding the add-on: keep it to what the build needs.
	// Dotfiles (.env*, .github, .impeccable) are already left out by WXT.
	zip: {
		excludeSources: [
			"playwright-report/**",
			"test-results/**",
			"safari/**",
			"safari-ios/**",
			"docs/screenshots/**",
			"store/**",
			"tests/**",
			"after/**",
			"safari-app/**",
			"packaging/**",
			"**/*.zip",
			"**/*.log",
		],
	},
	modules: ["@wxt-dev/module-react"],
	manifest: ({ browser }) => ({
		name: "Expressive Gmail",
		short_name: "Expressive Gmail",
		description:
			"Gmail rebuilt in Material 3 Expressive, with some extra features.",
		// No 'tabs': host permissions already let tabs.query match mail.google.com, and 'tabs' would add
		// a "Read your browsing history" install warning. Safari keeps it for its URL filter.
		permissions: [
			"storage",
			"alarms",
			// Phones ask mail.google.com for desktop Gmail (src/shared/mobile.ts). Uses the host
			// permissions below, so it adds no install warning.
			"declarativeNetRequestWithHostAccess",
			...(browser === "safari"
				? ["tabs", "scripting", "webRequest"]
				: ["identity", "notifications"]),
		],
		host_permissions: [
			"https://mail.google.com/*",
			// Google's signed-in account list (names and photos for the account switcher).
			"https://accounts.google.com/*",
			// Account photos that only load signed in (lh3.google.com/u/N/...).
			"https://lh3.google.com/*",
			"https://gmail.googleapis.com/*",
			"https://people.googleapis.com/*",
			"https://*.googleusercontent.com/*",
			// Brands' verified logo records (BIMI), from Google's DNS resolver.
			"https://dns.google/*",
			// Google's favicon service, for brand logos in avatars.
			"https://*.gstatic.com/*",
		],
		web_accessible_resources: [
			{
				// Safari injects its main-world script as a page script (no main-world content scripts there).
				resources: [
					"app.html",
					"theme-boot.js",
					"assets/*",
					"chunks/*",
					"fonts/*",
					// The installed app's icons, read into its manifest (src/shared/pwa-host.ts).
					"icon/*",
					...(browser === "safari"
						? ["content-scripts/*", "gmail-main-safari.js"]
						: []),
				],
				matches: ["https://mail.google.com/*"],
			},
		],
		action: { default_title: "Expressive Gmail" },
		...(browser === "chrome" ? { minimum_chrome_version: "120" } : {}),
		...(browser === "firefox"
			? {
					browser_specific_settings: {
						gecko: {
							id: geckoId,
							strict_min_version: "128.0",
							data_collection_permissions: { required: ["none"] },
						},
						// Firefox for Android: main-world content scripts arrived in 128 there too.
						gecko_android: { strict_min_version: "128.0" },
					},
				}
			: {}),
	}),
});
