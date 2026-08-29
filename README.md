# acm-psu-website

Official website of the ACM Club at Prince Sultan University — the public
digital archive, plus the member portal and admin console that keep it running.

**Live:** https://acm-psu.shoug-tech.com/

---

## What this is

Three things in one repository:

1. **The public website** — plain HTML, CSS and JavaScript. No build step.
   Open any `.html` file in a browser and it works.
2. **The member portal** (`/portal/`) — apply for membership, keep a profile,
   volunteer for events, submit work for verification, submit files to the
   archive, and make privacy or membership requests.
3. **The admin console** (`/admin/`) — applications, members, positions,
   projects, review queues, member requests, university exports, admin roles,
   and a full audit and decision history.

The portals are TypeScript compiled to static files, so the whole site still
deploys to GitHub Pages. Behind them is a Supabase Postgres database where all
the access rules actually live.

> **The rule the system is built on:** members control who they are, ACM
> verifies what they did, and the archive preserves both.

---

## Setup

New to this repository, or setting it up for a new committee? Start with
**[docs/SETUP.md](docs/SETUP.md)** — numbered steps, nothing assumed.

```sh
npm install
npm run build      # compile the portal
npm run serve      # http://localhost:8000
```

The public pages work without any of that. `npm run build` is only needed after
changing something in `platform/`.

---

## Layout

```
index.html            Home — hero, focus areas, team preview, work, archive timeline
team.html             Roster — hand-written cards plus members who opted in publicly
projects.html         Project archive with category filters and live search
archive.html          Searchable index across every project's archive
positions.html        Live project assignments
join.html             What membership involves, and where to apply
404.html              Not-found page

portal/               Member portal (sign-in, application, dashboard, profile,
                      record, opportunities, contributions, submissions, requests)
admin/                Admin console (overview, applications, members, positions,
                      projects, review queues, requests, university records,
                      audit history, administration)

platform/             TypeScript source for both portals
  lib/                supabase client, session/guards, UI kit, data access
  pages/              one entry point per page
build.mjs             esbuild bundler -> assets/js/app/

supabase/
  migrations/         the database: tables, policies, functions, seed data
  functions/          Edge Functions (AI review, university export)
  config.toml         Supabase CLI configuration

assets/css/main.css   Public site styles
assets/css/portal.css Portal styles, built on the same tokens
assets/js/            Public site scripts (no build step)
assets/js/app/        Compiled portal bundles — committed, do not edit by hand

projects/             Project source material, workshop lessons, handouts,
                      planning records and reusable templates
docs/                 Setup, architecture, handover, operations
apps-script/          The old Google Apps Script form backend (superseded)
design-template/      Original design mockups. Reference only — not deployed.
```

---

## Documentation

| Document | Read it when |
|---|---|
| **[docs/SETUP.md](docs/SETUP.md)** | Setting up Supabase, Cloudflare or Google Sheets |
| **[docs/OPERATIONS.md](docs/OPERATIONS.md)** | Doing the everyday committee tasks |
| **[docs/HANDOVER.md](docs/HANDOVER.md)** | Passing the system to next year's committee |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Understanding why it is built this way |
| **[docs/AUDIT.md](docs/AUDIT.md)** | Working out who decided something, and why |

---

## Security in one paragraph

Every consequential action is a database function that performs the change and
writes its audit entry in the same transaction, so an approval can never exist
without a record of who made it and why — see
[docs/AUDIT.md](docs/AUDIT.md). Authorization is enforced by the database, not
the interface. Every table has
row level security; `supabase/migrations/*_row_level_security.sql` is the
authoritative statement of who can do what, and it holds for anyone with a
browser console. The Supabase anon key compiled into the site is public by
design and grants nothing on its own. Privileged credentials — the service role
key, the Cloudflare token, Google's private key — exist only as Supabase Edge
Function secrets and never appear in this repository or in a bundle.

---

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`, which type-checks
the portal, rebuilds its bundles, stages the repository (minus `platform/`,
`supabase/`, `docs/`, `design-template/` and CI files) and publishes to GitHub
Pages.

One-time setup in the GitHub repository settings:

1. **Settings → Pages → Build and deployment → Source:** select
   **GitHub Actions**.
2. **Settings → Pages → Custom domain:** enter `acm-psu.shoug-tech.com`, then
   tick **Enforce HTTPS** once the certificate finishes provisioning.
3. **Settings → Secrets and variables → Actions → Variables:** add
   `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
4. Add this DNS record at the `shoug-tech.com` registrar:

   | Type  | Name      | Value                        |
   |-------|-----------|------------------------------|
   | CNAME | `acm-psu` | `shoug-alomran.github.io.`   |

---

## Editing content

- **A team member:** they set their profile to Public in the portal and appear
  on `team.html` automatically. Hand-written `.member-card` blocks still work.
- **A project:** create it in **Admin → Projects & Events**, or copy a
  `.case-study-card` block in `projects.html` and set `data-category`.
- **An archive year:** copy a `.timeline-row` in `index.html`.
- **A translation:** add `"English source": "Arabic"` to `DICT` in
  `assets/js/i18n.js`.

Anything that would otherwise be hardcoded — the current chapter year, whether
applications are open, the club email, accepted PSU email domains — is edited
in **Admin → Administration → Settings**, not in the code.

---

## The old membership form

`apps-script/` holds the Google Apps Script that used to receive membership
applications when the site was static-only. Applications now go through the
portal, where they get an account, a status page and a member dashboard on
approval. The script is kept for reference and for `positions.html`, which
still uses it; it can be retired once event opportunities fully replace that
page.
