import { NextResponse } from "next/server";
import { listSnapshots, getSnapshot, toGeoJSON, getTrailsForSnapshot } from "@/lib/vessel-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    const snapshots = await listSnapshots();
    return NextResponse.json({ snapshots });
  }

  const data = await getSnapshot(id);
  if (!data) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  const geojson = toGeoJSON(data);
  const trails = await getTrailsForSnapshot(id);

  return NextResponse.json({
    fetchedAt: data.fetchedAt,
    count: data.vessels.length,
    geojson,
    trails,
  });
}
