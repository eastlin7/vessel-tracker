# Strait Tracker

Real-time vessel tracking across the Persian Gulf and Strait of Hormuz. Ships are color-coded by geopolitical alignment and tracked over time with historical snapshots.

## Features

- Interactive dark-themed map centered on the Persian Gulf
- Vessels color-coded by geopolitical alignment (US-aligned, EU-aligned, China-aligned, non-aligned)
- Historical snapshots — sync vessel positions and compare how traffic changes over time
- Movement trails showing ship paths between snapshots
- Click any vessel for details (flag, alignment, speed, MMSI)
- Password-protected sync to conserve API quota

## Tech Stack

- **Next.js** (App Router) on Vercel
- **MapLibre GL JS** for GPU-accelerated map rendering
- **Vessel API** for AIS vessel position data
- **Vercel Blob** for persistent snapshot storage
- **Stadia Maps** dark tiles

## Setup

```bash
npm install
```

Create `.env.local`:

```
VESSEL_API_KEY=your_vessel_api_key
SYNC_TOKEN=your_sync_password
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

```bash
npm run dev
```

## Deployment

Deploy to Vercel and set the environment variables above. The `BLOB_READ_WRITE_TOKEN` is created automatically when you add a Blob store to your project via the Vercel dashboard (Storage > Create > Blob).

## Configuration

- `data/alignments.json` — edit to reclassify country alignments
- Sync is rate-limited by the Vessel API quota (~150 requests/month)

## Author

Emil
