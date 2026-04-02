import { NextResponse } from "next/server";
import { refreshVessels, toGeoJSON, listSnapshots, buildTrails } from "@/lib/vessel-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = request.headers.get("x-sync-token");
  if (!token || token !== process.env.SYNC_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await refreshVessels();
    const snapshots = await listSnapshots();
    const currentId = snapshots[0]?.id;
    const trails = currentId
      ? await buildTrails(currentId)
      : { type: "FeatureCollection", features: [] };
    return NextResponse.json({
      fetchedAt: data.fetchedAt,
      count: data.vessels.length,
      geojson: toGeoJSON(data),
      trails,
      snapshots,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
