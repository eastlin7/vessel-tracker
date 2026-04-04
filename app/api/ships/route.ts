import { NextResponse } from "next/server";
import { getCachedVessels, toGeoJSON, listSnapshots, getCachedTrails, getCachedTransits, buildTrails, computeTransits } from "@/lib/vessel-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cached, snapshots, preTrails, preTransits] = await Promise.all([
    getCachedVessels(),
    listSnapshots(),
    getCachedTrails(),
    getCachedTransits(),
  ]);

  if (!cached) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      _meta: { fetchedAt: null, count: 0, snapshots },
      trails: { type: "FeatureCollection", features: [] },
    });
  }

  const geojson = toGeoJSON(cached);

  // Use precomputed data if available, fall back to computing on the fly
  const trails = preTrails
    ?? (snapshots[0]?.id ? await buildTrails(snapshots[0].id) : { type: "FeatureCollection", features: [] });
  const transits = preTransits
    ?? (snapshots.length >= 2 ? await computeTransits() : null);

  return NextResponse.json(
    {
      ...geojson,
      _meta: {
        fetchedAt: cached.fetchedAt,
        count: cached.vessels.length,
        snapshots,
        transits,
      },
      trails,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=60",
      },
    }
  );
}
