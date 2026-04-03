import { NextResponse } from "next/server";
import { getCachedVessels, toGeoJSON, listSnapshots, buildTrails, computeTransits } from "@/lib/vessel-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cached, snapshots] = await Promise.all([
    getCachedVessels(),
    listSnapshots(),
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
  const currentId = snapshots[0]?.id;
  const [trails, transits] = await Promise.all([
    currentId
      ? buildTrails(currentId)
      : Promise.resolve({ type: "FeatureCollection", features: [] }),
    snapshots.length >= 2
      ? computeTransits()
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ...geojson,
    _meta: {
      fetchedAt: cached.fetchedAt,
      count: cached.vessels.length,
      snapshots,
      transits,
    },
    trails,
  });
}
