const DEFAULT_API_URL = "https://api.uptimerobot.com/v2/getMonitors";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return Response.json({ message: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const apiKey = env.API_KEY || env.VITE_API_KEY;
    const apiUrl = env.API_URL || env.VITE_GLOBAL_API || DEFAULT_API_URL;

    if (!apiKey) {
      return Response.json({ message: "Missing API_KEY" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const upstreamResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ...body,
        api_key: apiKey,
      }),
    });

    const result = await upstreamResponse.json().catch(() => null);

    if (!upstreamResponse.ok) {
      return Response.json(
        {
          message: result?.error?.message || "UptimeRobot request failed",
          data: result,
        },
        { status: upstreamResponse.status },
      );
    }

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
