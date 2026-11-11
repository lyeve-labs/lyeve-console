# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are listed newest first.

## [Unreleased]

### Added

- The forms card on the Builder settings page can be opened directly at `#forms`, so a builder can link a person straight to Set up form submissions.

## [0.28.0] - 2026-11-11

### Added

- The Goroutine engine tab shows a super admin how the engine uses its CPU, memory and database: the CPU threads, the soft memory limit, the GC target and the database pool, each with where its value came from. Where tuning is enabled, the values can be changed, started from a one-server or several-replica preset, and checked against recommendations for the machine and the database. On an engine that does not serve these settings, the panel says they are not included in this build.
- Each field in the schema builder takes help text and a No AI mark. The entry form shows a field's help text under it, and the assistant never reads or fills a field marked No AI or private. A relation picker shows you each entry's name, and the assistant reads a name only from a field the related content type leaves unmarked, or a short id.
- An assistant panel opens from the header on every console page, for every signed-in role. It reads the page and the open form, offers values for the form as suggestions you accept or reject, and shows any other change in full, which runs only when you run it, with your own session.
- The AI settings page has the tenant's switch for the assistant, on by default.

### Changed

- The Goroutine engine tab says tuning changes reach every replica and stay after a restart, as they do on an engine that serves the runtime settings.
- A saved content type in the schema builder opens on tabs named Definition, API and History, with History for a super admin only. Its routes and its history sat in disclosures under the whole field list. A new content type has only its definition and shows no tabs. The History tab counts the changes waiting in its queue, and the history is read only while that tab is shown.
- The API key drawers lay out the hourly, daily and monthly request limits as one captioned row once the drawer is wide enough, and stack them below that, under a hint that says 0 means no limit and that a key over a limit gets a 429 with a Retry-After header until its hour, day or month ends in UTC.
- The console moves to ui-kit 0.58.0. Every button variant is one height at each size, and a medium button lines up with a text field. A list or calendar opened from a field stays inside the visible area and inside a panel's scrollbar, a segmented control in a narrow panel stacks its options instead of breaking a label across lines, and a number field's stepper at its bound keeps its frame. Focus rings and a focused field's border draw in the deeper brand color, the row the keyboard is on in a menu fills like a hovered row, the lists and calendars opened from a field draw a softer border, and scroll bars take the theme's colors. Secondary and outline buttons and select fields draw the same soft border as cards, and a select's border firms under the pointer.
- The focus rings the console draws itself, on the dashboard and settings tiles, the flow editor, the media library and the rich text field, use the kit's focus color, so they match the kit's controls and follow a tenant's accent color. The flow editor's problems list draws the same soft border as the kit's menus.
- The searches on the flows, flow variables, media, logs, content types and audit log lists, and the subject filter on AI transcripts, run as you type once you pause, and Enter still searches at once. The field keeps focus while the list changes, and its own clear button shows every row again. The Search buttons and the Clear links beside the field are gone. Where a list has filters beside the search, each one applies as you change it, and a list that matches nothing offers Clear filters.
- Searching the content types list narrows it and no longer opens a content type whose name the search matches. The content type picker on an entry list still opens one by name.
- The console moves to ui-kit 0.59.0, then 0.60.0 and 0.60.1. Every text field, select, date and time field, number field and search box rests on the same soft border as a card, firms under the pointer and turns to the focus color when focused, and a field focused through a part inside it keeps its focus border under the pointer. The chosen option of a segmented control is a brand-tinted fill with brand text, on a soft track. The rich text field and the code editor's line numbers follow the same borders. An empty checkbox, radio or toggle rests on a softer border that firms under the pointer, and a selected option card keeps its tint without a brand border. A focused field shows focus by its border alone in the focus color, with no second line inside it, and the rich text field and the code editor do the same. A field in error keeps its red border and marks focus with a red line inside it.
- The flow canvas and the schema canvas draw a keyboard focus ring around a node, a table and the canvas itself in the same focus color as the rest of the console, in place of the brighter brand color. The zoom controls, the minimap, a selected connection's delete control and the schema canvas toolbar rest on the softer border that cards use.

### Fixed

- The schema builder no longer scrolls the whole page, which slid its toolbar under the top bar. The labels kept for screen readers stay inside the editor's own scrolling area.
- The schema builder's field rows split by the width of the editor rather than the window, so a row in a narrow editor beside an open list no longer breaks apart.
- The flow editor's inspector keeps its header readable at every width. The side effects badge moved beside the node type, so the node's name no longer wraps word by word at the inspector's narrowest and the header stays inside its box.
- The flow editor offers only the fields the Fill fields with AI step can fill, so a flow no longer saves with a field the step refuses when it runs. A field an existing flow lists that the step cannot fill is marked as a problem, with a sentence that says why.

## [0.27.0] - 2026-11-11

### Added

- The schema builder offers integer and decimal field types. A decimal asks for its precision and scale within the bounds a decimal allows, and the save lists a change to either before it runs.
- Integer and decimal values are edited as text, so every digit shows and saves as typed and a decimal keeps its trailing zeros. A whole number past about nine quadrillion was rounded on every page and written back rounded. The entry editor, its history and the content list now keep every digit.

### Changed

- Crowded pages are split into tabs, one feature per tab with an address of its own: customization, request capture, reviews, search, rate limits, the profiler, the cache, tenant costs, PII masking, telemetry, API labs, GraphQL, imports and the goroutine engine and log tail. The sidebar marks the page while any of its tabs is open.
- The console moves to ui-kit 0.53.0. A failed copy says what to do next, and the buttons that step a number up or down name the field they change.
- One concept has one name on every screen. What a tenant defines with fields is a content type, a control that opens a choice says Choose, the settings groups once called Workspace and Instance are Tenant and Engine, and the server the console works against is the engine.
- A read that fails says what could not be loaded and offers Try again, such as "Could not load webhooks." An outage reads "The engine is unavailable, so this page did not load. You're still signed in, and nothing was changed."
- The console's sentences talk to the reader, with one wording for each situation. A delete confirms with what went, such as "clip.webm deleted.", and a refusal names the roles it admits.
- A message from the engine reaches the reader only when it is a refusal with an error code. A failure from a proxy in front of the engine, or any server error, gets the console's own sentence.
- The rich text editor asks for a link address in the console's own dialog instead of the browser's prompt. An empty address still removes the link.
- The Trusted devices page calls what it trusts a device on every line and puts Trust this device on the row of the device name field. Its hint says each browser counts as its own device. The Sign-in page sizes its days field for a number.

### Fixed

