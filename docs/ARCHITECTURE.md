# Architecture

## The one rule

> Members control who they are. ACM verifies what they did. The archive
> preserves both.

That sentence decides most of the design. It is why `member_profiles` and
`memberships` are two tables rather than one, why members have no UPDATE policy
on official records, and why leaving the club never deletes the record of work
someone actually did.

## Why the site was not rewritten

The public website is plain HTML, CSS and JavaScript on GitHub Pages with a
custom domain. It works, it is fast, and a future committee can edit a page
without installing anything. Rewriting it into a framework would have thrown
that away to gain nothing the club needs.

So the shape is:

| Part | Technology | Build step |
|---|---|---|
| Public website | Plain HTML/CSS/JS | none |
| Member & admin portals | TypeScript, bundled by esbuild | `npm run build` |
| Database, auth, storage | Supabase (Postgres) | migrations |
| AI review, exports | Supabase Edge Functions (Deno) | `functions deploy` |

The portal bundles are committed, so GitHub Pages still publishes the
repository as static files. Someone who only edits HTML never needs Node.

## Why Supabase Storage rather than R2

Both were viable. Supabase Storage won because its access rules are written in
the same policy language as the rest of the schema and evaluated against the
same session. R2 would have required a separate Cloudflare Worker whose only
job was to re-implement "may this person read this file" — a second copy of the
authorization rules, in a second place, that a future committee would have to
keep in step with the first. One authority is more maintainable than two.

## Security model

The interface hides things. The **database** is what enforces them.

Everything the browser does goes through the anon key, which grants nothing on
its own. Read `supabase/migrations/*_row_level_security.sql` to know who can do
what — that file is the authoritative answer, and it holds for anyone with a
browser console.

The patterns used throughout:

- Members get policies on tables they own, and **no write policy at all** on
  `memberships`, `position_history`, `participations`, `archive_items` or
  `audit_log`.
- Approved rows stop matching the member's UPDATE policy, so a verified record
  cannot be edited back into a draft.
- Internal notes live in columns or tables members have no SELECT path to.
  Interview notes are a separate table entirely, so no policy mistake on
  `applications` can expose them.
- Multi-step operations are `SECURITY DEFINER` functions that re-check the
  caller's role internally. Granting EXECUTE to `authenticated` is safe: a
  member calling one gets a permission error from inside it.
- Privileged keys — `service_role`, Cloudflare, Google — exist only as Edge
  Function secrets. Nothing privileged is ever compiled into a bundle.
- Consequential actions write their audit entry inside the same transaction, so
  a change and its record succeed or fail together. The audit log itself
  rejects UPDATE and DELETE by trigger, for every role including the table
  owner.

### Storage

Five buckets, separated by audience, because an internal planning document and
a published handout must not be one policy mistake apart:

| Bucket | Public? | Written by | Read by |
|---|---|---|---|
| `public-archive` | yes | admins | anyone |
| `internal-archive` | no | admins | members, staff |
| `submissions` | no | the member, own folder | that member, reviewers |
| `evidence` | no | the member, own folder | that member, reviewers |
| `avatars` | yes | the member, own folder | anyone |

Private files are reached only through short-lived signed URLs, so nothing
private is reachable by guessing a path. Uploads are constrained by bucket
`allowed_mime_types` and `file_size_limit` — server-side, not by the file
picker.

## Data model

Roughly forty tables; the ones worth knowing:

**Identity**
- `app_users` — one row per sign-in, mirroring `auth.users`
- `member_profiles` — MEMBER-controlled: bio, links, interests, visibility
- `memberships` — ACM-controlled: status, start date, chapter
- `membership_status_history` — every transition, never overwritten
- `admin_assignments` — role grants with a grant/revoke trail

**Joining**
- `applications`, `application_notes` (staff-only)

**Positions**
- `positions` — the catalogue admins edit
- `position_history` — append-only; stores the title *as it was*
- `position_change_requests`

**Work**
- `projects` — events, projects, workshop series and initiatives in one table
- `project_organizers`, `event_positions`, `event_position_applications`
- `participations` — the verified record of who took part
- `contributions`, `contribution_evidence`, `contribution_types`

**Archive**
- `archive_folders` (nested), `archive_items`, `archive_item_contributors`
- `archive_submissions` — what members submit
- `archive_submission_ai` — advisory suggestions, deliberately separate

**Governance**
- `member_requests`, `app_settings`, `university_exports`
- `audit_log` — the decision history. Append-only, with an immutable snapshot
  of who the actor was organisationally at the time. See
  [AUDIT.md](AUDIT.md).

### Two decisions worth explaining

**One `projects` table, not Project *and* Event.** Every ACM initiative is
both: CTF 2.0 is an event that produced a workshop archive; the website is a
project with organisers. Two tables would mean duplicating organisers,
participation, opportunities and archive folders on both sides. There is one
table with a `kind` column; anything needing events filters `kind = 'event'`.

**History is appended, never overwritten.** Changing someone's position closes
the open `position_history` row and inserts a new one. The title is stored on
the row, so renaming or archiving a position in the catalogue never rewrites
what someone's record says they were.

## The AI assistant

`supabase/functions/ai-review` asks Cloudflare Workers AI to suggest a
category, title, description, tags and a visibility for a submitted file, and
to flag anything a human should inspect — student IDs, personal details,
possible duplicates.

It is structurally incapable of publishing:

- It writes only to `archive_submission_ai`.
- Publishing goes exclusively through `publish_archive_submission()`, which
  requires an authenticated club admin.
- That function never reads the AI table.

In the interface each suggestion carries ACCEPT / EDIT / IGNORE and only fills
in a form field. Nothing happens until an admin presses Publish, and the audit
record names that admin — not the assistant — as the deciding party. A table
constraint (`audit_ai_never_decides`) forbids an `ai_assistant` entry from
carrying a decision at all; which suggestions were accepted is recorded as
attribution on the human's entry.

## Google Sheets

The university wants a spreadsheet; the platform stays the operational system.
Data is pushed **out** and never read back, so the sheet cannot become a second,
diverging source of truth.

The three datasets are defined in the database
(`export_members`, `export_event_participation`, `export_contributions`) and
each returns zero rows unless `is_club_admin()` is true. The Edge Function
checks the role again before running. Columns are limited to what the
university asked for — bio, GitHub, LinkedIn, portfolio and privacy
preferences are deliberately not exported.

## Nothing is hardcoded to 2026

The current year, the chapter years shown publicly, whether applications are
open, the accepted PSU email domains, the club email and the feature switches
all live in `app_settings` and are edited from **Administration → Settings**.
Application code calls `current_chapter_year()`; it never contains a literal
year.
