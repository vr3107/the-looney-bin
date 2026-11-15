# The Looney Bin

A static job-search and application-tracking workspace. The interface is split into HTML, CSS, and ordered JavaScript files so the app is easier to maintain.

## Run locally

No build step is required. From this directory, run:

```sh
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

## Project layout

- `index.html` — page structure and ordered script loading
- `styles.css` — application styles
- `js/` — app behavior, job search, resume library, matching, tailoring, DOCX export, and application history

The app keeps its existing browser storage identifiers so saved resumes and applications in the current browser remain available after the source is split. Resume and application records are stored in that browser; they are not committed to this repository.

## Downloading the tailored resume

**Download .docx** always builds the tailored resume on your original Word file, so it keeps the same layout: centered name and contact line, bold labels (e.g. Core Competencies), bullets, spacing, fonts, and job titles with dates on the right. Only the changed text is replaced.

- If the resume was uploaded as a .docx, that file is used automatically. A resume added as text (e.g. “Primary resume”) uses an uploaded .docx with the same name line at the top.
- If no original .docx is found, the app asks you to choose it once and remembers it for that resume. You can instead download a standard layout that follows the usual resume pattern (centered header, bold headings and labels, bullets, right-aligned dates).
- **Download .pdf** builds a fresh PDF from the tailored text in the usual resume layout (centered name and contact line, ruled headings, bold labels, job titles with location and dates on the right, wrapped bullets), using the original PDF's margins, font family, and size when the resume came from a PDF. Nothing is drawn over the old PDF, so there is no hidden old text for an ATS to read, and nothing runs past the margins.
- A PDF is read as visual lines, so wrapped lines are joined back into whole bullets and paragraphs before tailoring; the AI rewrites complete bullets.
- AI rewrites of experience and project bullets must still describe the same work as your original bullet; a rewrite that swaps in different work is held for your review instead of being applied.

## Tailoring for a different field

When the job is in a different field from your resume (for example a data center resume for a Data Engineer or SAP job: the job's title isn't in your resume and most of its skills aren't), the AI re-targets the whole resume instead of polishing it for your old field:

- **Skills**: categories are renamed and regrouped for the new job, skills the job has no use for (e.g. cabling, subnetting, Cisco IOS for a data engineering job) are removed, and skills you select under “Skills this job wants” get their own correctly named category at the top (e.g. “Programming: Python, SQL”).
- **Summary**: positions you for the target role with your transferable strengths, without claiming years in the new field.
- **Bullets**: each is reframed around the part of your real work the job values (automation, documentation and record accuracy, troubleshooting, SLAs, change management, stakeholders); bullets with nothing transferable can be dropped, but every role keeps at least two. Job titles, employers, and dates never change, and no work is invented.
- Bullets keep their tense: present for your current role, past for earlier ones.

## AI providers

AI tailoring and cover letters (`functions/api/tailor.js`) try these in order. A provider without a key is skipped, and the next one is used if a provider fails or is out of quota:

| Order | Provider | Set in Cloudflare Pages → Settings → Variables and Secrets |
| --- | --- | --- |
| 1 | Groq (free tier) | Secret `GROQ_API_KEY`; optional `GROQ_MODEL` (default: Qwen 3.8 27B, then GPT-OSS 120B) |
| 2 | Cloudflare Workers AI | The `AI` binding in `wrangler.toml` (free: 10,000 neurons a day, reset at 00:00 UTC) |

Add keys as **Secret** (encrypted) for both Production and Preview. Secrets only apply to new deployments: after adding or changing one, redeploy (Deployments → latest → Retry deployment, or push a commit). To check which provider is answering, look at the `model` field of an `/api/tailor` response (`groq:…` or `cloudflare:…`). Never put keys in this repository or in the browser code. When every provider is out of quota, the page says so.

## Where jobs come from

**Find jobs** searches all of these together and ranks every posting against your resume:

| Source | How | Setup |
| --- | --- | --- |
| **Company career sites** | Each company's own job board, through the public APIs of the hiring systems they use: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee. Read directly by your browser. | None. 53 well-known companies are included (Stripe, Airbnb, Databricks, OpenAI, Snowflake, Waymo, DoorDash, …). |
| **Job index** (about 1.2 million US jobs from company career sites on Greenhouse, Lever, Ashby, Workday, iCIMS, BambooHR and Paylocity) | A daily index built by `.github/workflows/jobs-index.yml` from the public dataset of [Riley-Dorrington/job-board-aggregator](https://github.com/Riley-Dorrington/job-board-aggregator) (MIT licensed) and published to the Cloudflare Pages project `looney-bin-jobs`. A search downloads only the file for the least common word in each role (usually under 1 MB). Each job links to its official posting. | GitHub repository secrets `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID` for the daily workflow |
| Dice | Dice's job search service (`/api/dice-search`) | None |
| The Muse | Public API, read by the browser | None |
| Jobicy, Arbeitnow, Remote OK, Remotive | Public remote-job feeds, read by the browser | None |
| Himalayas | Public remote-job API, through `/api/boards` | None |
| Jooble | Job aggregator, through `/api/boards` | Free key at jooble.org/api/about → Cloudflare secret `JOOBLE_API_KEY` |
| **Google Jobs** (includes postings from LinkedIn, Indeed, Dice, ZipRecruiter, Glassdoor) | Google's job listings through SerpApi, `/api/boards`; one search per job search, cached 6 hours. Each card links to every board the posting is on, and the LinkedIn / Indeed / Dice board filters show them. | Free plan (250 searches/month, no card) at serpapi.com → Cloudflare secret `SERPAPI_API_KEY` |
| LinkedIn, Indeed, ZipRecruiter, Google Jobs | No public jobs API (LinkedIn's is partner-only, and scraping breaks their terms); links open the same search on their sites with your filters applied (posting age, remote/hybrid/on-site, job type, level, newest first) | — |

Also searched automatically: **Hacker News "Who is hiring?"** (this month's thread of direct-from-company posts, via HN's public Algolia search; no key) and **USAJOBS** (US federal jobs; free key at developer.usajobs.gov → Cloudflare Secrets `USAJOBS_API_KEY` and `USAJOBS_EMAIL`, the email you registered with).

**Paste search results:** on Dice, LinkedIn, Indeed or any job site's search results, press Ctrl/⌘+A then Ctrl/⌘+C and paste into the box under **Save jobs from Dice, LinkedIn & Indeed**. Every job on the page comes in with its official link, company, location, salary and posting date; you confirm before they're saved.

**Save to Looney Bin button:** on Find jobs, open **Save jobs from Dice, LinkedIn & Indeed** and drag the green button to your bookmarks bar. While browsing Dice, LinkedIn, Indeed, ZipRecruiter or Glassdoor (signed in, any filters), click it: on a search-results page it saves every job listed, on a posting it saves that job with its full description. The Looney Bin opens, shows the jobs, and saves the ones you keep. It only reads the page you're viewing, only when you click it.

**Company autocomplete:** start typing a company name in **Company career sites** and pick it from 15,000+ companies with public Greenhouse, Lever or Ashby job boards (`data/company-directory.json`, from [Riley-Dorrington/job-board-aggregator](https://github.com/Riley-Dorrington/job-board-aggregator), MIT licensed; see `data/company-directory.LICENSE`). If a company is listed on more than one system, the one with open jobs is used.

**Following more companies:** open **Company career sites** on the Find jobs page and paste a company's careers page link (e.g. `boards.greenhouse.io/figma`, `jobs.lever.co/…`, `jobs.ashbyhq.com/…`, or the company's own careers page — the app finds the hiring system it uses) or type the company name. Remove any company with ×. Companies on Workday or their own custom systems (e.g. Microsoft, Amazon) don't offer a public jobs feed.

For Greenhouse and SmartRecruiters, descriptions are fetched for the 200 best title matches; any other posting loads its description when you open it.

## Cloudflare Pages

This is a static site. In Cloudflare Pages, connect this GitHub repository, select no framework, leave the build command empty, and set the output directory to the repository root (`.`). Each push to the connected branch can then publish the site.

No API credentials belong in these frontend files. For future AI features, put provider credentials in a server-side Cloudflare Worker secret and call that Worker from the app.

## ATS match score

Every match % in the app (search cards, tracker, job details, tailoring) is an ATS-style score computed in `js/ats-score.js`:

| Part | Weight | What it checks |
| --- | --- | --- |
| Required skills | 40 | Skills and tools named in the job (required ones count double, preferred ones less) found in the resume |
| Job keywords | 20 | The job's most repeated terms (verb forms match: built/build, deployed/deploy) |
| Job title | 15 | The job's core title (without Senior/Lead/etc.) appears in the resume |
| Years of experience | 10 | Years from date ranges or stated years vs. the job's requirement |
| Education | 5 | Degree level vs. the job's requirement |
| ATS-friendly format | 10 | Email, Experience/Skills/Education sections, bullets, length |

## Tailoring a resume

Open a saved job and choose **Update resume for this job**. The tailoring page shows:

- **Before / After** ATS scores side by side, with a bar for each part of the score that updates as you edit.
- **Skills this job wants**: green skills are already in your resume; tap a yellow skill only if you genuinely have it, and it will be added to the matching Skills line (e.g. Kubernetes → “Cloud & tools”).
- **Tailor**: with AI enabled, the resume is rewritten for the job (summary, experience and project bullets, skills) using the job's exact title and keywords where your experience supports them; then ATS fixes add the job's title as a headline when needed and add your confirmed skills. The AI reads the job description and the role (the job title plus any target role on the job or resume) and rewrites the summary and every experience and project bullet in the job's own wording, not just the skills. Verified changes are applied automatically and listed under **Changes**, where any one can be undone. A rewrite is held for your review only if it claims a tool or required skill that isn't in your resume (and you haven't tapped it under “Skills this job wants”), or names something that appears in neither your resume nor the job. Without AI, **Apply quick ATS fixes** adds the title and confirmed skills only.
- **Target ATS score** (90%+ by default, or 95%+): the tailored resume always aims for 90–100%, and never lower than your original resume's score (a resume already at 93% stays at 93% or higher). With AI, tailoring runs up to 3 rounds (each can take up to about 2 minutes with the live AI): after each round the page re-scores the draft and sends what's still missing (exact title, job keywords, confirmed skills) back to the AI, until the target is reached or no further progress is possible.
- Any single change that would lower the ATS score is left out (listed under **Changes**, where you can still apply it), so tailoring never ends below the original score.
- The final **tailored resume ATS score** is shown in the After card and the status line; once saved, that score is what the job shows in the tracker.
- **Missing skills pick-list**: under “Skills this job wants”, every job skill missing from your resume is listed (required ones are marked). Select the ones you have experience with, or **Add all** / **Clear**; the page shows the estimated ATS score with your selection and with all of them. Press **Update resume with selected skills** and they are added to your Skills section and worked into your summary and bullets. Skills you don’t select are never added.

Every AI edit is checked first: contact details, headings, job titles, company/date lines and education are never changed; edits that add numbers not in your resume are discarded; edits that mention a skill you haven't confirmed are flagged for review instead of applied; and for PDFs, rewrites too long for their line are flagged.

Downloads keep the original file's formatting. **.docx** edits your original Word file in place (only the changed characters are rewritten, so fonts, sizes, bold/italic, tabs and bullet numbering are preserved, and added bullets are cloned from the bullet above). **.pdf** keeps your original PDF pages and redraws only edited lines at the same position and size with the closest standard font. **Save for this job** stores the tailored version with the job.

## Cover letters

From a job's details (or the tailoring view), choose **Draft cover letter** / **Write cover letter**. Pick the resume version (original or a job-specific tailored version), tone, and length, optionally add a hiring manager and true details, then **Write with AI** (or **Quick draft** without AI). Facts in the letter that don't appear in your resume or notes are flagged for review. Save the letter to the job, copy it, or download it as DOCX (built inside your resume's Word document, so it uses the same fonts, size, and margins), PDF (matching your resume's font style and size), or TXT.

## AI setup

AI tailoring and cover letters call the Pages Function `functions/api/tailor.js`, which uses a Workers AI binding named `AI`. The binding is declared in `wrangler.toml`, so Cloudflare Pages attaches it automatically on every deploy from GitHub — no dashboard setup is needed. (Because `wrangler.toml` is present, Pages treats it as the source of truth for bindings and environment variables; add any future bindings there.) The function tries Qwen 3.8 27B first, then GPT-OSS 120B, then Llama 3.3 70B if a model is unavailable. Requests are sent only after you allow AI once in the app; nothing is stored on a server. Workers AI usage counts against Cloudflare's free daily allocation, then metered pricing.

## Job search sources

The browser ranks jobs from the configured public feeds and calls `functions/api/dice-search.js` for Dice listings. Dice's MCP search supports paged results; the app requests up to three pages per entered role and stores the returned direct posting URL on each result. Dice postings appear in the ranked results with an **Open Dice posting** button (or a **Dice posting** button when the same job also came from another feed). When Dice's service returns an error or no postings, a Dice card at the top of the results links to the same search on dice.com for each entered role, carrying the location, remote/hybrid, and posting-age filters. LinkedIn does not expose an open job-listing feed for this app, so the search page provides per-role links into LinkedIn's own job search instead of scraping its listings. Indeed, ZipRecruiter, and Google Jobs are also available as targeted external searches. Source links on imported result cards point to the specific posting where the feed supplies one.

## Resumes: DOCX and PDF

Upload resumes as Word (.docx) or text-based PDF files. The original file is stored unchanged in the browser and can be downloaded again at any time. PDF text is rebuilt from the page layout, so line breaks, indentation, and the spacing between columns (for example, right-aligned dates) are kept. Tailored versions of a PDF resume download as PDF, DOCX, or TXT with that spacing intact; the original PDF's fonts and graphics are not reproduced. Scanned, image-only PDFs can't be read.

## Find page filters

The main search accepts job titles or company names, separated by commas; company-name hits are labeled **Company match** and rank with direct role matches. Matching is whole-word (so "AI" no longer matches "maintenance"), understands common abbreviations and synonyms (ML / machine learning, Sr. / Senior, SDE / software engineer, BI / business intelligence), ignores company suffixes (Inc, LLC), and tolerates small typos. Related titles (for example, Machine Learning Engineer for a Data Scientist search) rank after direct matches. Put a title in "quotes" to require it exactly, and prefix a word with - to exclude titles containing it. The matching logic lives in `js/search-relevance.js`. The filter row sits directly under the search bar. Results can be narrowed by job board (all boards or a single board), years of experience required, workplace (remote, hybrid, on-site), job type, experience level, posting age, and match score, plus a title/company search. Workplace, job type, level, and years are read from each posting's location, tags, and description, so postings that don't state them are excluded when that filter is set. Jobs can be hidden from results and viewed again under **Hidden jobs**.

## Accounts

Everyone signs in, and each person's profile, jobs, resumes, tailored versions and original resume files are private to their account.

- **Pages:** `/signin` and `/signup` (`signin.html`, `signup.html`, `auth.css`, `js/auth-pages.js`). The app (`index.html`) sends signed-out visitors to `/signin`.
- **Sign-up modes:** the first account created becomes the **owner**. After that sign-up is invite-only: the owner creates invite codes under the account menu → **Invite people**, and can switch sign-up to **Anyone (public)** or **closed** there.
- **Sign-in methods:** email + password, and Google sign-in once `GOOGLE_CLIENT_ID` is set in `wrangler.toml` (create an OAuth “Web application” client in Google Cloud with `https://the-looney-bin.pages.dev` as an authorized JavaScript origin).
- **Storage:** a Cloudflare D1 database bound as `DB` in `wrangler.toml`. Tables are created automatically on first use (`functions/_lib/core.js`). Data is stored one row per job/resume (`/api/state`); original DOCX/PDF files up to 1.9 MB are stored in `/api/files/:id`.
- **Sync:** the app keeps a copy in the browser for speed and saves changes to the account about a second after each change (`js/account-sync.js`). Signing in on another device loads everything; signing out removes the browser copy.
- **Moving old data:** data saved in a browser before accounts existed is moved into the first new account that signs in from that browser.
- **Account menu** (top-right avatar): change name or password, download a copy of your data, delete your account, sign out.