- A delete or any other write that asks first now asks when it is posted before the page has loaded or with scripts turned off. It ran at once with no question. The question shows above the page, with a button that sends the form again once you agree.
- The console explains both wordings of the engine's renamed refusals: a flow that uses a node type the engine does not have, and a license key exchange that is not set up. It recognized only the wording of engines released before the rename.
- A reader locked out of sign-in with no authenticator app, or where password reset or magic link sign-in is off, is told to ask a super admin. Only a super admin can restore their access.
- Removing a key and value row from a JSON field no longer moves the values typed in the rows below it.
- A measured time picks its unit after rounding, so 999.6 ms reads 1.00 s instead of 1000 ms.
- Pages the sidebar does not list, such as two-factor authentication, trusted devices and account settings, showed only Settings in the top bar. The top bar now names each by its own title under the section that holds it, and a tenant page missing from its menu reads Pages instead of the product name.
- The settings entry for trusted devices said a trusted browser skips the second sign-in step, which never happens. It now says trusting a device lowers its sign-in risk score.

## [0.26.0] - 2026-11-09

### Added

- The schema builder can mark a content type for public delivery, under Table settings, and mark any field but a system field private. A content type without draft and publish shows a warning when it is marked, because every entry of it is published and so served. A relation to a content type that is not public says it is left out of public delivery.
- The password reset page and the set-password drawer offer to remove the account's passkeys, checked by default, so a passkey added from a stolen session stops signing in. When any were removed, the confirmation says how many.
- Turning on two-factor authentication on a sign-in that is not recent asks for your password when the engine requires it, says when the password did not match, and offers to sign in again when the engine requires a fresh sign-in.

### Changed

- The console reads the key it signs engine requests with from `LYEVE_CONSOLE_KEY`, the same value as `LYEVE_CONSOLE_KEY` on the engine. `ADMIN_CONSOLE_KEY` still works for one more minor release and is read when the new name is unset or empty. Engine releases before the next minor read only `ADMIN_CONSOLE_KEY`, so keep that name on the engine until it moves.
- The console moves to ui-kit 0.52.0, which takes in the changes of 0.47.0 to 0.51.2 as well.
- Focus is drawn as the 2px brand outline with no glow.
- The primary button keeps one small shadow in every state.
- A hovered table row takes a neutral fill, so it no longer reads as a second head row.
- A nested sidebar row is drawn like a top-level row.
- The dark theme's surfaces, borders and hover fill are darker and a little bluer, so a card no longer reads violet, and a dark card carries no white wash.
- The sign-in pages sit on the same ink and faint cyan and violet light as the rest of the console.
- The account menu lists its entries as rows drawn like the sidebar's, and Sign out is a plain row under a divider instead of a red button.

### Fixed

- The account menu names your roles as people read them, such as super admin, instead of by their stored ids, such as `super_admin`.
- A page change replaces the page in one frame. A page left while it showed an alert or a banner stayed on screen above the new page until its exit ended.
- The sidebar opens the group of the page you move to, and shuts the group you left, in one frame. It slid them open and shut, so the rows under the pointer moved.
- The setup page refuses a return path that holds a control character or a space. A path made of a slash, a tab and a second slash read as an address on another site once the browser dropped the tab, so finishing setup could leave the console for that site.
- The console refuses to start when `ORIGIN` is https and `ADDRESS_HEADER` is unset. Behind such a proxy every visitor shared the proxy's address, so a few failed sign-ins from one visitor blocked sign-in, password reset, email links and setup for everyone.
- The console answers 413 to a request body over 1 MiB before any form action reads it. Before, anyone could make it parse up to 10 MiB per request without signing in. Configuration sync, the schema and flow imports, preset and template saves, and flow datasources and variables still take the larger bodies they need once the engine has confirmed the session.

### Upgrade notes

- A console served over https behind a proxy needs `ADDRESS_HEADER`, usually `x-forwarded-for`, and `XFF_DEPTH` set to the number of proxies, or it refuses to start.

## [0.25.0] - 2026-11-05

### Changed

- The app calls itself LyEve Console in its tab titles and wherever the product name shows. A tenant that set its own name keeps it. The retention note on the AI settings page and the security policy say the console where they said the admin console.
- The image is published as `ghcr.io/lyeve-labs/lyeve-console`, and the package is renamed `@lyeve/console`. Each 0.25 release is also copied, with the same tags and the same digest, to `ghcr.io/lyeve-labs/lyeve-admin`, so a compose file that names the old image keeps updating. A release candidate gets only its exact tag under both names.
- The console moves to ui-kit 0.46.0, which adds depth in the same colors. Cards, panels, stat tiles and tables sit on a soft shadow with a lit top edge and rounder corners, menus and dialogs float on deeper shadows, the main action carries a gradient and a resting glow, and every focus ring glows. A faint cyan and violet wash lights the top of each page. Nothing changes size, and forced colors and print drop every shadow, glow and gradient.
- The settings index, the dashboard's widget picker and the list rows in schema import and history, API key access, admin token grants, review stages, the locale fallback chain and the AI data note draw their boxes with the kit's card and panel, so they carry the same depth. The dashboard's linked tiles and the settings index draw their hover and focus rings on the card's corners, and the problems menu floats on the menu shadow.

### Upgrade notes

- Pull `ghcr.io/lyeve-labs/lyeve-console`. The old name receives every 0.25 release and stops at 0.26.0, and its published tags stay.

## [0.24.0] - 2026-11-04

### Changed

- The sign-in, password reset and email link pages ask for an organization only when the console runs with `SIGN_IN_ORGANIZATION` set to true, and the field is off by default. Before, they asked every visitor, although only a console that serves more than one organization on an address that names none needs it. While the field is off, the console neither fills it in from a link nor sends an organization it did not ask for.
- The New provider form for OAuth sign-in opens with Enabled off, as every other way of adding a provider creates it disabled. Before, saving the form as it opened put the provider on the sign-in page before anyone had tried its client id and secret. Editing a provider still shows its own setting.
- The console's failures, empty states, confirmations, hints and page descriptions are written to the reader in plain words, with one wording for each situation. Limits, defaults, warnings and what was or was not saved are kept, and a few notices that blamed the license or the build for a plugin that is only stopped now name the real cause.
- Sixteen field labels, buttons and section headings name the field or the action in plain words, such as "Publish at" where the label read "Goes out at", "Rehearse without publishing" where it read "Rehearse first, posting nothing" and "Endpoints" where it read "Where it answers". A script or a guide that finds these controls by their text needs the new names.
- The console moves to ui-kit 0.45.0. A tab strip is one stop in the tab order: Left and Right move between tabs, Home and End go to the ends, and Enter, Space or a click chooses one. Between the medium and large widths the sidebar rail opens only once the pointer rests on it, so a pointer crossing it no longer covers the control beside it. The scroll fade on tables and tab strips shows in the dark theme, a pager step with nowhere to go is a disabled button, the account menu has an accessible name on a phone, and a table row's hover ring fades in with its tint.

### Fixed

