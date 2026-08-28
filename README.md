# acm-psu-website

Official website of the ACM Club at Prince Sultan University — showcasing our members, projects, events, and history.

**Live:** https://acm-psu.shoug-tech.com/

## Stack

Plain HTML, CSS, and JavaScript. No build step, no dependencies, no framework. Open any `.html` file in a browser and it works.

## Layout

```
index.html            Home — hero, focus areas, team preview, work, archive timeline
team.html             Full roster — executive council + general assembly
projects.html         Project archive with category filters and live search
join.html             Membership application form + FAQ
404.html              Not-found page

assets/css/main.css   All styles, shared across every page
assets/js/main.js     Scroll reveals, mobile nav, footer clock (all pages)
assets/js/projects.js Category tabs + search (projects page)
assets/js/join.js     FAQ accordion + form submission (join page)
assets/img/           Logos

design-template/      Original design mockups. Reference only — not deployed.
CNAME                 Custom domain for GitHub Pages
```

## Local development

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. A plain server is needed rather than opening the
files directly so that root-relative paths behave the same as in production.

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`, which stages the
repo (minus `design-template/` and CI files) and publishes it to GitHub Pages.

One-time setup in the GitHub repo settings:

1. **Settings → Pages → Build and deployment → Source:** select **GitHub Actions**.
2. **Settings → Pages → Custom domain:** enter `acm-psu.shoug-tech.com`, then tick
   **Enforce HTTPS** once the certificate finishes provisioning.
3. Add this DNS record at the `shoug-tech.com` registrar:

   | Type  | Name      | Value                        |
   |-------|-----------|------------------------------|
   | CNAME | `acm-psu` | `shoug-alomran.github.io.`   |

## Editing content

Content lives directly in the HTML — there is no CMS.

- **Add a team member:** copy a `.member-card` block in `team.html`.
- **Add a project:** copy a `.case-study-card` block in `projects.html` and set
  `data-category` to one of `ai-jam`, `cyber`, `hackathon`, or `systems` so the
  filter tabs pick it up.
- **Add an archive year:** copy a `.timeline-row` in `index.html`.

Placeholder names and Unsplash portraits are carried over from the design
mockups — swap them for real people and photos before announcing the site.

## Membership form

GitHub Pages serves static files only, so the form has no server to post to. Set
`FORM_ENDPOINT` at the top of `assets/js/join.js` to a form backend that accepts
a POST and returns CORS headers (Formspree, Basin, Getform, a Google Apps Script
web app, ...). Until that is set, the form tells applicants to email instead of
silently discarding submissions.
