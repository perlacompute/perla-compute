import { context } from "@/lib/compute/runtime.mjs";
import { handle } from "@/lib/compute/handler.mjs";
import { canonicalMiningRequest } from "@/lib/vps/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dispatch = (request: Request) => {
  try {
    const { store, config } = context();
    return handle(canonicalMiningRequest(request), store, config);
  } catch {
    return Response.json(
      {
        error: {
          code: "configuration",
          message: "Compute service configuration is unavailable.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
};
export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
