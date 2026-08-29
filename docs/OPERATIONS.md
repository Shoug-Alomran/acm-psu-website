# Everyday operations

Short recipes for the things a committee actually does.

---

## Approve a membership application

1. **Admin → Applications**.
2. Click **REVIEW** on an application.
3. Optionally **Add note** — interview notes are internal and applicants can
   never read them.
4. **Mark for interview** if you want to talk to them first.
5. To accept: choose the **Position on approval** (usually `Member`), set the
   **Membership start date**, and click **Approve**.

Approving does four things in one transaction: sets the status, creates the
membership, carries their details onto their profile, and opens their first
position. Their dashboard works immediately.

Membership is not a technical screening. The application asks what someone
wants to learn, not what they can already do.

---

## Create a project or event

1. **Admin → Projects & Events → New project**.
2. Fill in the title, kind, status and dates. Set **Visibility** to `Public`
   when you are ready for it to appear on the website.
3. Click **Create**, then **MANAGE** to open its workspace.

From the workspace you can:

- **New opening** — an open role members can volunteer for
- **New folder** — an archive folder (Workshops, Results, Branding, …)
- **Add organiser** — who is running it

A project uses only the sections it actually has. Nothing forces an event to
invent a "Branding" folder it never produced.

---

## Post an opportunity

1. Open the project → **New opening**.
2. Title (e.g. `Workshop Assistant`), number of **openings**, optional closing
   date.
3. Describe what someone would actually do. Do not list prerequisites that
   would put a beginner off — making opportunity visible to everyone is the
   point.

It appears immediately under **Opportunities** for every active member.
Approving a volunteer records verified participation on their ACM record.

---

## Verify a contribution

1. **Admin → Contributions**.
2. **REVIEW**. Open any evidence file.
3. Correct the title, type, project or description if the work is real but
   described vaguely — then **Verify**. Editing and approving is usually the
   right answer; declining genuine work is not.
4. **Request changes** if you need more from the member. Say what is missing.

---

## Publish something to the archive

1. **Admin → Archive Review**.
2. **REVIEW**. Preview the file in place.
3. Optionally **Ask the assistant** for suggestions — accept, edit or ignore
   each one. It cannot publish anything itself.
4. Set the title, category, project, folder and **visibility**.
5. **Publish to archive**.

When in doubt about personal information, publish as **internal**. Anything
with student IDs, grades or participant names stays internal.

---

## Give someone a new position

Either wait for them to request it (**Admin → Requests → Position changes**),
or do it directly:

1. **Admin → Members**, find them, **MANAGE**.
2. Under **Grant a position**, pick the position and the effective date.
3. **Grant**.

Their current position is closed automatically. Nothing is overwritten — the
result is a readable progression:

```
Member              2024
Events Coordinator  2025
Vice President      2026
```

---

## Add a new kind of position

**Admin → Positions → New position**. Set a **display rank** — lower sorts
first, so executive roles use small numbers. Leave gaps (10, 20, 30) so future
roles can slot in without renumbering.

Archiving a position hides it from new grants. Everyone who ever held it keeps
that entry, because the title is stored on the history row itself.

---

## Give the university its spreadsheet

1. **Admin → University Records**.
2. Pick a dataset and click **Download CSV** or **Download XLSX**.
3. If Google Sheets export is configured, **Update Google Sheet** instead.

Every export is recorded, so a future committee can account for where student
data went. Members cannot reach this page, and the database returns no rows to
them even if they try.

---

## Find out who decided something

**Admin → Audit History**. Filter by category, decision, admin, project or date
range, or search across actions, people and reasons. Click any row for the full
detail: who decided (with the position they held *at the time*), what changed
field by field, the reason they gave, and everything else that happened in the
same transaction.

You usually do not need to go there: applications, members, contributions,
archive submissions, projects and withdrawal requests each have an **Activity**
panel on their own detail view showing the same trail for that record.

Entries cannot be edited or deleted by anyone, including super admins. To
correct the record, perform the corrective action — it is recorded in turn.

## Write a good reason

Consequential decisions require one, and the database will refuse the action
without it. Keep it to a sentence that answers "why" for someone reading it in
three years:

```
Rejected     Applicant did not attend the required interview.
Changes requested
             Evidence does not clearly demonstrate the claimed contribution.
Rejected     Contains student IDs and should not be published publicly.
Approved     Interview completed and Events Coordinator position confirmed.
```

For anything about a member, the reason is shown to them. Anything you would
not want them to read belongs in **Internal note** instead, which they never
see.

## Change something that would otherwise be hardcoded

**Admin → Administration → Settings**:

- Current chapter year
- Chapter years shown publicly
- Whether applications are open
- Club contact email
- Accepted PSU email domains
- The review assistant and Google Sheets switches
- Maximum upload size

---

## Add content to the public website

The public pages are plain HTML with no build step.

- **A team member** — they set their own profile to Public in the portal, and
  they appear on `team.html` automatically. Hand-written cards in the HTML also
  still work and are never removed by the script.
- **A project card** — copy a `.case-study-card` block in `projects.html` and
  set `data-category`.
- **An archive year** — copy a `.timeline-row` in `index.html`.
- **A translation** — add `"English": "Arabic"` to `DICT` in
  `assets/js/i18n.js`.

## After changing anything in `platform/`

```sh
npm run build
```

Commit the result in `assets/js/app/`. CI rebuilds it too, so a missed build
will not break the deploy — but committing keeps local and live identical.