### Security

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations, per-user salt); minimum 10 characters.
- Sessions are random 256-bit tokens stored hashed, in an `HttpOnly; Secure; SameSite=Lax; __Host-` cookie, valid 30 days. Changing the password signs out other devices.
- Every `/api` request that changes data must come from the site itself (Origin check) and be JSON; everything except sign-in/sign-up requires a session, including AI tailoring and job-board lookups.
- Rate limits: sign-in 8 attempts per email and 30 per IP per 10 minutes; sign-up 10 per IP per hour; AI 60 requests per person per day (`AI_DAILY_LIMIT`).
- Every query is scoped to the signed-in user's id; size limits apply to every request, item and file.
- `_headers` sets a Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy and Permissions-Policy. Uploaded files are only ever served as downloads.
- Values from job feeds are escaped before display; ids are strictly encoded inside click handlers, and `javascript:`/`data:` links are blocked.
- **Confidentiality, integrity, availability:**
  - *Confidentiality* — each account's data is readable only with that account's session; the admin manages access (invites, suspend/restore) but has no way in the app to open anyone else's resumes, jobs or files.
  - *Integrity* — every change is validated and tied to the signed-in user; each account has a sign-in activity log (sign-ins, failed attempts, password changes) and can sign out all other devices.
  - *Availability* — a copy is kept in the browser so the app works through connection drops and retries saving; anyone can download their data; the admin account can't be suspended or deleted while others exist.
- The first account is the **admin** (stored as role `owner`).
- Not yet included: “forgot password” emails (needs an email-sending service).
