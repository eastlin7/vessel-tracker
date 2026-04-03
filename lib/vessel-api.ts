import { put, list } from "@vercel/blob";
import { lookupFlag } from "./mid-to-country";
import alignments from "../data/alignments.json";
import shadowFleetData from "../data/shadow-fleet.json";

// Build MMSI lookup for shadow fleet vessels
const shadowFleetByMMSI = new Map<
  string,
  { name: string; imo: string; sanctioners: string[] }
>();
for (const v of shadowFleetData.vessels) {
  if (v.mmsi) {
    shadowFleetByMMSI.set(v.mmsi, {
      name: v.name,
      imo: v.imo,
      sanctioners: v.sanctioners,
    });
  }
}

const API_BASE = "https://api.vesselapi.com/v1";
const BLOB_PREFIX = "strait-tracker";

// Expanded coverage: Persian Gulf + Strait of Hormuz + Gulf of Oman + Arabian Sea approaches
// Max span per request: |dLat| + |dLon| <= 4 degrees, so 2x2 tiles
const TILES = [
  { latBottom: 25.0, latTop: 27.0, lonLeft: 54.0, lonRight: 56.0 },
  { latBottom: 25.0, latTop: 27.0, lonLeft: 56.0, lonRight: 58.0 },
  { latBottom: 25.0, latTop: 27.0, lonLeft: 52.0, lonRight: 54.0 },
  { latBottom: 27.0, latTop: 29.0, lonLeft: 48.0, lonRight: 50.0 },
  { latBottom: 27.0, latTop: 29.0, lonLeft: 50.0, lonRight: 52.0 },
  { latBottom: 27.0, latTop: 29.0, lonLeft: 52.0, lonRight: 54.0 },
  { latBottom: 23.0, latTop: 25.0, lonLeft: 56.0, lonRight: 58.0 },
  { latBottom: 23.0, latTop: 25.0, lonLeft: 58.0, lonRight: 60.0 },
  { latBottom: 25.0, latTop: 27.0, lonLeft: 58.0, lonRight: 60.0 },
  { latBottom: 23.0, latTop: 25.0, lonLeft: 54.0, lonRight: 56.0 },
];

export interface VesselData {
  mmsi: number;
  imo: string;
  name: string;
  lat: number;
  lon: number;
  sog: number;
  heading: number;
  navStatus: string;
  flagCountry: string;
  flagEmoji: string;
  timestamp: string;
}

export interface CachedData {
  fetchedAt: string;
  vessels: VesselData[];
}

export interface SnapshotMeta {
  id: string;
  fetchedAt: string;
  count: number;
  url: string;
}

function getAlignment(country: string): string {
  const val = (alignments as Record<string, unknown>)[country];
  return typeof val === "string" ? val : "yellow";
}

async function fetchTile(
  apiKey: string,
  tile: (typeof TILES)[0]
): Promise<VesselData[]> {
  const vessels: VesselData[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      "filter.latBottom": tile.latBottom.toString(),
      "filter.latTop": tile.latTop.toString(),
      "filter.lonLeft": tile.lonLeft.toString(),
      "filter.lonRight": tile.lonRight.toString(),
      "pagination.limit": "50",
    });
    if (nextToken) params.set("pagination.nextToken", nextToken);

    const res = await fetch(
      `${API_BASE}/location/vessels/bounding-box?${params}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[VesselAPI] Error ${res.status}:`, text);
      break;
    }

    const data = await res.json();
    for (const v of data.vessels || []) {
      const { country, emoji } = lookupFlag(v.mmsi);
      vessels.push({
        mmsi: v.mmsi,
        imo: v.imo || "",
        name: v.vessel_name || "",
        lat: v.latitude,
        lon: v.longitude,
        sog: v.sog ?? 0,
        heading: v.heading ?? 0,
        navStatus: v.nav_status || "",
        flagCountry: country,
        flagEmoji: emoji,
        timestamp: v.timestamp || "",
      });
    }

    nextToken = data.nextToken;
    if (!nextToken) break;
  }

  return vessels;
}

// --- Blob storage helpers ---

