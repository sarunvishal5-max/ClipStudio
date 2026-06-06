# ClipStudio

Browser-based call recorder. Record camera or voice, auto-detect individual
calls with the in-browser "AI Auto-Clip", and export each call as a WAV — all
client-side. ClipStudio now also has accounts, a dashboard, and a synced call
history backed by Supabase.

## Pages

| File             | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `auth.html`      | Sign in / create account. Entry point for signed-out users.             |
| `dashboard.html` | Two big buttons: **Record Dashboard** and **Call History**.             |
| `index.html`     | The recorder (the original landing page). Reached via *Record Dashboard*.|
| `history.html`   | Table of the most recent **100 calls** with playback, download, delete. |

Detected calls are saved to history automatically when you run **AI Auto-Clip**.
Once a user has more than 100 calls, the oldest are pruned automatically (both
client-side and via a database trigger).

## Connecting Supabase

The app works out of the box in **demo mode** (data stored only in the current
browser via `localStorage`). To enable real accounts and cloud sync:

1. Create a project at <https://supabase.com>.
2. In the Supabase dashboard, open **SQL Editor → New query**, paste the
   contents of [`supabase_schema.sql`](./supabase_schema.sql), and run it. This
   creates the `calls` table, row-level security, the 100-call cap trigger, and
   a public `recordings` storage bucket.
3. Open **Project Settings → API** and copy the **Project URL** and the
   **anon public** key.
4. Paste them into [`supabase-config.js`](./supabase-config.js):

   ```js
   const SUPABASE_URL      = "https://YOUR-PROJECT.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";   // anon public key (safe in client code)
   ```

5. (Optional) In **Authentication → Providers → Email**, turn **Confirm email**
   off for instant sign-up, or leave it on to require email confirmation.

That's it — reload the site and accounts/history are backed by Supabase.

> The anon key is designed to be embedded in client-side apps; row-level
> security (configured by the schema) is what protects each user's data.

## Running locally

It's a static site — open `auth.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/auth.html
```

> Camera/microphone capture requires a secure context. `http://localhost` is
> treated as secure; for other hosts use HTTPS.
