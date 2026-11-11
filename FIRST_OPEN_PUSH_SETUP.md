# iPhone installation push notifications (Said Here)

Said Here can notify the owner on an iPhone when a **new installation first opens the native app**. This is not a real-time App Store / Google Play download event, and it is not an authenticated install count.

## Owner setup

1. Install **Pushover** on your iPhone, create an account at https://pushover.net, and allow notifications. Pushover currently offers a trial and then a one-time iOS licence.
2. In the Pushover dashboard, copy your **User Key** and create an **Application/API Token** for Said Here at https://pushover.net/apps/build. Do not commit either key to GitHub.
3. In the Render dashboard for Said Here's web service, add two **secret environment variables**:
   - `PUSHOVER_USER_KEY` — your Pushover User Key
   - `PUSHOVER_APP_TOKEN` — your app's API token
4. Deploy the server update, including `npm run migrate` (the Render blueprint already does this), and publish a new Flutter app release to the Apple App Store and Google Play containing this change.
5. Install the updated app on a fresh test device / test installation, launch it with internet access, and confirm the push arrives on your iPhone. A new install opened offline retries on a later launch.

## Behavior / limitations

- Endpoint: `POST /api/app/first-open`, requiring the existing anonymous session and an `ios` or `android` platform.
- PostgreSQL stores one event per anonymous session, with `notified_at` recording success. Repeated opens do not send additional notifications. Failed push attempts return 503 and retry on a later app launch.
- The app remembers pending notifications across launches without blocking the user. Prior installations with an existing stored anonymous session are not counted as new when they upgrade.
- Pushover is an external notification service, so never send personal user details in the push payload. The notification contains only the OS platform.
- Deleting an anonymous session also deletes the matching event. Clearing app storage or reinstalling may produce a new anonymous session; a first open is therefore only an approximation of an installation, not an authoritative store download metric.
- Credentials must be configured privately in Render; they are never stored in app bundles or GitHub.
