# Public registration contract — 2026-09-05.1

## Investigation baseline

Inspected fetched `origin/main` in all three repositories:

| Repository | Baseline |
|---|---|
| acm-psu-website | `4748062622a04b747639c1c52f634c6e79cff6e0` |
| acm-programming-jam-2026 | `d415766` |
| ACM-CTF-3.0. (trailing period) | `024cb70` |

Both config files used the endpoint below. Jam's config installed a capture
handler using iframe/postMessage, shared source tag and 20-second timeout,
while its inline form still contained a no-cors false-success handler. CTF
used iframe/postMessage, the shared tag, and a 20-second timeout. Both waited
for message `OK` on the effective iframe path. The main repo's active server
used Jam source `jam26`, omitted ALLOWALL and the top-window relay, and could
fall back to an active workbook. A separate unused handler draft conflicted
with those choices. Setup/retirement docs incorrectly said there were no public
Apps Script callers.

A read-only live GET of the existing `/exec`, following redirects, returned:

```json
{"status":"retired","message":"This Apps Script only prepares the ACM PSU Club Records workbook."}
```

This proves the live deployment differed from current repository source. The
provided POST screenshots show Google redirect-document 403 failures; the exact
Google-side access cause cannot be established from that status alone. A 302
redirect is not itself a failure, and ALLOWALL is not a claim to fix every 403.
The corrected version and anonymous web-app access must both be deployed and
verified in a browser.

## Endpoint and transport

Unchanged URL in both config files:

`https://script.google.com/macros/s/AKfycby-JG2gKExXqhLTcK_a8kSAIB7fIL9JD1q0WbejcqSbaIE9gEC9TboORCTUkHwW-D12/exec`

Normal `POST`, `application/x-www-form-urlencoded`, targeted to a fresh hidden
iframe. No fetch/no-cors registration path. One form submit listener per page.
The transport creates an unpredictable 32-character lowercase hexadecimal
`requestId`, includes it with the fields below, and waits **30 seconds**. No
iframe load or HTTP status counts as successful registration.

### Jam

`event=jam26`, `fullName`, `universityId`, `universityEmail`, `phoneNumber`,
`major`, `teamName`, `teamMembers`, `website`, `requestId`.

`teamMembers` is a comma-separated list of up to ten valid email addresses, or
blank for a solo submission. `website` is the honeypot and must be blank.

Exact `jam26` columns, one row per team submission:

```text
Timestamp | Full Name | University ID | University Email | Phone Number | Major | Team Name | Team Members
```

### CTF

`event=ctf30`, `teamName`, `experience`, `captainName`, `captainId`,
`captainEmail`, `captainPhone`, `captainMajor`, `member2Name`, `member2Id`,
`member2Email`, `member2Major`, `member3Name`, `member3Id`, `member3Email`,
`member3Major`, `website`, `requestId`.

Experience is exactly `Beginner`, `Intermediate`, or `Advanced`. All four
Member 3 fields must be present together or blank together. Only the captain
has a phone. Rules agreement is enforced by the page; it is not a stored sheet
column. No localStorage registration path is used.

Exact `ctf30` columns, one row per team:

```text
Timestamp | Team Name | Captain Name | Captain University ID | Captain University Email | Captain Phone Number | Captain Major | Member 2 Name | Member 2 University ID | Member 2 University Email | Member 2 Major | Member 3 Name | Member 3 University ID | Member 3 University Email | Member 3 Major | Experience Level
```

## Response

HtmlService with `XFrameOptionsMode.ALLOWALL`; the script calls
`parent.postMessage(payload,"*")` and, when different, `top.postMessage`.
No participant data is returned. Example acknowledgement:

```json
{
  "source": "acm-event-registration",
  "event": "jam26",
  "requestId": "0123456789abcdef0123456789abcdef",
  "message": "OK",
  "version": "2026-09-05.1"
}
```

The frontend requires the Google origin, exact source, matching event, matching
requestId, and a string message. Only exact `OK` displays saved success. Server
errors are displayed with the optional `Error:` prefix removed. Wrong/stale
messages are ignored. Legacy callers may omit requestId server-side, but both
updated websites require their own echoed ID and cannot work with an older
backend. Timeout means unconfirmed, not necessarily unwritten.

GET returns only status/message/version, never workbook data:

```json
{"status":"ok","message":"ACM PSU event registration endpoint is live.","version":"2026-09-05.1"}
```

## Platform mirror

After the worksheet row is appended and flushed — and only then — the script
POSTs the same row to the ACM PSU platform's `event-registration-intake` Edge
Function as JSON:

```json
{
  "event": "jam26",
  "requestId": "0123456789abcdef0123456789abcdef",
  "fields": { "Timestamp": "2026-09-05T15:44:00.000Z", "Full Name": "…" }
}
```

`fields` is keyed by the exact worksheet headings above, and authorization is
the `x-registration-token` header carrying the shared secret. The endpoint is
idempotent: a registration is identified by a hash of its answers with the
timestamp excluded, so re-posting it, and a later import of the same worksheet
row, both write nothing.

This mirror is not part of the front-end contract. It is configured by Script
Properties (`PLATFORM_INTAKE_URL`, `PLATFORM_INTAKE_TOKEN`), skipped when they
are absent, wrapped so that no failure reaches the reply, and its response is
never read. The acknowledgement a participant sees is still produced solely by
the worksheet append, and `OK` continues to mean the worksheet row was written.

## Live acceptance checklist (not yet completed)

1. Jam: `ZZ Test Jam Delete Me`, ID `999000001`, email
   `999000001@psu.edu.sa`, phone `0500000000`, major `Software Engineering`,
   team `ZZ_TEST_DELETE_ME`, teammate `jam.test.member@psu.edu.sa`.
   Require server OK, exactly one row in jam26, teammate in H, then success UI.
2. Repeat Jam participant: require `this participant is already registered`,
   no added row and no success UI. If a previous failed-ack attempt already
   wrote this test identity, inspect that row before attempting a new test.
3. CTF: team `ZZ_TEST_TEAM_DELETE_ME`; captain `ZZ Test Captain`, ID
   `999000002`, email `999000002@psu.edu.sa`, phone `0500000000`, major
   `Computer Science`; member 2 `ZZ Test Member Two`, ID `999000003`, email
   `999000003@psu.edu.sa`, major `Computer Science`. Leave member 3 blank,
   choose Beginner and check rules. Require OK, exactly one row, L–O blank,
   P equal to Beginner, then REGISTRATION SAVED.
4. Fill only Member 3 Name: require the all-or-none error and no row. The
   browser blocks this before transport; a direct server test must also reject.
5. Verify anonymously in Chrome that the Google response executes within the
   iframe and the correct version replies. Local mocks cannot prove this.

For the exact Google deployment procedure, see [SETUP.md](SETUP.md).