- After a sign-in by emailed link, OAuth or SAML, every change saves again. The engine opened such a session without the cookie that guards writes, so the console could read everything and every change was refused. The console now gives any signed-in browser that lacks that cookie one, which also repairs a session that is already open, and signing out clears it.
- Saving a new content type in the schema builder under a name that already exists no longer replaces that type. The builder sends a new type as a create only and says a content type of that name exists. Before, the fields the new type left out were queued for removal with their data.
- The schema builder refuses to save over a content type that changed since it was opened, such as one that had drafts turned on through the API, and offers to reload it. Before, the save wrote the older definition back and queued the status column for removal with every entry's status. Both schema builder fixes need the schema plugin release that reports versions. Against an engine that does not report them, saves behave as before.
- The entry editor fills its form from the entry's title and fields only, so a field shows and saves its own value. Before, a meta key that shared a name with a field showed the meta value in that field, and saving the entry wrote that value into the field.
- When the API refuses a save because of one key inside a JSON field, the content editor shows the message under that key's value, marks it invalid and moves focus there. Before, it printed the message under the field and marked nothing. When no row holds the named key, the message stays under the field and the field's first input points at it.
- Run now on a synthetic monitor waits a little past the longest the engine answers a request, and when no answer arrives it says the run goes on and its results appear in the list when it ends. Before, it gave up after 15 seconds and reported a failure for a run that was still going. A run refused because another run of the same probe is going is described in the console's own words.
- A failed migration apply is read out once in Firefox. The header's migration button always counts the pending migrations, and the message below it alone says what failed. Before, a screen reader heard the failure twice when focus returned to the button.
- The first-run setup page points to the line of the engine's startup output that holds the setup token, which works with engines before and after 0.58.0. Before, it pointed to a log line that newer engines no longer use for the token.

### Upgrade notes

- A console that serves several organizations on an address that names none needs `SIGN_IN_ORGANIZATION=true` after upgrading, or its sign-in pages stop asking for the organization.

## [0.23.0] - 2026-11-01

### Added

- A Privacy page under Settings, open to a tenant admin and a super admin, holds the tenant's privacy settings. It sets what an erasure does with the tenant's form submissions: decide for each submission, always clear the person's values, or always delete the submission. It also sets which sections a person may include in an export of their own data, and whether every role may export or only the roles ticked. Admins and super admins may always export.
- The Privacy requests page, which only a super admin opens, chooses what a person proves before exporting their own data: the password, a code from an authenticator app, a code sent by email, any of them or none. Every ticked step is required.
- These settings need the schema and analytics plugin releases that serve them. While a plugin serving a setting is stopped, the page says why, and a read that fails is drawn as a failure with a retry.
- The header's pending migration chip opens a dialog that lists each queued statement with its schema and marks every drop or clear as destroying data. Nothing runs until the reader confirms. Before, one click applied every queued statement, every tenant's queued column drops on shared tables included. If the queue changes after the dialog opens, the apply is refused and the dialog shows the new queue.

### Changed

- A new API key, a new user and a new tenant member start with the viewer role, and a user saved with no role ticked gets viewer. Before, each started as an editor. A key whose scopes name a content write without a writing role is refused on its Roles field, because the engine refuses that write whatever the scopes say.
- A new API key starts with schema discovery off. Before, every key made in the console could list the content types and their fields, because the box started ticked in a folded section.
- A real event replay asks first, naming the window and the run name. A rehearsal still runs straight away, and the form keeps its values, so a rehearsal and the run after it carry the same name.
- The sign-in page reads the engine's list of sign-in routes once to decide which recovery links and single sign-on providers to offer. Before, it sent each route a request the engine refused, and each refusal raised the failure rate on the dashboard. An engine without the list is asked the old way.
- The configuration page notes that a saved value for a setting the engine reads while starting applies at the next restart, and confirms the save with that sentence.
- Every icon, the browser tab included, is the same rounded tile, so the mark stays visible on a light tab under a dark system theme. The install manifest describes the app with the brand descriptor.
- The sidebar loads the code of each page it links to once the link is on screen, so a first visit to a page waits for its data alone.
- The flow page and the schema builder draw their editors in the browser only. Both load and draw as before.
- The console refuses to install on Node below 26.

### Fixed

- Behind a proxy that sends every `/api/` path to the engine, the audit log exports and the profiler's pprof exports download again. Their forms post to console paths now, where the engine used to answer 415.
- The SMTP provider form starts with its TLS switch off and labels it Implicit TLS, with a hint that names port 465 and says the connection upgrades with STARTTLS when it is off. Before, a provider saved with the defaults opened a TLS connection to port 587 and failed every send.
- The AI settings tab shows the stored transcript settings and their source. Before, it showed the 720 hour default after a saved change took effect.
- The AI provider form's Priority hint says a higher number is tried first, as the AI feature orders providers.
- The PII masking rule drawer shows its Create and Save buttons again, so New rule, Edit and Duplicate can save.
- The SAML New provider drawer offers the provider templates in a Start from select, and choosing one fills the NameID format, the attribute mapping, the encryption switch and any URL the template names. Choosing None or another template clears the last template's settings.
- The SCIM New connection form links the connection to a SAML provider, so SAML sign-in through that provider uses the connection's attribute mapping. The link is set only when the connection is created.
- A content entry keeps the values of a field named `status`, `system`, `created_by` or `updated_by` on create and on every edit. Before, the form dropped them, and a required field with one of those names could not be saved.
- The Mention picker in content comments offers only accounts of the entry's tenant. Before, a super admin was offered every account on the instance, and picking one from another tenant refused the whole comment.
- A new audit retention policy starts with archival off, as the API stores a policy that does not mention it. Before, the same policy archived when made in the console and deleted outright when made through the API.
- A cost budget covers its last day in full. Before, a budget for a whole month ended a second before that month's cost line and never counted it.
- The tenant delete question says the stored files stay until the storage backend's own lifecycle rules remove them. Before, it said every file went with the tenant.
- An erasure that kept records under an address another account in the tenant also holds shows its own warning, which says the kept records cannot be told apart from that account's data. Before, it read as a failed part and offered a retry that erased nothing.
- The pending migration count in the header updates after a schema save, a delete or an apply, without a page load.
- The schema DDL preview lists each field rename the save runs first. Before, a preview whose only change was a rename said "No DDL changes".
- The schema builder's column headings line up with their columns, and the columns switch to their narrow layout by the width of the field list rather than the window.
- The schema import drawer shows each rename once, from the old name to the new.
- An import refused for its size names the 50 MB file limit the drawer states.
- The import wizard's drop zone names the accepted formats in a short line that stays inside its border.
- An import rollback of one entry is confirmed in the singular.
- The recommendations page says a reader joins a group the first time a request signed in as that reader asks for its group, and that each reader's group is picked at random.
- When the console cannot render an error page of its own, it serves a page in its own words that names the status and offers Try again and the dashboard. Before, the reader got the framework's bare 500 page.
- A saved setting, a saved AI price and a failed migration sync are announced to screen readers.
- Opening an entry that cannot be read no longer leaves an unhandled error on the server.
- Toasts, copy confirmations and saved outcomes are read out by the Orca screen reader in Chrome and Firefox. Before, they carried a status role, which Orca does not speak.
- A screen reader says why the flow editor refused a connection. Before, the reason only showed in a floating panel.
- A screen reader reads out the notices that a password reset link or an email sign-in link was sent, that the password changed, and that every row of an import dry run passes. Before, these stayed on screen without being announced.
- A tab strip placed low on a long page no longer scrolls the page down to it when it appears.
- The public search card on the Search page says what a picked content type exposes: a query matches every field of its published entries, and a snippet can quote any of them. Before, it said a result never carried the stored body.

