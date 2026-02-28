# NorCal Hike & Fly

Website and scoring system for the NorCal Hike & Fly competition

## Repository Structure

```
NorCal-Hike-and-Fly/
├── site/                   # Astro frontend (public website)
├── scoring/                # Shared scoring logic (canonical source)
│   ├── hf_scoring.ts       # Main scoring pipeline
│   ├── analyze_flight.ts   # Launch/landing detection algorithm
│   └── gpx_parser.ts       # GPX file parser
├── tracklog_handler/
│   ├── worker/             # Cloudflare Worker (upload endpoint)
│   └── src/                # Node.js processing pipeline
└── users.json              # Pilot registry (passphrase + category)
```

The `scoring/` directory contains the canonical shared code. Both `site/src/ts/` and `tracklog_handler/src/` reference it via symlinks so the scoring logic stays in sync across the browser and server environments.

## Site (`site/`)

Built with [Astro 5](https://astro.build) and Tailwind CSS. Pages:

- `/` — Home (events, about, scoring tool)
- `/leaderboard` — Live competition standings
- `/flights?user=<id>` — Individual pilot flight history with map

### Running locally

```bash
cd site
npm install
npm run dev
```

### Building for deployment

```bash
cd site
npm run build
```

The site is static and can be deployed to any static host (Cloudflare Pages, Netlify, etc.).

## Upload Worker (`tracklog_handler/worker/`)

A Cloudflare Worker that accepts tracklog uploads from pilots. It:

- Authenticates pilots via `user_id` + `passphrase` against `users.json` stored in R2
- Accepts `.igc` and `.gpx` files (10 MB max)
- Deduplicates uploads using SHA-256 content hashing
- Rate-limits uploads to 10 per IP per minute
- Stores accepted files in R2 at `incoming/<user_id>/<timestamp>-<filename>`

### Deploying the worker

```bash
cd tracklog_handler/worker
npx wrangler deploy
```

Requires a `wrangler.toml` with an R2 bucket (`tracklogs`) and KV namespace (`RATE_KV`) already configured in your Cloudflare account.

### Adding a pilot

Add an entry to `users.json` (upload to R2 root as `users.json`):

```json
{
  "alice": { "passphrase": "secret123", "category": "open" },
  "bob":   { "passphrase": "secret456", "category": "sport" }
}
```

## Processing Pipeline (`tracklog_handler/src/`)

A Node.js script that processes uploaded tracklogs and updates scores. Run manually or on a cron schedule.

```bash
cd tracklog_handler
npm install
npm run build
npm run process
```

The script:
1. Lists files in `incoming/` in R2
2. Scores each tracklog (IGC or GPX)
3. Writes scored track data to `scores/tracks/<user_id>/<flight_id>.json`
4. Updates per-user flight history at `scores/users/<user_id>.json`
5. Rebuilds the leaderboard at `scores/leaderboard.json`
6. Moves processed files from `incoming/` to `processed/`

### Supported file formats

| Format | Notes |
|--------|-------|
| `.igc` | Standard flight recorder format |
| `.gpx` | GPS track format; altitude data required; raw GPS altitude is smoothed with a 30-second centered moving average to reduce noise |

## R2 Bucket Layout

```
tracklogs/
├── users.json                          # Pilot registry
├── incoming/<user_id>/<timestamp>-<file>   # Awaiting processing
├── processed/<user_id>/<timestamp>-<file>  # Already processed
└── scores/
    ├── leaderboard.json                # Competition standings
    ├── users/<user_id>.json            # Per-pilot flight history
    └── tracks/<user_id>/<flight_id>.json   # Track data for map display
```
