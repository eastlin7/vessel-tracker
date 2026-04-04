import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshVessels, toGeoJSON, listSnapshots, getCachedTrails } from "@/lib/vessel-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = request.headers.get("x-sync-token");
  if (!token || token !== process.env.SYNC_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await refreshVessels();
    const [snapshots, trails] = await Promise.all([
      listSnapshots(),
      getCachedTrails(),
    ]);

    // Bust the CDN cache for the main data endpoint
    revalidatePath("/api/ships");

    return NextResponse.json({
      fetchedAt: data.fetchedAt,
      count: data.vessels.length,
      geojson: toGeoJSON(data),
      trails: trails ?? { type: "FeatureCollection", features: [] },
      snapshots,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