## [0.22.0] - 2026-10-26

### Added

- Content history settings, under Settings, turn history on for every content type, some of them or none, and set how long versions and the activity log are kept. An entry whose type keeps no history says so where its versions would be listed. A content activity page lists who changed which entry, with the action, where the change came from, the fields it touched and the version it made, narrowed by type, action, source and dates, and a super admin reads every tenant's activity there. These need the engine release that serves them.

### Security

- The console image's runtime is now plain Alpine 3.24 with its packages upgraded, which brings zlib 1.3.2-r1 and the fix for CVE-2026-85091. The image is a single layer, so npm, npx, corepack and yarn are gone from its bytes as well as from the running container, and a scanner that reads each layer no longer reports their advisories. The entrypoint, command, user, port and health check are unchanged.
- The release workflow no longer grants every job a token for keyless signing, which nothing used.
- The console builds and runs on Node 26.12.1, the October 2026 Node.js security release, and its development tools moved past every advisory `pnpm audit` reported. The runtime image adds libatomic, which the Node 26 binary needs.

### Fixed

- Moving to another page no longer flashes the content area or the whole window white for a frame in the dark theme. The new page's content fades in on its own, without the browser's page snapshots, and the sidebar and the header hold still.
- Device sign-in: an account that lost its admin role after the approval page loaded sees that it cannot approve, instead of being asked to check a password that was right. A refused approval that carries no reason says the approval was refused.
- Folding or opening the schema list, the API reference side list or a flow editor panel from its own button keeps keyboard focus on the button that undoes it, so the next Tab no longer starts from the top of the page.
- Schema builder: a system field shows "required" only when it is, so the key of an optional relation no longer reads as required.
- API keys: the page reads the usage of every key it lists in one request instead of one request per key, so a page of 500 keys asks the engine 4 times instead of 503. This needs the usage plugin release that serves the combined read.
- GraphQL settings: the persisted query list pages through every query, 50 at a time, instead of showing the first 200 and saying the rest could not be reached.
- The pool health view gives up on an engine that does not answer within five seconds and says the engine is unreachable.

### Changed

- The console serves a readiness probe at `/readyz`, which answers 200 while the engine answers and 503 while it cannot be reached, with no session and no detail. The image's health check requests it, so a console that cannot reach its engine reads as unhealthy.

## [0.21.0] - 2026-10-20

### Added

- Moving to another page fades the page content while the sidebar and header stay in place, and pages outside the console frame, such as sign-in, fade whole. Changing only a filter or a page of results does not fade, reduced motion turns the fade off, and a browser without view transitions changes pages as before.
- Accounts a tenant's identity provider created carry a "Signs in through your identity provider" marker in the users list. The sign-in, password reset and email link pages take an optional organization, used when the address the console is reached on does not already name one, and a link that carries the organization fills the field in, where the reader can change or clear it. A new Sign-in settings page lets a tenant admin set how many days such an account may sign in without its provider, from 0 to 365, 30 by default. These need the engine release that serves them.

### Changed

- The theme toggle shows its name on hover as well as to a screen reader. The console runs ui-kit 0.40.0, and under reduced motion the kit's own rule ends the page fade instead of a second check in the console.
- The console's docs link and the README point at the documentation's new address, lyeve.com/docs. The old host redirects there.
- A release candidate image is published under its exact tag only, `X.Y.Z-rc.N`, and never as `latest` or the minor line.
- The release jobs that read secrets run in a release environment that admits only version tags. Pull requests no longer run the suite with the visual editors, which needs those secrets and failed on every pull request. The release runs it before it builds.
- The sidebar offers each role only the pages the engine lets it open. Editors, viewers and custom roles see the dashboard, the schema builder, flows, reviews and API access. An admin no longer sees gRPC, which only a super admin can open. An admin finds quotas and usage beside tenant costs, scoped to their own tenant.
- A page that cannot be read says why: the engine or its database did not answer, too many requests reached the engine, the role cannot open it, or the feature is not enabled. Each offers Try again where trying again can help.
- Every choice uses one kind of control: two to four short options are a segmented control, longer filters are chips that wrap, options that each need a sentence are radio buttons with a description, and long lists are searchable. Every delete confirmation names what it deletes. The AI provider kind and the data export format are radio buttons with a sentence for each, the export statuses are checkboxes that stay in sight, and the audit log action filter is searchable. The hints under the email transport and method and under a flow event trigger's kind belong to their control, so a screen reader reads them with it.
- Browser tab titles come from the page frame, and the sign-in frame and the copy controls come from ui-kit. A copy confirmation lasts 1.5 seconds, and the API key and backup codes say how to copy them by hand if copying fails. The page shown for a plugin that is not running has a tab title. Icon-only copy buttons on the API reference and in the schema editor show their tooltip again, and a new API key shows in full across lines instead of on one cut line.
- Under a finger, segmented controls and number steppers take a 44 pixel target, and the collapsed sidebar stacks a group's disclosure under its link, which also stops the rail scrolling sideways under a mouse. Both come with ui-kit 0.37.0. On a touch screen segmented controls, filter chips and page numbers each take a full-size target, and a phone's pager stays on one row, with ui-kit 0.38.2. On a phone, opening a schema folds the schema list to its header. The entry name, the Locales link, a tenant name, each profiler endpoint link and the API reference side list take a full touch target, and the API labs endpoint picker keeps the path readable. Tenant price cards stack until there is room for two, long telemetry metric names wrap, and route paths on the plugin page and the GraphQL endpoints stay on one line in a table that scrolls in its own box. The dashboard window segments, each How to enable it link on the plugins list, the Not enabled marker, the license page links, the quota warning switches and the API reference plugin fold also take a full touch target. The API labs endpoint picker keeps each row's Select button in view at the end of its box, so picking an endpoint on a narrow screen needs no sideways scroll with a finger or a mouse.
- The permission matrix draws each state with its own shape, so a grant, an inherited grant, a refusal and an exempt role read without color and keep their shape in high contrast mode.
- The plugin page colors HTTP methods the way the schema builder and the API reference do. An HTTP status takes one badge color on every page that shows one.
- The UI check refuses a style block in a component, a date or time written with no locale, and a native disclosure or dialog.
- A refusal at a license limit says what happened, then that a license allowing more lifts the limit, and only then that removing one also makes room. When the engine names a page where more can be bought, that link leads the notice, opens in a new tab and is named by what it opens, a plan or an add-on. The admin seat refusal on the users page and on a tenant's members, and the flow limit refusal, read this way.
- Two-factor: adding an authenticator app to an account that already holds a second factor asks for proof of one, a current code or a backup code, or beside a passkey the passkey itself on a click. Replacing an app that is set up asks for a current code from it or an unused backup code, and the page no longer says that starting setup replaces the app at once, because the new key replaces it only once a code from it verifies. A setup begun before the account held a factor is refused at its confirm step and sends the reader back to start again, and a refused code on an account with only a passkey no longer mentions an authenticator app. These need the engine release that requires the proof.
- A page reads the signed-in account once per request instead of running the console frame's whole load again on every move between pages. A visit to the jobs page asks the engine twice instead of seven times, tenants three times instead of eight and the permissions page five times instead of ten. The page shown after a form post still asks the engine again, so a session the post ended goes to sign-in.
- Tenants: the usage page says its API-call and bandwidth figures count only requests made with an API key, so requests from a signed-in session never appear in them.

