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

## Step 5 — Google Sheets: the Club Records workbook (optional)

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
10. Go to <https://sheets.google.com> and create **one** new blank spreadsheet.
    Name it exactly `ACM PSU — Club Records`.

    One workbook holds every dataset as a separate worksheet — Members, Event
    Participation, Contributions and Inquiries. Each tab is created
    automatically the first time you export to it. Do not make a spreadsheet
    per dataset.
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

> Keep that workbook private. Nothing in the member portal or on the public
> website can reach it.
>
> **This is the club's live administrative workbook, and it stays one file.**
> Google applies permissions to a whole spreadsheet rather than tab by tab, and
> the Inquiries worksheet can contain information submitted by members of the
> public. When the university needs records, export a separate reporting copy
> containing only the relevant worksheets — the per-dataset CSV and XLSX
> downloads on the Club Records page are the simplest way to produce one.
> Do not share the live workbook itself.

---

## Step 5b — Public event registrations in the records backup (optional)

Public event signups (Programming Jam, CTF) are collected by the Apps Script in
`apps-script/`, which appends them to the `jam26` and `ctf30` tabs of the **same
`ACM PSU — Club Records` workbook** you set up in step 5:

```
1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s
```

There is no separate registration file and nothing extra to share — the service
account already has Editor on this workbook from step 5, step 11. What keeps
those tabs safe is that the snapshot sync excludes them **by name**: it writes
only the ten canonical worksheets and has never written a cell of `jam26` or
`ctf30`. Those two tabs stay the intake surface and nothing here changes them.

This step gives the signups a second home in Supabase, so they appear in
**Admin → Records Backup** under *Events / Registrations* and survive anything
that happens to the spreadsheet. Without it, registration still works exactly
as before — it simply stays Google-only.

1. Invent a long random shared secret (any 40+ random characters):

   ```sh
   openssl rand -hex 32
   ```

2. Give it to Supabase and deploy the function:

   ```sh
   npx supabase secrets set EVENT_REGISTRATION_TOKEN='<the secret from step 1>'

   npx supabase functions deploy event-registration-intake --no-verify-jwt
   ```

   The import reads `GOOGLE_SHEETS_SPREADSHEET_ID` from step 5, because that is
   the workbook the registration tabs are in. `EVENT_REGISTRATION_SPREADSHEET_ID`
   exists only to override it if those tabs are ever moved into a file of their
   own; leave it unset.

3. Give the same secret to the Apps Script. In the Apps Script editor:
   **Project Settings → Script Properties → Add script property**, twice:

   | Property | Value |
   |---|---|
   | `PLATFORM_INTAKE_URL` | `https://<project-ref>.supabase.co/functions/v1/event-registration-intake` |
   | `PLATFORM_INTAKE_TOKEN` | the secret from step 1 |

   The secret is a credential and `apps-script/` is public in this repository,
   so it lives in Script Properties and never in a `.gs` file. With either
   property missing the copy is skipped silently and registration is unaffected.

4. Redeploy the Apps Script web app (see `apps-script/SETUP.md`).
5. Register once on the live event site and confirm the row appears both in the
   `jam26`/`ctf30` tab and under **Records Backup → Events → Registrations**.
6. Click **IMPORT FROM REGISTRATION TABS** on that page once, to bring in
   everything submitted before this was configured. It is safe to click again
   at any time — a registration already recorded is counted, not duplicated.

> The copy is deliberately one-directional and best-effort. The Apps Script
> writes its worksheet row first and only then tries this endpoint, so a
> Supabase outage can never turn a saved registration into an error the
> participant sees; the import in step 6 recovers anything the copy missed.

---

## Step 6 — Emailing inquiry responses (not yet implemented)

**This does not exist yet, and the interface says so rather than pretending
otherwise.** Today the workflow is:

1. An admin opens the inquiry and writes the response. Saving records it
   against the inquiry and marks it Answered.
2. They click **Open in mail client**, which opens their own email app with the
   sender, subject, reference and response pre-filled.
3. They send it, then click **Mark as sent**, which is what sets
   `response_delivered`.

Until step 2 is automated, the admin page shows a warning counting responses
that were written but never marked as sent, so nothing silently goes unanswered.

### What would be needed to send automatically

1. Choose a transactional email provider — **Resend** is the simplest for this
   (generous free tier, one API call). SendGrid, Postmark or Amazon SES work
   equally well.
2. Verify the sending domain so mail from `acm@psu.edu.sa` (or a club
   subdomain) is not treated as spam. **This needs DNS access and is the part
   that actually takes time** — SPF, DKIM and DMARC records at the domain
   registrar. Ask whoever administers `psu.edu.sa`; if that is not possible,
   send from a club-controlled subdomain instead.
3. Store the API key as an Edge Function secret:

   ```sh
   npx supabase secrets set RESEND_API_KEY=... ACM_FROM_EMAIL='ACM PSU <acm@psu.edu.sa>'
   ```

4. Add a `send-inquiry-response` Edge Function that re-checks the caller is
   staff, loads the inquiry, sends the mail, and sets `response_delivered` and
   `delivery_note`.
5. Point the **Mark as sent** button at that function instead of the mailto:
   link.

Tell me when the domain is verified and I will write the function. Nothing
else in the platform depends on this — inquiries are fully usable without it.

---

## Step 7 — Spam protection for the contact form (optional)

The public contact form is protected by a honeypot field, per-email rate limits
(3 per hour, 10 per day) and a global ceiling of 120 per hour, all enforced in
the database rather than the browser. That is enough for a student club.

If the form is ever targeted properly, add **Cloudflare Turnstile**:

1. Cloudflare dashboard → **Turnstile** → **Add site**.
2. Domain: `acm-psu.shoug-tech.com`. Widget mode: **Managed**.
3. Copy the **site key** and the **secret key**.
4. Tell me both are ready — the site key goes in the page, the secret is
   verified inside `submit_inquiry` via an Edge Function.

---

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
