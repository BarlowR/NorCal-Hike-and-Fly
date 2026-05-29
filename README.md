# NorCal Hike & Fly

Website and scoring system for the NorCal Hike & Fly competition

## Repository Structure

```
NorCal-Hike-and-Fly/
├── site/                   # Astro frontend (public website)
├── scoring/                # Shared scoring logic (canonical source)
│   ├── hf_scoring.ts       # Main scoring pipeline
│   ├── analyze_flight.ts   # Launch/landing detection algorithm
│   ├── gpx_parser.ts       # GPX file parser
│   ├── parseFixes.ts       # Flight fix utilities
│   └── Rules.md            # Scoring rules documentation
├── tracklog_handler/
│   ├── worker/             # Cloudflare Worker (upload endpoint)
│   ├── registration-worker/ # Cloudflare Worker (pilot registration)
│   ├── src/                # Node.js processing pipeline
│   ├── tests/              # Sample tracks and labeled test cases
│   └── label_tool.ipynb    # Jupyter notebook for labeling takeoff/landing
└── email_tool/             # Bulk email sender for pilots
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
npm run preview   # optional: preview the build locally
```

The site is static and can be deployed to any static host (Cloudflare Pages, Netlify, etc.).

## Upload Worker (`tracklog_handler/worker/`)

A Cloudflare Worker that accepts tracklog uploads from pilots. It:

- Authenticates pilots via `user_id` + `passphrase` against the pilot registry stored in R2
- Accepts `.igc` and `.gpx` files (10 MB max)
- Deduplicates uploads using SHA-256 content hashing
- Rate-limits uploads to 10 per IP per minute
- Stores accepted files in R2 at `incoming/<user_id>/<timestamp>-<filename>`

### Upload rules

- Accepted file formats: `.igc`, `.gpx` (10 MB max)
- Uploads are only accepted during the contest window (April 1 – October 31, 2026)
- Tracklog date must fall within the contest window
- Rate limited to 10 uploads per IP per minute (enforced via Cloudflare KV)
- Duplicate files (same SHA-256 hash per user) are rejected silently

### Deploying the worker

```bash
cd tracklog_handler/worker
npx wrangler deploy
```

Requires a `wrangler.toml` with an R2 bucket (`tracklogs`) and KV namespace (`RATE_KV`) already configured in your Cloudflare account.

### Adding a pilot

Add an entry to the pilot registry (JSON object uploaded to R2 root as `users.json`):

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
3. Writes scored track data to `<season>/scores/tracks/<user_id>/<flight_id>.json`
4. Updates per-user flight history at `<season>/scores/users/<user_id>.json`
5. Rebuilds the leaderboard at `<season>/scores/leaderboard.json`
6. Moves processed files from `incoming/` to `processed/`

The active season defaults to `2026` and can be overridden via the `SEASON` environment variable or a `--season=<year>` argument.

### Additional pipeline commands

```bash
# Re-score all previously processed flights (e.g. after a rule change)
npm run rescore

# Re-score locally against a synced copy of R2 data (non-destructive)
npm run rescore:local

# Download processed tracks and scores from R2 to a local directory
npm run sync-local

# Back up the entire R2 bucket to a local directory
npm run backup

# Prologue data migration to prologue/ prefix
npm run archive-prologue

# (Dangerous!!) Clear all scores and leaderboard for the current season
npm run reset
```

`rescore:local` and `sync-local` require both `.env` (R2 credentials) and `.env.local` (`LOCAL_DATA_DIR`).

### Supported file formats

| Format | Notes |
|--------|-------|
| `.igc` | Standard flight recorder format |
| `.gpx` | GPS track format; altitude data required; raw GPS altitude is smoothed with a 30-second centered moving average to reduce noise |

## Testing (`tracklog_handler/`)

The `analyze_flight` launch/landing detection algorithm has a regression test suite.

### Label tool workflow

1. Drop an IGC or GPX file in `tests/tracks/`
2. Open `label_tool.ipynb` in Jupyter
3. Set `TRACK_FILE` in the Configuration cell and run all cells
4. Drag the Launch/Landing sliders to mark the correct times; verify the green/red markers on the map and altitude profile
5. Click **Save Test Case** — writes `tests/labeled/<stem>.json`
6. Run the regression tests:

```bash
npm run build && npm test
```

Tests pass if detected launch/landing times are within ±60 seconds of the labeled values.

## Email Tool (`email_tool/`)

Sends bulk emails to pilots (e.g. registration confirmations, announcements).

```bash
cd email_tool
npm install

# Preview without sending
node send_emails.js --template templates/<template>.md --dry-run

# Send
node send_emails.js --template templates/<template>.md
```

Templates are Markdown files with YAML frontmatter for the subject line. Variables like `{{username}}` and `{{passphrase}}` are substituted per pilot from the pilot registry.

Requires a `.env` file:

```
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

## R2 Bucket Layout

```
tracklogs/
├── users.json                                  # Pilot registry
├── incoming/<user_id>/<timestamp>-<file>       # Awaiting processing
├── processed/<user_id>/<timestamp>-<file>      # Already processed
├── prologue/                                   # Archived prologue data
│   ├── scores/
│   └── processed/
└── <season>/scores/                            # Per-season scored data (e.g. 2026/)
    ├── leaderboard.json                        # Competition standings
    ├── users/<user_id>.json                    # Per-pilot flight history
    └── tracks/<user_id>/<flight_id>.json       # Track data for map display
```
