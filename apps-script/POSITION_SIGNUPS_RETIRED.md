# Position Signups — retired

The public positions page no longer registers anyone.

`positions.html` now reads open roles from the Supabase view
`public_event_openings` and links members to `/portal/opportunities.html`.
Registration goes through `register_event_position_application()`, an
authenticated RPC, so there is exactly one record of who holds which role.

## What changed in Code.gs

`registerForPosition()` no longer appends a row. It refuses the request and
returns a message pointing at the member portal, so a cached copy of the old
page cannot create a registration the club will never see.

Everything else is untouched: `doPost` still receives membership applications
from `join.html`, and `doGet?action=positions` still returns the sheet's
position list for anything that reads it.

## What you must do in Google Sheets

Nothing is deleted. Specifically:

- **Position Signups** — keep it. It is the historical record of registrations
  taken before the migration. Do not delete it, and do not add rows to it.
- **Positions** — the old public source of truth for role definitions. Roles are
  now created by admins in the portal under a project. This tab is now
  reference data only.
- **Position Applications** — unchanged and still live. It is refreshed from
  Supabase by the `position-application-sheet-sync` Edge Function and is the
  administrative snapshot.

## Re-deploying

Re-deploy the Apps Script web app ("Manage deployments" > edit > New version)
so the live `/exec` URL stops accepting `action: 'positionSignup'`. Until you
do, the old endpoint keeps serving the previous code.
