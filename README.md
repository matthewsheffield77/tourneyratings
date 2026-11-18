# TourneyRatings

**tourneyratings.com** — Youth hockey tournaments, rated by the parents who
paid for them.

Parents rate tournaments on the five things they actually talk about in the
stands — **level honesty, organization, stay-to-play, facilities & refs, and
value** — alongside a tournament calendar with the facts families ask about
first (entry fees, gate fees, stay-to-play rules, when the schedule comes
out). The site launches with Southern California tournaments and the
founder's own review (Review #1: the Bell Capital Cup in Ottawa) and grows
from parent reviews.

## What's in the app

- **Homepage** — founder story, Review #1 spotlight, Top Rated by Parents
  leaderboard, featured tournaments, experience-tag definitions.
- **Tournament calendar** (`/tournaments`) — search; filters for state
  (including California-only), age group, level, stay-to-play, and
  unique-experience tags (Outdoor Ice, Pro Ice, International Field, Pond
  Hockey, Destination City); sort by date, entry fee (cheapest or most
  expensive first — unpriced listings sort last), or highest rated.
- **Find tournaments for your player** — pick your kid's age group(s) and
  level(s) and the calendar narrows to tournaments running those divisions,
  with a live match count.
- **Tournament pages** — per-criteria average scores, overall rating,
  written parent reviews, data badges (stay-to-play, gate fee, schedule
  timing), would-you-return percentage, and filming/streaming reports.
- **Rate a tournament** — the five criteria (1–5), would-you-return, a
  filming/streaming question, and a written review. Submissions save to
  Postgres and update the averages immediately.
- **Top Rated by Parents** (`/top-rated`) — the full leaderboard. Scores
  are never sold; placement is earned.
- **List Your Tournament** (`/list-your-tournament`) — organizer
  submissions, saved to the database for review before they go live.
- **Advertise** (`/advertise`) — advertising info and labeled placeholder
  house ads (also shown on the homepage).

## Stack

Deliberately boring, because this runs part-time:

- **Node.js 24 (LTS)** + **Express 4**, server-rendered pages, one small
  client script. No build step.
- **Postgres** via the `pg` package. Tables are created automatically on
  first boot, and the launch data (23 tournaments, 17 reviews, exported
  from the prototype) seeds itself only when the database is empty.
- If `DATABASE_URL` is **not** set, the app falls back to an in-memory
  copy of the seed data — **for local testing only**. Nothing persists in
  that mode. Production (Render) always sets `DATABASE_URL`.

## Run it locally

```bash
npm install
npm start          # http://localhost:3000 (in-memory data, no Postgres needed)
```

To run against a real Postgres locally, set `DATABASE_URL` (and
`DATABASE_SSL=1` if your provider requires SSL):

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/tourneyratings npm start
```

## Deploy to Render

The repo includes a `render.yaml` Blueprint that creates everything.

**Option A — Blueprint (recommended)**

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In the [Render Dashboard](https://dashboard.render.com), choose
   **New → Blueprint**, connect the repo, and select this repository.
3. Render reads `render.yaml` and proposes:
   - Web service **tourneyratings** — plan `starter` ($7/mo, always on),
     build command `npm install`, start command `npm start`.
   - Postgres database **tourneyratings-db** — plan `basic-256mb`
     ($6/mo compute), with `DATABASE_URL` wired into the web service
     automatically.
4. Click **Apply**. The first deploy takes a few minutes; the app creates
   its tables and seeds the launch data on first boot.
5. Open the service URL (`tourneyratings.onrender.com`) and check the
   homepage and a tournament page.

**Option B — Manual**

1. Dashboard → **New → PostgreSQL**: name `tourneyratings-db`, plan
   **Basic 256 MB**, region **Oregon**. Create it.
2. Dashboard → **New → Web Service**: connect the repo, runtime **Node**,
   build command `npm install`, start command `npm start`, plan
   **Starter**, region **Oregon** (same region as the database).
3. In the web service's **Environment**, add `DATABASE_URL` and paste the
   database's **Internal Database URL**. Add `NODE_ENV=production`.
4. Deploy.

**Cost note (checked 2026-11-17):** since Render's April 2026 pricing
change, Postgres storage is billed separately at $0.30/GB/mo, and a new
Basic database can start with up to 15 GB (~$4.50/mo). Budget roughly
**$17–18/mo total** ($7 web + $6 database compute + ~$4.50 storage), plus
any bandwidth over the free Hobby workspace's included 5 GB at $0.15/GB —
a few dollars at launch traffic. Comfortably inside the $20–60/mo
envelope. Do **not** use Render's free web or free Postgres tiers for the
live site: free web services sleep when idle, and free Postgres databases
are deleted after 30 days.

## Point tourneyratings.com at Render (DNS at Porkbun)

Do this after the Render deploy is live.

1. In Render: open the **tourneyratings** web service → **Settings →
   Custom Domains** → add `tourneyratings.com` and `www.tourneyratings.com`.
   Render shows the exact values to use; as of this writing they are:
   - Root domain: an **A record** pointing to the IP Render displays
     (Render shows `216.24.57.1` for root domains).
   - `www`: a **CNAME record** pointing to your service's
     `*.onrender.com` hostname.
2. In Porkbun: open **tourneyratings.com → DNS** and:
   - **Delete** Porkbun's default parking records (the parked-page A/CNAME
     records on the root and `www`) and any URL-forwarding records for the
     root/`www`.
   - Add the **A record** for the root (`@`) with Render's IP.
   - Add the **CNAME record** for `www` with the Render hostname.
   - Leave any MX/TXT records alone (they're for email).
3. Wait for DNS to propagate (usually minutes, up to a few hours). Render
   verifies the domain and issues the HTTPS certificate automatically.

> If the values Render shows at setup differ from the ones above, use
> Render's — theirs are current.

## Environment variables

| Variable        | Required | Notes                                                                 |
| --------------- | -------- | --------------------------------------------------------------------- |
| `DATABASE_URL`  | Yes (production) | Postgres connection string. Wired automatically by the Blueprint. Without it, the app uses the non-persistent in-memory fallback (local testing only). |
| `PORT`          | No       | Set automatically by Render. Defaults to `3000` locally.               |
| `NODE_ENV`      | No       | Set to `production` by the Blueprint.                                  |
| `DATABASE_SSL`  | No       | `1` forces SSL for the Postgres connection (needed for external Render URLs; internal URLs work without it). |

## Housekeeping notes

- **Organizer submissions** land in the `organizer_submissions` table and
  are not published automatically — review them in the database (any SQL
  client with the external `DATABASE_URL`) and add approved tournaments
  to the `tournaments` table.
- **The Advertise page** lists `advertise@tourneyratings.com`. Set up
  email forwarding for that address at Porkbun (Email → forwarding) so
  inquiries reach a real inbox.
- Seed data lives in `lib/seed.js` and is only inserted into an empty
  database. Once the site is live, the database is the source of truth —
  editing `lib/seed.js` will not change live data.