async function writeBlob(name: string, data: unknown): Promise<string> {
  const blob = await put(`${BLOB_PREFIX}/${name}`, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return blob.url;
}

async function readBlob<T>(name: string): Promise<T | null> {
  try {
    // List to find the blob URL first
    const { blobs } = await list({ prefix: `${BLOB_PREFIX}/${name}` });
    const blob = blobs.find((b) => b.pathname === `${BLOB_PREFIX}/${name}`);
    if (!blob) return null;
    const res = await fetch(blob.url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- Public API ---

export async function refreshVessels(): Promise<CachedData> {
  const apiKey = process.env.VESSEL_API_KEY;
  if (!apiKey) throw new Error("VESSEL_API_KEY not configured");

  console.log(`[VesselAPI] Fetching ${TILES.length} tiles...`);
  const allVessels: VesselData[] = [];
  const seen = new Set<number>();

  for (const tile of TILES) {
    console.log(
      `[VesselAPI] Tile: ${tile.latBottom}-${tile.latTop}, ${tile.lonLeft}-${tile.lonRight}`
    );
    const vessels = await fetchTile(apiKey, tile);
    for (const v of vessels) {
      if (!seen.has(v.mmsi)) {
        seen.add(v.mmsi);
        allVessels.push(v);
      }
    }
  }

  const now = new Date();
  const cached: CachedData = {
    fetchedAt: now.toISOString(),
    vessels: allVessels,
  };

  const snapshotId = now.toISOString().replace(/[:.]/g, "-");

  // Save latest + snapshot to blob
  await writeBlob("latest.json", cached);
  await writeBlob(`snapshots/${snapshotId}.json`, cached);

  // Update the snapshot index
  const existingIndex = (await readBlob<SnapshotMeta[]>("index.json")) ?? [];
  const newEntry: SnapshotMeta = {
    id: snapshotId,
    fetchedAt: cached.fetchedAt,
    count: allVessels.length,
    url: `snapshots/${snapshotId}.json`,
  };
  existingIndex.unshift(newEntry); // newest first
  await writeBlob("index.json", existingIndex);

  console.log(
    `[VesselAPI] Cached ${allVessels.length} vessels, snapshot: ${snapshotId}`
  );
  return cached;
}

export async function getSnapshot(id: string): Promise<CachedData | null> {
  return readBlob<CachedData>(`snapshots/${id}.json`);
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  return (await readBlob<SnapshotMeta[]>("index.json")) ?? [];
}

export async function getCachedVessels(): Promise<CachedData | null> {
  return readBlob<CachedData>("latest.json");
}

export function toGeoJSON(data: CachedData): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.vessels.map((v) => {
      const shadow = shadowFleetByMMSI.get(String(v.mmsi));
      const isShadowFleet = !!shadow;
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [v.lon, v.lat],
        },
        properties: {
          mmsi: v.mmsi,
          name: v.name,
          destination: "",
          flagCountry: v.flagCountry,
          flagEmoji: v.flagEmoji,
          sog: v.sog,
          cog: v.heading,
          alignment: isShadowFleet ? "red" : getAlignment(v.flagCountry),
          shadowFleet: isShadowFleet,
          sanctioners: shadow?.sanctioners?.join(", ") ?? "",
          label: `${v.flagEmoji} ${v.name}`.trim(),
        },
      };
    }),
  };
}

export interface TransitEvent {
  mmsi: number;
  name: string;
  flagCountry: string;
  alignment: string;
  shadowFleet: boolean;
  direction: "eastbound" | "westbound";
  lastSeenLon: number;
  snapshotId: string;
  fetchedAt: string;
}

export interface TransitStats {
  eastbound: { green: number; blue: number; red: number; yellow: number; shadow: number; total: number };
  westbound: { green: number; blue: number; red: number; yellow: number; shadow: number; total: number };
  events: TransitEvent[];
}

