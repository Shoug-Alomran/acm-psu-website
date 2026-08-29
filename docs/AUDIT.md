# Audit & decision history

The purpose of this system is accountability and institutional memory. A
committee three years from now should be able to answer, without asking anyone
who was there:

> Who approved this person? Who rejected this application, and why? Who
> assigned this position, and what was the previous one? Who verified this
> accomplishment? Why was this archive file rejected? Who made this public?
> Who removed this admin? What exactly did they change? What role did that
> administrator hold at the time?

---

## The three properties that make that work

### 1. The actor is captured as they were, not as they are

Every entry stores an immutable snapshot alongside the relational ids:

```
actor_id            uuid       ← relational integrity
actor_name          text       ← "Shoug Alomran"
actor_position      text       ← "Vice President"
actor_role          text       ← "super_admin"
actor_member_no     text       ← "0x02_LEAD"
actor_chapter_year  text       ← "2026"
```

If someone approves an application as Vice President in 2026 and becomes an
alumnus in 2027, the 2026 entry still reads **Shoug Alomran · Vice President ·
2026**. Resolving old entries against a current profile would silently
misattribute every historical decision the moment anyone's role changed.

`audit_actor_snapshot()` resolves this once, at write time.

### 2. Before and after, with the fields that changed

Edits carry `before_state`, `after_state` and `changed_fields`. The interface
renders those as readable rows rather than raw JSON:

```
Position     General Member  →  Events Coordinator
Status       Pending         →  Approved
Visibility   Internal        →  Public
```

`jsonb_changed_fields()` computes the diff and drops `created_at` /
`updated_at`, which change on every write and mean nothing.

### 3. Append-only, enforced below the application

Row level security is not enough on its own: a table's owner bypasses its own
policies, so "no UPDATE policy" would still leave the owner able to rewrite
history. Two triggers reject the statement itself, which applies to **every**
role including `postgres`:

```sql
create trigger audit_log_no_update before update on public.audit_log ...
create trigger audit_log_no_delete before delete on public.audit_log ...
```

`INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` are additionally revoked from
`anon` and `authenticated`. Entries arrive only through `write_audit()`, which
is `SECURITY DEFINER`.

There is no edit or delete control anywhere in the interface, because there is
nothing to build one on. To correct the record, perform the corrective action —
it is recorded in turn.

---

## Transactional guarantee

Every privileged action and its audit entry are **one transaction**. If the
entry cannot be written, the action does not happen.

```
approve_application()
  ├─ update the application
  ├─ create the membership
  ├─ carry details onto the profile
  ├─ open the first position
  └─ write the audit entry      ← same transaction
```

There is no code path in which an application is approved without a record of
who approved it. This is why these operations are database functions rather
than a sequence of calls from the browser: two round trips can half-succeed, a
transaction cannot.

### Two layers, no duplicates

| Layer | Covers | Carries |
|---|---|---|
| **RPCs** | the consequential decisions | reason, decision, before/after, member visibility |
| **Row triggers** | everything else, including direct writes | before/after and changed fields |

`audit_context()` sets a transaction-local flag. A transaction that has
established a context is one where an RPC is in charge and will write its own
richer entry, so the triggers stand down. Direct writes from the console never
set a context, so the triggers catch them. Nothing depends on the browser
remembering to log anything.

Entries produced by one transaction share a `correlation_id`, so an approval
that touched four tables reads as one event with its detail attached.

---

## What requires a reason

The database refuses these without one — `require_reason()` demands at least a
short sentence, so `REJECTED` can never stand alone:

| Action | Function |
|---|---|
| Decline an application | `reject_application` |
| Decline a contribution, or ask for changes | `decide_contribution` |
| Revoke a verified contribution | `revoke_contribution_verification` |
| Decline an archive submission, or ask for changes | `decide_archive_submission` |
| Publish publicly what a member marked internal | `publish_archive_submission` |
| Change what the public can see | `set_archive_item_visibility` |
| Remove an archive item | `delete_archive_item` |
| End a membership (alumni / inactive / withdrawn / rejected) | `set_membership_status`, `resolve_withdrawal` |
| Disable or restore sign-in | `set_account_state` |
| Grant or revoke an admin role | `grant_admin_role`, `revoke_admin_role` |
| Decline a position request or profile removal | `resolve_position_request`, `resolve_profile_removal` |
| Resolve an account deletion request, or decline any request | `resolve_member_request` |
| Change a feature switch or the accepted PSU email domains | `save_setting` |

