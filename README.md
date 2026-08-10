# PetLife 🐾

A private family website for our pets — a photo/video timeline, medical records,
and important-date reminders. Built for Umi, Goochi, and in loving memory of Chombly. 🌈

## What it does

- **Timeline** — post memories with photos and videos, tagged to one or more pets.
  Photos are **compressed in the browser before upload** (resized to 2000px,
  re-encoded as WebP), so a 6 MB phone photo becomes a few hundred KB.
  Videos are **not stored here at all**: upload them to your own unlisted YouTube
  channel from your phone, paste the link into a post, and the site embeds the
  player. YouTube pays for the bandwidth, forever, for free.
- **Pet profiles** — birthdate, gotcha day, breed, photo, and a memorial mode
  (set a "passed away" date) so pets who've crossed the rainbow bridge stay on
  the timeline with a 🌈 badge.
- **Medical records** — per pet: vaccinations (with due dates), vet visits,
  medications, a weight log, and document uploads (PDFs, photos of paperwork).
- **Reminders** — the home page shows what's coming up: vaccine boosters due,
  birthdays, gotcha-day anniversaries, and any custom important dates
  (one-time or yearly).

## Two ways to run it

The site has **one frontend and two interchangeable backends** that speak the
same API:

1. **Cloudflare Workers** (`worker/` + `wrangler.jsonc`) — serverless, free
   tier, no machine to maintain. Database is Cloudflare D1 (SQLite), media
   lives in R2 and is served through the Worker so it stays password-gated.
2. **Node.js self-hosted** (`server.js` + `src/`) — Express + SQLite on any
   machine (a Raspberry Pi is plenty). This is the escape hatch: the code is
   already here and maintained, so leaving Cloudflare later is a data export,
   not a rewrite.

### Deploying to Cloudflare (current setup)

```bash
npm install
npx wrangler login                       # opens browser, one time
npx wrangler d1 create petlife           # copy the printed database_id
#   → paste it into wrangler.jsonc (d1_databases[0].database_id)
npx wrangler r2 bucket create petlife-media
npm run db:migrate                       # creates the tables in D1
npx wrangler secret put SITE_PASSWORD    # the shared family password
npx wrangler secret put SESSION_SECRET   # any long random string
npm run deploy                           # → https://petlife.<your-subdomain>.workers.dev
```

Free-tier headroom: 100k requests/day, 5 GB D1, 10 GB R2 — a family photo
site won't dent any of it. To develop locally against a simulated
Cloudflare: copy `.dev.vars.example` to `.dev.vars`, run
`npm run db:migrate:local`, then `npm run dev:worker`.

### Running self-hosted instead (the Pi plan)

```bash
npm install
npm start           # http://localhost:3000
```

Everything is stored in the `data/` folder (SQLite database + uploaded files),
so backing up the site is just copying that one folder.

**Moving off Cloudflare later:** export the database with
`npx wrangler d1 export petlife --remote --output=dump.sql`, import it into
`data/petlife.db` with the `sqlite3` CLI, download the R2 bucket's objects
into `data/uploads/` (rclone or `wrangler r2 object get`), and `npm start`.
The media URLs in the database (`/media/...`) are the same in both backends,
so no rewriting is needed.

## Configuration for self-hosting (all optional, via environment variables)

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `SITE_PASSWORD` | Set this to require a shared family password to view the site. **Set it if the site is reachable from the internet.** |
| `DATA_DIR` | Where the database and uploads live (default `./data`) |

### Cloudflare R2 (optional cloud storage)

By default uploads are saved to local disk, which is perfect when the site runs
on a home server or a VPS with disk space. If you'd rather keep media in
Cloudflare R2 (10 GB free, no bandwidth charges), set all five of these and
uploads will go there instead:

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=petlife
R2_PUBLIC_URL=https://media.example.com   # the bucket's public/custom domain
```

At ~300 KB per compressed photo, the free 10 GB holds roughly 30,000 photos.

## The video story

Storing video ourselves is the one thing that would blow up storage costs, so
we don't. The workflow:

1. Take the video on your phone.
2. Upload it to the family's **unlisted** YouTube channel via the YouTube app
   (unlisted = only people with the link can see it; note that "private"
   videos can't be embedded, so unlisted is the right setting).
3. Paste the link into a new PetLife post.

The site extracts the video ID and embeds the privacy-enhanced
(`youtube-nocookie.com`) player in the timeline.

## Tech

Vanilla JS frontend with no build step, shared by both backends:

- **Workers backend**: Hono + D1 + R2 bindings (`worker/`)
- **Node backend**: Express + better-sqlite3 + local disk or R2 via S3 API
  (`server.js`, `src/`) — runs anywhere Node 18+ runs; a Raspberry Pi is plenty.