### Fixed

- Choosing an option in an autocomplete field posts the option's value rather than the label shown in the field. A dismissed notification leaves from where it stood instead of jumping to the corner of the stack. Both come with ui-kit 0.35.2.
- The console names the person's browser to the engine on every call, so sign-in risk, trusted devices and the audit trail see the real browser instead of the console's server.
- Remembered devices show the browser when the engine sends one, instead of reading as unrecognized.
- API keys: the schema catalog switch says it lists only the content types the key may read, so a key with the switch and no content access sees an empty list.
- Reviews: a stage's escalation user, a review's assignees and the Assignments table name accounts by email, and entries by title, instead of raw ids. A caller who may not list the accounts keeps the typed fields. A definition whose stages could not be read says so instead of showing none.
- Releases: Include entry offers the most recently changed entries by title, grouped by collection and searchable, and its button says Include.
- Media: Build URL keeps the Width, Height and Quality fields, and a focal point click is measured against the image rather than its frame. Asking for a description with no AI provider enabled says so, and a spent AI budget and a license without AI each have their own sentence. After a delete, focus moves to the upload control.
- Schema: a previewed column drop is badged as Queued, with a note that it drops data and runs only when a super admin applies it from History. A failed canvas layout read no longer claims the license leaves the canvas out, and an editor is told the role cannot open it.
- Imports: the rejected share names the rows it was counted against. The file picker lists only extensions, which no longer spill past the box on a phone, and the chosen file's size uses the console's byte format.
- Media: a server failure during an upload no longer prints its error text on the page, and a refusal shows the engine's own reason only when the engine sent it. When the engine does not confirm an upload, the page names the file and asks the reader to check the library, instead of saying nothing was uploaded when earlier files of the same pick, or the file itself, may have been stored.
- Imports: a refusal shows the engine's own sentence only when the engine sent it, and the console's sentence otherwise. A start that a proxy failed, or whose answer never came back, says the import was not confirmed and asks the reader to check the entries before trying again, because the import may still be running and a retry would import the rows twice. A preview or a dry run still says nothing was imported.
- Schema: the copy button on each collection API route reads curl, because it copies a curl command, and a screen reader hears which route it copies.
- Search: the example request on the public search card is now the one its copy button copies, shown in the kit's copy field with the method in its label.
- Every page loaded Inter and JetBrains Mono from Google's font service, so each visit sent the reader's address and browser to Google. The fonts now ship inside the console's build and are served from its own origin, the security policy allows no font service, and the fonts' license ships beside the build.
- Recommendations: the intro says what a reader gets, and the feed preview posts the chosen reader's id and shows the generated feed.
- Synthetic monitoring: the New probe hint names the interval floor the plugin answers, and Run now fails when any region failed. Open alerts appear on the page. A probe edit keeps the regions, headers, payload and expected response set through the API, asks for a stored password or token again, and names the masked headers it drops.
- Query monitor: a slow query analysis reads the plugin's answer and says why no plan was read.
- Experiments: the detail page reads variants and metrics again instead of answering 500, the minimum sample size reads as a total across variants, and an emptied description clears on save.
- Usage: a quota request names its requester by email. An admin sees their own tenant's quota, pending requests and usage. Approving or denying a request no longer fails with invalid JSON, a stored byte limit survives a save, storage and bandwidth read in GiB, and the page says when more requests wait than it shows. The quota drawer sets Delete apart from Save.
- GraphQL: schema field names no longer break mid-word.
- Observability: from 768 up to 1280 pixels wide the goroutine engine stats sit two to a row in each card, and the connection pool stats sit four to a row instead of seven, so Leak threshold, Completed, Goroutines and the engine name no longer run past their boxes at 1024 pixels.
- Events: the replay page says a replay reaches every listener and that the field is a run name.
- Permissions: a schema rule reads as replacing the wildcard rule, as the engine applies it, and an empty rule that closes a schema to a role can be saved. A role ceiling refusal prints the numbers it carried.
- Message broker: with no broker set, the page says events are discarded instead of claiming delivery, and it reads the outbox.
- Analytics: the page says both APIs are counted, and each HTTP method bar states its share of all requests.
- SCIM: the pager counts connections, and the token note matches the 32-character minimum. The removal switch shows on and fixed, because the plugin acts on every removal, and its hint says Okta and Microsoft Entra mark a person inactive, which always disables the account. A connection stored with the switch off reads Deleted, and the count of connections by that switch is gone.
- Errors: the alert list reads the plugin's answer, so open alerts and their triage buttons appear. An alert whose code sits past the first page of the catalog is no longer labeled unclassified.
- Logs: a one-word search also finds a request or trace id, and the default level reads as the engine names it. An alert with no cooldown set shows none instead of 10m.
- OAuth: the providers table shows the API path where provider sign-in starts.
- Cache: the URL of the retired metrics route is gone. A tenant admin can flush their tenant's responses, and a tag flush stays with a super admin because it reaches every tenant. A super admin signed in to a tenant is told the flush clears only that tenant. The flush button, confirmation and toast say what the flush removes, a provider that cannot list its entries says so, and New rule waits at the rules ceiling.
- An outage of the engine's database no longer signs everyone out. Only a session the engine has ended sends a reader to sign in again, and a page that cannot be read during an outage says so and offers Try again. A missing admin seat, an address rule or a request limit each say what they are. A signed-in reader whose engine is away sees the outage page instead of the setup screen, and a form posted then keeps its edits. The device approval page reads a busy engine as busy.
- A second factor reads as an invalid code only when the engine refused the code. Setup says when the engine did not answer. An expired or spent challenge says the sign-in expired and returns to the first step. An account with no authenticator app is told to ask an administrator instead of signing in again in a loop, and a locked account leaves the code step. The two-factor settings say a passkey keeps two-factor on and offer to set up an app, and they say that starting setup replaces an app already set up.
- A list, dashboard or panel whose read failed no longer shows its first-run state, or zeros with a create button. It says the read failed. A detail page says Not found only for a record that is missing. A failed read inside a page, such as the security report, the permission rules, captures, cache providers, import templates, idempotency counters or a release's conflicts, says whether the role, the license or the engine stopped it. A flow whose versions could not be read says so, and Publish no longer turns primary as if the draft differed.
- Values the console could not read are no longer shown as real: the search ranking, cost prices, the two-factor status, and a table's row count in the schema confirmations. The license page no longer says the instance runs unlicensed when the license could not be read, and the PII page, the plugin status and the schema list count say a value is unknown. The AI retention card shows values only after the instance settings were read, and a failed provisioning read no longer says provisioning is not enabled. Realtime activity counters say they cover the whole instance, and the idle socket count is gone. A flow run whose values are withheld from the reader says so instead of showing null, and offers no copy of them. The connection pool card reads the health the engine sends.
- GDPR: an erasure that partly failed reads as incomplete, and one stopped by a legal hold names the holds and says how to release them.
- A form drawer shows its failure inside the drawer, and a page with several forms shows each failure only on the form that sent it. This holds on the users, API keys, storage, jobs, reviews, releases, search and webhook pages, and a refused media delete shows in that file's drawer.
- A new entry of a localized schema opens without the localization plugin, and its locale picker is labeled. The first save of a translation sends the source title when none was given, the panel says what an empty title saves, and fields left empty keep the source value. A locale past the free ceiling says how many are in use and how many the instance allows.
- Pages offer no control the reader's role or license cannot use. Webhook, retention, storage, SAML, SCIM and rate-limit writes are offered to super admins only, and unlicensed telemetry, captures, flow datasources and tenant rate limits are disabled with the reason. Without the paid email capability, New trigger and Edit are disabled with the reason. Incoming webhook create and edit, webhook replay, dismissal and retry, and paid quota fields are held with the reason once the license refuses them. The plugin Settings button and a migration apply are offered to super admins only, an editor or viewer who opens content is told the role cannot, and the sign-in page leaves out password reset and the email link when their plugin does not run.
- Retention enforcement reports the entries it deleted. A healthy storage provider passes its test. Email triggers show a license refusal and require an admin. The flow assistant shows its cost, and a busy export says to try again. Retention enforcement also reports a policy whose archive failed. A license key exchange failure says whether trying again can help, and a renewal that got no answer says to reload.
- Unsaved edits survive turning a members page, saving another part of the customization, restoring a prompt version, and refreshing the telemetry page.
- A save no longer resets what its form does not show. Captcha and storage keep the failure threshold and cost weight, search weights keep the boost rules, a rate limit rule clears its role and moves only to a named tenant, a cleared job payload is sent as an empty object, and a PII rule keeps a priority of 0. An Azure storage provider's form shows its endpoint, so a save keeps it. An analytics destination and a flow datasource say how a save replaces stored settings or secret headers.
- The flow editor's runs page turns without asking to discard the draft, and the live log tail stays open when the page refreshes. Renaming a flow to a taken slug or publishing a taken HTTP path marks the canvas and says which conflict it is, a node this instance does not enable is marked in a test run, and a refused datasource name shows at its field.
- Synthetic probes and flow variables page through every row, and the content list filters by status. Budgets past 100, retention policies and holds, the dead letter queue, incoming webhooks, an entry's revisions and the error code catalog are read past their first page. Any older revision opens by its number, a search shows the total that matched and pages by 200, and the accounts list and the token request log land on a page that holds rows. Residency, GraphQL persisted queries, synonyms, the webhook delivery history and the data export tiles say when they show only part.
- Webhooks: a test, a delivery retry, and a dead letter replay or dismiss show their result instead of stopping the page's updates, and the delivery history shows the webhook that was asked for. A rotated secret shows once in a copyable panel, a dead letter replay reports the status the receiver answered, and a permanent dead letter delete asks first by name.
- Tenants: editing a super admin's home membership keeps the super admin role, and a grant for an account the lookup did not find is refused. An emptied plan saves as free, the slug hint states the 63-character rule with a valid example, and a refused slug shows at its field. A tenant's page says when its accounts could not be read.
- Passwords: every form that sets one refuses a password over 72 bytes before sending it, so a reset link is not spent on it. The engine's minimum applies rather than a fixed 12 characters.
- SAML: clearing a provider's logout URL clears it, an edit that empties the entity ID or sign-on URL is refused, and a new provider shows its signing switches on as the plugin sets them.
- AI: a spent monthly budget no longer reads as a missing license, so the flow assistant keeps its prompt. A role refusal names the lowest role that may act, and a save the engine refuses whole names what it refused.
- Content: a value the schema refuses is marked at its field, and a many to many link that did not save is named instead of the save reading as a success.
- Request captures: a super admin's list says it covers every tenant and names each row's tenant. A capture from another tenant cannot join a replay set, and its checkbox says why.
- Audit log: an export sends the filter in force and states its ceiling, a reversed date range is swapped, a refused prune shows its reason, and the action filter offers every action in the window. Data export hints state the row ceiling.
- Residency: a region asked for closed is created and then closed, and the edit form says stored coordinates cannot be cleared.
- Headings step down one level at a time under the page title on every page, empty states included. Search boxes carry labels a screen reader announces, and the button that inserts a table name says that name. After a rule is removed, focus moves to the rules filter, and picking a schema on a narrow screen moves focus to the button that shows the list again. Schema statement SQL, the API reference try it block, the error page's detail and the JSON field preview use the kit's disclosure. A notice that states a standing fact, such as this browser being trusted or the config bundle holding secrets, stays in place.
- A session no longer ends when its access token expires, because the console renews it before expiry. A session the engine ended sends the reader to sign in with a way back to the page they were on, and after a form post that way back names the page alone. Renewals never count against an address's limit, so readers on a busy shared network stay signed in. Sign-out revokes the session's refresh token, and sign-in no longer fails with a server error behind a proxy that hides the browser's address.
- A console started without the internal engine address renews a session instead of hanging every page once the session is two minutes from expiry.
- Rate limits: the page stays up when two live counters differ only by tenant, and each live counter says which tenant it counts, or that it counts the whole instance or requests with no tenant.
- On a phone the GraphQL endpoint notes keep a readable width and the table scrolls in its box, and below 1280 pixels the GraphQL schema tables stack instead of sitting three across with a description column a few letters wide. A review stage stays on one line in the definitions table, and an AI price's update time stays on one line. On a phone the stage name in the New review definition form keeps a readable width beside its number and its placeholder shows whole, with the stage buttons on the line below.
- Under a finger the flow name, the only way to open a flow, takes a full touch target, as do the content sort headers and every switch in the SAML provider form, new or edited.
- Under a finger the hour and minute of a time picker, such as the one in the event replay form, each take a full-size target, and a tap anywhere in the picker lands on a field. This comes with ui-kit 0.38.3.
- Search: result snippets show their matches highlighted and the rest as plain text, instead of printing the highlight tags and escaped characters. Only the standard character names are decoded, so an unknown one stays as written.
- Tenants: where the license does not include creating tenants, the page says so and offers the link the engine names, instead of a card with no way forward. A create refused at the tenant ceiling reads as a limit reached and shows its link. A not-enabled card names its link by what it opens, a plan or an add-on.
- Flows: removing a datasource header no longer posts its secret under the header below it, and turning a header's Secret switch on or off keeps the value already typed. On an edit, the form says that turning Secret on for a header replaces the stored secrets, as typing one does.
- Flows: the link beside a refused datasource write is named by what it opens, a plan or an add-on, and a link outside the console opens in a new tab.
- Under a finger the release name, the experiment name and the media filename, each the only way to open its row, take a full touch target.
- SAML: under a finger the Metadata and Test sign-in links of a provider row each take a full touch target, and the two no longer overlap.
- Dashboard: when the page the tenant chose to lead the dashboard cannot be read, the dashboard says so where that page would be, with Try again where trying again can help, instead of leaving it out. Only an admin is told the page was not found, because the plugin answers the same for a page hidden from the reader's role.
- A license refusal in a drawer or on a page that has its own Create or Save no longer adds a second primary button. Its link stays first as a secondary button, and stays primary only where it is the one action left, as on the permissions page at the role ceiling.
- Tenants: when the instance does not serve tenant provisioning, the page says so instead of saying the license does not include creating tenants.
- Dashboard: when the tenant's own dashboard cannot be read, the standard one says it stands in for it, with Try again.
- Flows: when the flow editor could not read the datasources or variables, the node form's hint says the datasources could not be read, and the inspector says so with Try again, instead of saying none exist. When the read was refused or is not enabled, the inspector leaves that row out instead of saying none.
- Flows: a failed test run says the engine did not answer, or that the run failed, instead of printing a proxy's error page or the browser's own words.
- On a phone the navigation drawer closes once a link in it opens its page.
- Under a finger the actions of a new API key, the modalities of an AI provider, the upgrade links in the flow and datasource drawers, the links on a release, Open flows on the message broker page, Clear selection in the profiler, Forgot password and the privacy export's Download JSON each take a full touch target. A release's conflict rows are spaced so their Open the other release links no longer overlap.
- Flows, imports and media: when the engine refuses a test run, an import step or an upload because the session token lapsed, the console renews the session and sends the request again, so the draft, the chosen file and the mapping stay in place. A session that really ended says to sign in again from another tab and keeps the work on the page. An import request that never reached the engine says so in the console's words.
- The API reference and the API labs say a request did not reach the engine without printing the runtime's error, which could name an internal address.
- AI: a 503 page from a proxy in front of the engine reads as the engine not answering, never as a missing provider or as the assistant's own sentence. Only the plugin's own answer that no provider is enabled reads as a missing provider, so a database failure behind the engine, or a provider that did not list its models, says the page or action failed.
- Tenants: where creating is not served or not licensed and no tenant is listed, the page no longer speaks of tenants below or asks for a create it does not offer, and a refused provisioning read keeps the link it names.
- Content: Add to release no longer offers a release whose items could not be read, which may already hold the entry.
- Jobs: a link that names a job the page cannot open says the job was not found, or that it could not be read, with Try again.
- A link to where a feature is turned on is no longer named with the license page's own label when it opens another page.
- The notes under the telemetry header choice and a JSON field's edit choice are read with their control by a screen reader, and the setup page shows each restart command in a copy field.
- Under a finger, each option of an open select, multiple select or autocomplete list, each day of a date picker, each choice in a checkbox or radio group, the close button of a dialog and the clear button of an autocomplete take a full touch target, and the date picker fits a 320 pixel screen. Under the keyboard, number fields, multiple selects, file drops and the search box of an open list show the focus ring. The active tab's count and the sidebar badges read at 4.5:1 or better in both themes, the phone navigation drawer slides out as it slides in, and a dismissed banner fades away. These come with ui-kit 0.38.4.
- Under a finger, the remove cross on each chip of a multiple select and on a removable tag keeps its touch target off its neighbors, so a tap meant for the field or the next chip no longer removes a value. A multiple select is read in the order Tab reaches it, the field first, and a list or a date picker wider than the room it opens in shrinks to fit. These come with ui-kit 0.38.5.
- Localization: under a finger, the default locale's tag sits level with the removable tags beside it.
- The browser's toolbar color follows each switch of the theme control. It used to keep the color the page loaded with until the next load.
- Content: a list column that links to another entry shows the linked entry's title for an entry saved in the console, and for one the console took in from a row written through the API, instead of an empty cell.
- A screen reader names every row of a JSON field's key and value editor. Every row used to share one Key id and one Value id, so only the first row's fields had a name. This comes with ui-kit 0.39.0.
- A list or calendar opened in a dialog too short for it opens whole below its field, and the dialog grows or scrolls to show it. Under a finger, a tap just inside a number no longer steps it, the Show and Copy buttons beside a secret no longer overlap, and a multi-select's remove crosses stay inside the field. The show, hide and copy icons in password and copy fields are 14 pixels, matching their text, and the sidebar toggle is 20 pixels. These come with ui-kit 0.39.0.
- The sign-in and email link pages take a whole 16-character backup code as the second factor, where the field stopped at 10. Every field that takes a backup code keeps the full keyboard on a phone instead of a number pad, because a backup code holds letters.
- Device approval: every refusal of the approval's confirmation, such as for an account whose only second factor is a passkey, shows on the form in the engine's own words and leaves the request open. Only a refusal that named a password or a code did before, and any other read as a missing role to an admin who holds it.
- Password reset: when the engine's password policy refuses the new password, the form stays and shows the engine's sentence, and the link still works. The refusal used to read as a spent or expired link.
- Residency: when a new region could not be closed after it was created, the notice says the region still takes new tenants.