export async function computeTransits(): Promise<TransitStats> {
  const allSnapshots = await listSnapshots();
  if (allSnapshots.length < 2) {
    return {
      eastbound: { green: 0, blue: 0, red: 0, yellow: 0, shadow: 0, total: 0 },
      westbound: { green: 0, blue: 0, red: 0, yellow: 0, shadow: 0, total: 0 },
      events: [],
    };
  }

  const oldestFirst = [...allSnapshots].reverse();

  // Load all snapshots into memory (keyed by index)
  const snapshotData: CachedData[] = [];
  for (const meta of oldestFirst) {
    const snap = await getSnapshot(meta.id);
    if (snap) snapshotData.push(snap);
    else snapshotData.push({ fetchedAt: meta.fetchedAt, vessels: [] });
  }

  // Track how many consecutive snapshots each MMSI has appeared in
  const presenceCount = new Map<number, number>();
  const events: TransitEvent[] = [];
  const counted = new Set<string>(); // "mmsi-direction" to avoid double-counting

  for (let i = 1; i < oldestFirst.length; i++) {
    const prevVessels = new Map<number, VesselData>();
    for (const v of snapshotData[i - 1].vessels) prevVessels.set(v.mmsi, v);

    const currVessels = new Map<number, VesselData>();
    for (const v of snapshotData[i].vessels) currVessels.set(v.mmsi, v);

    // Update presence counts
    const newPresence = new Map<number, number>();
    for (const mmsi of currVessels.keys()) {
      newPresence.set(mmsi, (presenceCount.get(mmsi) ?? 0) + 1);
    }

    // Departed: in prev but not in curr, and was present in 2+ snapshots
    for (const [mmsi, vessel] of prevVessels) {
      if (!currVessels.has(mmsi) && (presenceCount.get(mmsi) ?? 0) >= 2) {
        const isShadow = shadowFleetByMMSI.has(String(mmsi));
        // Eastbound departure: last seen east of 54°E (near strait)
        // Westbound departure: last seen west of 52°E (left via northwest)
        const key = `${mmsi}-east`;
        if (vessel.lon >= 54.0 && !counted.has(key)) {
          counted.add(key);
          events.push({
            mmsi,
            name: vessel.name,
            flagCountry: vessel.flagCountry,
            alignment: isShadow ? "shadow" : getAlignment(vessel.flagCountry),
            shadowFleet: isShadow,
            direction: "eastbound",
            lastSeenLon: vessel.lon,
            snapshotId: oldestFirst[i].id,
            fetchedAt: oldestFirst[i].fetchedAt,
          });
        }
      }
    }

    // Arrived: in curr but not in prev, appearing for the first time
    for (const [mmsi, vessel] of currVessels) {
      if (!prevVessels.has(mmsi) && !presenceCount.has(mmsi)) {
        const isShadow = shadowFleetByMMSI.has(String(mmsi));
        // Westbound arrival: first seen east of 54°E (entered from east through strait)
        const key = `${mmsi}-west`;
        if (vessel.lon >= 54.0 && !counted.has(key)) {
          counted.add(key);
          events.push({
            mmsi,
            name: vessel.name,
            flagCountry: vessel.flagCountry,
            alignment: isShadow ? "shadow" : getAlignment(vessel.flagCountry),
            shadowFleet: isShadow,
            direction: "westbound",
            lastSeenLon: vessel.lon,
            snapshotId: oldestFirst[i].id,
            fetchedAt: oldestFirst[i].fetchedAt,
          });
        }
      }
    }

    presenceCount.clear();
    for (const [k, v] of newPresence) presenceCount.set(k, v);
  }

  const stats: TransitStats = {
    eastbound: { green: 0, blue: 0, red: 0, yellow: 0, shadow: 0, total: 0 },
    westbound: { green: 0, blue: 0, red: 0, yellow: 0, shadow: 0, total: 0 },
    events,
  };

  for (const e of events) {
    const dir = stats[e.direction];
    if (e.shadowFleet) dir.shadow++;
    else if (e.alignment in dir) (dir as Record<string, number>)[e.alignment]++;
    dir.total++;
  }

  return stats;
}

export async function buildTrails(
  currentSnapshotId: string
): Promise<GeoJSON.FeatureCollection> {
  const allSnapshots = await listSnapshots();
  const oldestFirst = [...allSnapshots].reverse();
  const cutoffIdx = oldestFirst.findIndex((s) => s.id === currentSnapshotId);
  const relevant = oldestFirst.slice(
    0,
    cutoffIdx === -1 ? oldestFirst.length : cutoffIdx + 1
  );

  // Build position history per MMSI
  const history = new Map<
    number,
    { coords: [number, number][]; flagCountry: string }
  >();

  for (const meta of relevant) {
    const snap = await getSnapshot(meta.id);
    if (!snap) continue;
    for (const v of snap.vessels) {
      let entry = history.get(v.mmsi);
      if (!entry) {
        entry = { coords: [], flagCountry: v.flagCountry };
        history.set(v.mmsi, entry);
      }
      const last = entry.coords[entry.coords.length - 1];
      if (!last || last[0] !== v.lon || last[1] !== v.lat) {
        entry.coords.push([v.lon, v.lat]);
      }
    }
  }

  const features: GeoJSON.Feature[] = [];
  for (const [, entry] of history) {
    if (entry.coords.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: entry.coords,
      },
      properties: {
        alignment: getAlignment(entry.flagCountry),
      },
    });
  }

  return { type: "FeatureCollection", features };
}