Approving is generally **not** gated — approvals are the expected outcome and
forcing a sentence on every one of them trains people to type "ok". Reasons are
still recorded when given, and appear on the member's own history.

The interface checks the same rule before the round trip (`checkReason()`) so
the message is immediate, but the database is the enforcement.

---

## What members can and cannot see

Members read `public.my_decision_history`, a view built as a **column
allow-list rather than a filter**:

**Selected:** timestamp, category, action, decision, target label, summary,
`reason`, the deciding admin's name and their position at the time.

**Not in the view at all:** `internal_note`, `before_state`, `after_state`,
`metadata`, `correlation_id`, `changed_fields`, `actor_email`, `actor_id`,
`user_agent`.

Because those columns are never selected, no policy mistake can surface them —
there is nothing there to leak. A member sees a row only when an admin marked
it `member_visible` **and** it names them in `related_member_id`. Entries about
other people, internal deliberation, and the assistant's suggestions are all
excluded.

Members appear on `/portal/record.html`, their dashboard, and the applicant
status page.

## Who can read the global log

| Role | Sees |
|---|---|
| **Super admin** | everything |
| **Club admin** | everything |
| **Reviewer** | only entries they themselves produced |
| **Member** | nothing — `my_decision_history` only |
| **Anonymous** | nothing |

A reviewer works the submission queues; they can account for their own
decisions but have no business reading membership or administration history.

---

## The assistant is never the authority

`actor_kind` includes `ai_assistant`, and a table constraint forbids it from
carrying a decision:

```sql
constraint audit_ai_never_decides
    check (actor_kind <> 'ai_assistant' or decision is null)
```

So the trail separates the two things cleanly:

```
AI ASSISTANT   Suggested a category, a description, internal visibility;
               raised 1 flag (possible student IDs)

SHOUG ALOMRAN  Published "Day 2 handout" as internal
Vice President Reason: Contains participant names.
               ai_suggestions_accepted: ["category", "description"]
```

The human is the deciding party. Which suggestions they took is recorded as
attribution on **their** entry — never as authority on the assistant's.

---

## Where history appears

- **`/admin/audit.html`** — the global log: search, date range, admin,
  category, decision and project filters; a monthly summary; CSV export;
  a detail view with WHO / WHAT / WHY / CHANGES / CONTEXT / SYSTEM and the
  other entries from the same transaction.
- **Individual records** — an **Activity** panel on applications, members,
  contributions, archive submissions, projects and withdrawal requests, via
  `record_history()`. Nobody has to visit the global log to find out what
  happened to one record.
- **Member portal** — dashboard, `record.html` and the applicant status page.

### Export

CSV export is admin-only and reflects the current filters. It is deliberately
**separate from the university export**: internal ACM accountability and
university reporting are different systems, and the audit log must never end up
in the university's spreadsheet.

---

## What is not recorded

- Page views, sign-ins, searches, and other read activity.
- Members editing their own bio, links or interests. `member_profiles` has no
  audit trigger on purpose — those change often and burying decisions under
  them would defeat the point.
- IP addresses. They identify a person's location and network, add little to a
  student club's accountability story, and would make this table far more
  sensitive than it needs to be.
- Credentials of any kind. `scrub_sensitive()` redacts any key matching
  password / token / secret / key / credential / session / jwt / cookie /
  signature from `metadata`, `before_state` and `after_state` before they are
  written, so carelessness upstream cannot turn the audit log into a place
  secrets accumulate.
- Interview note bodies. Adding a note is recorded; the text stays in
  `application_notes`, which applicants have no read path to.

---

## Extending it

To audit a new action:

1. If it is consequential, make it a `SECURITY DEFINER` function that calls
   `audit_context()` first and `write_audit()` last, in the same transaction.
   Use `require_reason()` if it rejects, revokes, deletes, or overrides.
2. If it is an ordinary table write, add a row trigger:

   ```sql
   create trigger my_table_audit
       after insert or update or delete on public.my_table
       for each row execute function public.audit_row_change(
           'category', 'entity_type', 'label_column', 'id_column');
   ```

3. Add the category to `audit_category` if none fits, and to
   `CATEGORY_LABELS` in `platform/lib/audit.ts`.

Do not add page views or read activity. The log is worth reading precisely
because everything in it is a decision or a change.