### Security

- The console image runs on Node 24.22 with OpenSSL 3.5.8, which carries the fix for CVE-2026-14456. Its runtime no longer carries npm, npx, corepack or yarn, which the server never runs and whose own dependencies brought one critical and ten high advisories into every scan of the image. A command that ran one of them inside the container, such as through `docker exec`, now fails with "not found".

### Upgrade notes

- This console needs lyeve-core 0.55.0 or later, so upgrade the engine first. Some of its pages call routes that earlier engines do not serve.
- Run one console replica, or give the proxy cookie affinity when you run several, because two requests that renew one session on different replicas at the same moment can end that session.

## [0.20.1] - 2026-10-10

### Fixed

- The setup page's step indicator marks the current step. Creating the first administrator showed Restart as current.
- Setup says which password rule the engine refused, such as "Password must be at least 12 characters.", instead of "Setup failed.". The setup placeholder and the users page hint say 12 characters, the engine's default.
- The entry list shows a linked entry by its title, such as an author's name, instead of the start of its id.

## [0.20.0] - 2026-10-10

### Changed

- Observability: the goroutine engine's tuning forms are disabled, with the
  reason, when the install's license does not include tuning. The readings
  stay available. A tuning change that the server refuses for the license is
  shown as a license refusal rather than a failure.

