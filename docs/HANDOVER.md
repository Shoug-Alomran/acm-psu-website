# Handover

This system is designed to outlive whoever set it up. Nothing depends on one
person, and the last super admin cannot be removed until another one exists —
so the club cannot be locked out of its own platform.

Work through this list at the end of an academic year.

---

## 1. Promote the incoming leadership

Do this **before** anything else, while you still have access.

1. Ask the incoming president or technical lead to create an account at
   `/portal/signup.html` and confirm their email.
2. Sign in to `/admin/administration.html`.
3. Click **Grant a role**.
4. Choose them, choose **Super admin**, and write the reason
   (e.g. "2027 committee handover").
5. Click **Grant role**.
6. Repeat with **Club admin** for the rest of the incoming committee.

Roles are hierarchical:

| Role | Can do |
|---|---|
| **Super admin** | Everything, including granting and revoking admin roles |
| **Club admin** | Applications, members, positions, projects, archive, exports |
| **Reviewer** | Review queues only — no member management, settings or exports |

Give people the smallest role that lets them do their job. A committee member
who only reviews workshop uploads should be a Reviewer.

## 2. Roll the chapter year

1. Go to **Administration → Settings**.
2. Set **Current chapter year** to the new year (e.g. `2027`).
3. Add the new year to **Chapter years shown publicly**, newest first.
4. Set **Accepting membership applications** to match your intake schedule.

Nothing else needs changing. No year is hardcoded anywhere in the code.

## 3. Close out the outgoing committee

For each person leaving:

1. **Admin → Members**, find them, click **Manage**.
2. Set **Membership status** to `Alumni`.
3. Their open position is closed and their history is kept intact.

Do not delete anyone. Their position history and verified contributions are the
club's record of work that genuinely happened, and they are the reason a member
wanted a verified record in the first place.

## 4. Transfer the external accounts

The platform depends on services owned by accounts, not by the repository.
Move each to a club-owned account, or add the incoming lead:

| Service | What to do | Where |
|---|---|---|
| **Supabase** | Add the new lead as an Organization member (Owner) | Supabase → Organization → Team |
| **GitHub** | Add them as a repository admin | Repository → Settings → Collaborators |
| **Domain / DNS** | Transfer or share the registrar login | Registrar |
| **Cloudflare** | Add them to the account (only if the AI assistant is on) | Cloudflare → Manage Account → Members |
| **Google Cloud** | Add them as Project Owner (only if Sheets export is on) | Console → IAM |

Put every credential in a club password manager, not in a personal one.

## 5. Revoke your own access last

Once the new super admin has signed in and confirmed they can reach
`/admin/administration.html`:

1. Ask **them** to revoke your roles from **Administration → Current admins**.
   They will be asked for a reason; "End of 2026 term" is enough.
2. Your name stays under **Previous admins**, and the grant and revocation both
   stay in the audit history. That is deliberate — it is the record of who ran
   the club, and when.

The database refuses to revoke the last remaining super admin, so step 1 can
only happen after step 1 of this document actually worked.

---

## If access is lost entirely

If nobody has a working super admin account:

1. Sign in to the Supabase dashboard (this needs the Supabase account, which is
   why it must be club-owned).
2. **SQL Editor → New query**, and run, with the right email:

   ```sql
   insert into public.admin_assignments (user_id, role, note)
   select id, 'super_admin', 'Recovery grant'
   from public.app_users
   where email = 'incoming.lead@psu.edu.sa';
   ```

3. That person now has the admin console.

If the Supabase account itself is lost, the data is gone with it. That is why
step 4 above matters more than any of the others.

---

## Understanding what the previous committee did

You inherit the system without inheriting the conversations that produced its
data. **Admin → Audit History** is where those conversations were written down:
every approval, rejection, position change, verification, publication and role
grant, with the reason given at the time and the position the administrator
held when they gave it.

Start there before assuming anything about why a record looks the way it does.

## What a new committee should read

1. `README.md` — what everything is and how to run it
2. `docs/OPERATIONS.md` — the everyday tasks
3. `docs/AUDIT.md` — how to reconstruct any past decision
4. `docs/ARCHITECTURE.md` — why the system is shaped this way
5. `supabase/migrations/*_row_level_security.sql` — who can do what, exactly
