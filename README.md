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

## Running it

```bash
npm install
npm start           # http://localhost:3000
```

Everything is stored in the `data/` folder (SQLite database + uploaded files),
so backing up the site is just copying that one folder.

## Configuration (all optional, via environment variables)

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

Node.js + Express + SQLite (via better-sqlite3), vanilla JS frontend with no
build step. Runs anywhere Node 18+ runs — a Raspberry Pi is plenty.
