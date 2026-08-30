# ACM PSU club records workbook setup

The private **ACM PSU — Club Records** workbook is a mirror of Supabase. Apps
Script prepares worksheet structure and formatting only; it never reads or
writes Supabase data and it is not a registration backend.

## One-time update

1. Open **ACM PSU — Club Records** and choose **Extensions → Apps Script**.
2. Replace `Code.gs` with this repository's `apps-script/Code.gs` and save.
3. Run `setupClubRecordsWorkbook` once and approve the spreadsheet permission.
4. In the portal, sign in as a super admin and use **Club Records → Update Google Sheet**.

The function prepares People, Members, Club Positions, Opportunity Positions,
Position Applications, Event Participation, Contributions, Inquiries, and
University Export Log. It does not rename or delete legacy tabs such as
`Positions` or `Position Signups`; archive those manually only after checking
whether they contain historical information.

## Retired deployments

Archive every Apps Script web-app deployment under **Deploy → Manage
deployments**. The website no longer calls Apps Script. Saving code does not
disable old `/exec` deployments, so archive each explicitly. The retained
`doGet`/`doPost` handlers refuse writes only as a safety net.

Supabase remains authoritative. `club-records-sheet-sync` uses server-side
Google service-account secrets and the one `GOOGLE_SHEETS_SPREADSHEET_ID`; no
service-role or Google credential belongs in the browser or Apps Script.
