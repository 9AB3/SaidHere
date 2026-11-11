# Said Here Analytics (Main Admin)

Go to **/admin/analytics** while signed in as the Main Admin. Moderator accounts cannot access the dashboard or its data/CSV endpoints.

The dashboard uses existing production data from PostgreSQL and Stripe reconciliation, not placeholder figures. It includes:
- 7/30/90 Sydney-calendar-day filters and daily trend graphs.
- First native opens by platform (requires the Flutter app update).
- Recorded NFC tag opens, distinct anonymous Wall visitor sessions, visible posts, paid orders, and AUD paid order value.
- Top Walls by activity and a daily CSV export.
- Website home/NFC landing views, Apple/Google Play badge clicks, shop page views, and successfully created Stripe checkout sessions.
- Coarse acquisition source categories (direct, Reddit, Google, Instagram, Facebook, TikTok, YouTube, email, other).

## Data coverage and accuracy

- **Apple App Store and Google Play Console downloads, acquisition impressions, crashes, and true retention are not imported.** Use their respective dashboards until external analytics connectors are configured.
- **First opens are not downloads.** A first launch is tracked by an anonymous API session. Reinstalls/cleared app data can cause extra sessions; old app versions and legacy installations are not backfilled.
- **NFC open events are API-confirmed Wall opens.** They do not represent every physical tap. The existing wall_visit_events trigger began recording scan history when the original Wall analytics migration was deployed.
- **Visitors are distinct anonymous sessions**, not verified people. Posts include visible root messages and replies.
- **Web event counts are not deduplicated visitors.** A view or click is a single browser interaction and may be repeated. Store clicks do not prove that a store download occurred.
- **The app and purchase journeys cannot be joined user-by-user.** They are separate event volumes, not scientifically valid conversion funnels. The UI intentionally does not calculate a misleading conversion percentage.
- **Revenue is the sum of paid/fulfilled AUD order totals**, before Stripe fees; refunded/cancelled orders are excluded. Any non-AUD orders are excluded from AUD revenue.
- Website and app tracking starts **after deployment of the corresponding changes**, and no artificial historical values are produced.

## Privacy and safety

- Landing telemetry stores only event name, Android/iOS platform where relevant, home/NFC landing type, a coarse source label, and timestamp.
- It does not store IP addresses, advertising IDs, full referrer URLs, cookies, user identities, or message text.
- The event API only allows published event names, has rate limiting, and does not affect the app or checkout if tracking fails.
- Analytics API and export require an active Main Admin session and return no individual visitor identifiers.
- The dashboard does not change Wall configuration or purchases.

## Deployment

The Render start command runs database migrations automatically (including site_analytics_events and app_first_opens). The existing build copies site assets into the public folder.

To enable **native first-open tracking**, release a new Flutter iOS/Android build. The corresponding iPhone push messages additionally require Pushover keys on Render (see FIRST_OPEN_PUSH_SETUP.md). The dashboard and web tracking do not require Pushover.

For source-based campaigns, use a recognized link tag such as:

https://saidhere.app/?utm_source=reddit

Only the broad channel label is stored.
