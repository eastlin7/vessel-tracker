import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshVessels } from "@/lib/vessel-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await refreshVessels();
    revalidatePath("/api/ships");
    return NextResponse.json({
      ok: true,
      fetchedAt: data.fetchedAt,
      count: data.vessels.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