## [0.19.0] - 2026-10-07

### Added

- Settings > Email > Templates: list, create, edit, preview and delete the
  tenant's email templates. A new template starts blank or from a
  ready-made one. The page shows how many templates the instance holds
  against its limit, marks the templates a sign-in mail is sent from as
  required, offers no delete for them, and names the link variable their
  body has to keep. A preview renders the mail with sample values in a
  sandboxed frame.
- Alerts: shared alert channels (email, Slack, Discord, a signed webhook and
  PagerDuty) for failed jobs, error spikes, log volume rules and uptime
  probes. Error tracking gains resolve, ignore, reopen and assign, and log
  volume rules are saved one at a time.
- Observability: response cache rules and the cache providers left out,
  request capture rules and saved replay sets, and the analytics
  destinations page with its delivery queue.
- Rate limits: a tenant's own limit, address allow and deny lists, and the
  refusal history.
- Imports: workbooks with a sheet picker, saved mapping templates and the
  date, split and lookup transforms.
- Settings: a tenant's own captcha provider and keys, and a tenant's own
  metrics destination.
- Reviews: stage quorum, escalation and conditions, with the reviewers and
  approvals shown on each entry.
- Content: the revision window on an entry's history.
- Each page reads what the instance allows from the plugin and shows a
  refusal with the limit it reached.

