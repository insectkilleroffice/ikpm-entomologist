# IKPM Entomologist Portal

Next.js 16 app for entomologists: verify completed jobs, read site reports, lodge complaints,
request revisits / inspections, keep their own site inspections (visits, findings, fixed / not fixed),
follow admin-scheduled meetings, calendar and notifications.

It is **one page**, built like the Operations visit planner: filter sidebar · calendar ·
selected-day panel (with your work summary and the selected site), and a slide-in drawer for
everything else — job verification (Verify / Reject / Request Revisit / Lodge Complaint), PCO
reports and photos, site reports, complaints, requests, meetings, lists and notifications.
The open drawer is kept in the URL (`/?open=job_<id>`), and old record links such as
`/jobs/<id>` (used in notifications) redirect there.

## UI only — no data

This version is **just the UI**: no database, no backend, no sample data.

- Every screen shows its empty state ("No …" / "You're all caught up"). Data access is one stub in
  `lib/client-data.ts`: every query resolves empty. Connect a real data source there.
- Forms still validate and show their field errors and success messages (`app/actions.ts`), but nothing is saved.
- The sign-in screen accepts any email and password; *Sign out* returns to it.

## Run

`npm install` · `npm run dev` · `npm run lint` · `npm run build`

## Site inspections (visits + findings)

- **Record visit** (site card, site report, a finding, or the gap report) turns the branch's gap report into
  the visit form: date, pest activity, notes and photos on top, a *This visit* column to mark each open finding
  *Open* / *Closed*, and new finding rows typed into their section. *Save visit* stores the visit: date (today or earlier), pest activity, notes, photos.
- On the same visit the entomologist marks each of the site's **open findings** *Fixed* (closes it) or
  *Not fixed* (stays open, counted), with a note — and adds
  **new findings** (area, severity, description, photos).
- The *Findings* tile lists **clients → branches** (open / closed counts, last visit). A branch opens its
  **gap report**: findings grouped by category (Structural gap…) with S.No, department, location, observation,
  photos, risk, recommendation, a status column per **visit** (New / Open / Closed / Not checked), gap
  classification (Low / Moderate / High / Severe) and responsibility — printable (A4 landscape) or save as PDF.
- Site report shows the **last visit**, open findings count, and *Findings* / *Visits* tabs; a finding
  opens with its full history (found → each check). *My site visits* also appear on the calendar.
