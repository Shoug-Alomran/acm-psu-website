# Setup

Follow these in order. Steps 1–3 are required. Steps 4 and 5 are optional
features you can add later without touching anything else.

Anything you paste into `.env.local` stays on your machine — that file is
gitignored.

---

## Step 1 — Create the Supabase project

1. Go to <https://supabase.com> and sign in with GitHub.
2. Click **New project**.
3. Organisation: pick or create one. Use a club-owned account, not a personal
   one, so the next committee can be given access.
4. Name: `acm-psu-platform`
5. Database password: click **Generate a password** and save it in the club's
   password manager. You will rarely need it.
6. Region: choose the one closest to Riyadh (`Central EU` or `Asia Pacific`).
7. Click **Create new project** and wait about two minutes.
8. In the left sidebar go to **Project Settings → Data API**.
9. Copy **Project URL**.
10. Copy the **anon / public** key (the long one labelled `anon`, *not*
    `service_role`).
11. In **Project Settings → General**, copy the **Reference ID**.
12. In the repository, copy `.env.local.example` to `.env.local` and fill in:

    ```
    PUBLIC_SUPABASE_URL=<the Project URL from step 9>
    PUBLIC_SUPABASE_ANON_KEY=<the anon key from step 10>
    SUPABASE_PROJECT_REF=<the Reference ID from step 11>
    ```

13. Tell Claude when this is done.

> The anon key is meant to be public — it is compiled into the website. Every
> table is protected by row level security, so the key alone opens nothing.
> Never put the `service_role` key anywhere in this repository.

---

## Step 2 — Create the database

Run these three commands in the repository:

```sh
npm install
npx supabase login          # opens a browser, click Authorize
npx supabase link --project-ref <your Reference ID>
npx supabase db push        # creates every table, policy and bucket
```

`db push` runs everything in `supabase/migrations/` in order. It is safe to run
again; migrations already applied are skipped.

Then check it worked:

```sh
npx supabase db lint
```

---

## Step 3 — Make yourself the first admin

The system has no permanent owner built into it, so the first super admin is
granted once by hand.

1. Run `npm run build`, then `npm run serve`.
2. Open <http://localhost:8000/portal/signup.html> and create your account.
3. Check your email and click the confirmation link.
4. In the Supabase dashboard, open **SQL Editor → New query**.
5. Paste this, with your own email, and click **Run**:

   ```sql
   select public.bootstrap_super_admin('your.email@psu.edu.sa');
   ```

6. You should see `super_admin granted to …`.
7. Open <http://localhost:8000/admin/index.html>. You now have the admin console.

`bootstrap_super_admin` refuses to run a second time. From here on, admins are
granted from **Administration → Grant a role**.

### Auth email links

In the Supabase dashboard, **Authentication → URL Configuration**:

1. **Site URL:** `https://acm-psu.shoug-tech.com`
2. **Redirect URLs:** add both of these:
   - `https://acm-psu.shoug-tech.com/portal/auth-callback.html`
   - `http://localhost:8000/portal/auth-callback.html`
3. Click **Save**.

### Deploying

In the GitHub repository, **Settings → Secrets and variables → Actions →
Variables → New repository variable**, add:

| Name                       | Value                       |
|----------------------------|-----------------------------|
| `PUBLIC_SUPABASE_URL`      | your Project URL            |
| `PUBLIC_SUPABASE_ANON_KEY` | your anon key               |

Push to `main` and the site deploys with the portal connected.

---

## Step 4 — Cloudflare Workers AI (optional)

This powers the review assistant on the archive review page. Everything else
works without it. The assistant only suggests; it can never publish.

1. Go to <https://dash.cloudflare.com> and sign in.
2. On the right of the overview page, copy your **Account ID**.
3. In the left sidebar click **Manage Account → Account API Tokens**.
4. Click **Create Token**, then **Get started** next to *Create Custom Token*.
5. Name it `acm-psu-workers-ai`.
6. Under **Permissions** choose: `Account` → `Workers AI` → `Read`.
7. Click **Continue to summary**, then **Create Token**.
8. Copy the token — it is shown only once.
9. Back in the repository, run:

   ```sh
   npx supabase secrets set \
     CLOUDFLARE_ACCOUNT_ID=<the Account ID from step 2> \
     CLOUDFLARE_AI_TOKEN=<the token from step 8> \
     CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct

   npx supabase functions deploy ai-review
   ```

10. In the admin console, go to **Administration → Settings** and turn on
    **Review assistant**.
11. Tell Claude when this is done.

---

## Step 5 — Google Sheets export (optional)

CSV and XLSX export already work and are enough to hand the university a
spreadsheet. This step adds a button that pushes straight into a private Google
Sheet.

1. Go to <https://console.cloud.google.com>.
2. Top bar → project dropdown → **New Project**. Name it `acm-psu-records`.
   Click **Create**, then select it.
3. In the search bar type `Google Sheets API`, open it, click **Enable**.
4. In the left sidebar: **APIs & Services → Credentials**.
5. Click **Create Credentials → Service account**.
6. Name: `acm-sheets-writer`. Click **Create and continue**, then **Done**.
7. Click the service account you just made, then the **Keys** tab.
8. **Add key → Create new key → JSON → Create**. A `.json` file downloads.
9. Open that file. You need two values from it:
   - `client_email` — looks like `acm-sheets-writer@…iam.gserviceaccount.com`
   - `private_key` — a long block starting `-----BEGIN PRIVATE KEY-----`
10. Go to <https://sheets.google.com> and create a new blank spreadsheet.
    Name it `ACM PSU — University Records`.
11. Click **Share**, paste the `client_email` from step 9, give it **Editor**,
    and untick "Notify people". Click **Share**.
12. Copy the spreadsheet ID out of its URL — the long string between
    `/d/` and `/edit`.
13. In the repository, run (keep the quotes exactly as shown):

    ```sh
    npx supabase secrets set \
      GOOGLE_SERVICE_ACCOUNT_EMAIL='<client_email from step 9>' \
      GOOGLE_SHEETS_SPREADSHEET_ID='<the ID from step 12>'

    npx supabase secrets set GOOGLE_PRIVATE_KEY="$(python3 -c "import json,sys; print(json.load(open('/path/to/downloaded.json'))['private_key'])")"

    npx supabase functions deploy university-export
    ```

14. In the admin console: **Administration → Settings** → turn on
    **Google Sheets export**.
15. Tell Claude when this is done.

> Keep that spreadsheet private. Share it with the university directly, never
> with a public link. Nothing in the member portal or the public website can
> reach it.

---

## Everyday commands

```sh
npm run build      # rebuild the portal after changing anything in platform/
npm run watch      # rebuild on save while developing
npm run typecheck  # check types without building
npm run serve      # http://localhost:8000
npm run db:push    # apply new migrations
npm run types:pull # regenerate database types from the live schema
```

The public website (`index.html`, `team.html`, …) needs no build at all. Edit
the HTML and refresh.