- The schema builder asks the schema plugin whether this install draws the
  canvas and accepts a saved preset. Where it does not, the Canvas view
  shows where to enable it and the presets drawer offers the built-in
  presets without the save form.
- The canvas starts from the layout saved on the instance and saves it
  again after a drag, so every admin of the tenant opens the same diagram.
- The triggers page links to the templates page when the tenant has no
  active template.

## [0.18.2] - 2026-10-06

### Changed

- The license page with no license says that everything that needs none is running, and offers a key as optional: "Add a license key", with a hint that a key is only needed for what a license grants.

## [0.18.1] - 2026-10-06

### Changed

- Takes ui-kit 0.34.0, where every Select is the kit's listbox. The lint that required `mode="listbox"` on each one is retired, and a hand-written option list is refused instead.

## [0.18.0] - 2026-10-05

### Added

- The LyEve admin console: a SvelteKit 2 and Svelte 5 application that runs
  the engine from a browser. It keeps no data of its own and reaches the engine
  over its REST API from its own server.
- Content: a schema builder, content lists and an editor with rich text, a
  media library, search settings, imports with a dry run and rollback, and data
  exports with schedules.
- Automation: a flow editor with templates, runs and validation, jobs with
  their history, webhooks, and email triggers.
- Access: users and roles, API keys, admin tokens with named grants, expiry and
  rotation, device approval for a command line sign-in, GDPR requests, and a
  page per tenant for what it may use and who acts in it.
- Operations: a dashboard a tenant can compose, logs, analytics,
  observability, the audit log with its retention tab, and an API reference
  that sends a request to the listener that serves the path.
- A setup screen for an engine started in setup mode. It shows what the engine
  is missing, waits for the restart, and creates the first super admin with the
  setup token the engine requires.
- A page per plugin with its state, version and start time, the routes it
  serves and who may call each, and for a super admin the requests the
  profiler sampled through it.
- Plugin pages that follow the engine. The sidebar lists a plugin's pages only
  while the engine runs that plugin, read from `GET /api/admin/plugins/running`.
  A plugin page opened by its address while the plugin does not run says why in
  its place.
- Licensing support. The console runs against any engine build and shows what
  the engine reports:
  - `GET /api/admin/entitlements` carries `license_module`, which says whether
    the engine links one, beside the plan, its state and the enabled features.
  - `GET /api/admin/license` supplies the label, the expiry and the links the
    license module serves.
  - A feature the engine does not enable shows one neutral "not enabled on
    this instance" state, linked where the engine or the module points.
- An editor seam in `src/lib/canvas`. The official image adds visual flow and
  schema editors under a separate license. A build from source shows list
  editors: flows open in an outline of the trigger and nodes in run order with
  their settings and input sources, and the schema builder offers its list
  editor alone.
- Signed engine requests. With `ADMIN_CONSOLE_KEY` set to the engine's value,
  every engine call names the browser's address and is signed with that key, so
  the engine's login limiter and device risk count each user rather than this
  server.
- The users page explains a refusal to add another admin, with the count the
  engine reports. A tenant's membership grant explains the same refusal.
- One notice for a write the license refuses: the count against the ceiling
  for a capacity limit, the capability's name otherwise, and a link to the
  license page. Every number comes from the refusal.
- Content releases: create a release, add and remove entries, schedule it,
  publish it now or cancel it, with the conflicts that stop it listed against
  their entries. The entry editor adds an entry to an open release.
- Editorial comments on an entry: threads, replies, mentions, resolve and
  reopen.
- Audit log streaming to an HTTPS endpoint, Splunk or Datadog, with lag, the
  last error, a test delivery, and a generated signing secret shown once.
- Failure alerts on a scheduled job: email, Slack, Discord or an HTTPS
  webhook, after a threshold of failures in a row.
- A focal point on an image and a builder for a signed transform URL.
- A monthly request limit on an API key, and a quota editor for each tenant.
- The webhook drawer edits the payload template, the JSONPath and field
  filters and the retry policy, and an edit sends back the settings it does
  not show.
- Config sync, for a super admin: export this instance's content types,
  flows, permission rules, webhooks and portable settings as one bundle sealed
  with a passphrase, then compare, dry run and apply a bundle from another
  instance. The plan lists each section's creates, updates, deletes and
  unchanged items with the problems that stop it, and an apply that stops part
  way names the section and key and what was kept.
- Releases has a row in the sidebar under Delivery.
- The new key drawer chooses access by schema and action: every schema, or a
  table of schemas with read, create, update and delete on each. Every other
  route group the engine opens to keys folds out below with its routes, and
  one whose path names something can be held to named values, such as one
  flow endpoint. The list shows each key's scopes one resource a line.
- Hourly and daily request limits beside the monthly one, on the new key
  drawer and on the limits dialog of every key.
- On an install with several tenants, the new user form on Users asks which
  tenant the account belongs to and creates it there, because the engine
  refuses an account that names no tenant.

- A tab icon on Settings > Customization, beside the logo. It takes the same
  files and the same three ways in: an upload, a library file or an address.

### Fixed

- A response whose headers cannot be changed, such as one passed through
  from the engine or a redirect, takes the security headers without a 500.

- On an install with several tenants, the sign-in page opened on a
  tenant's domain carries that tenant's brand and sign-in providers. The
  console signs the host the browser opened into its engine requests.

- The sign-in, password reset and magic link pages carry the tenant's logo,
  name and accent, read from the engine's public brand route.
- Every tab title ends in the tenant's name once it has one, and the tab icon
  follows the tenant's.

