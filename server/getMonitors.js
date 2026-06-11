const DEFAULT_API_URL = "https://api.uptimerobot.com/v2/getMonitors";

let envLoaded = false;

const loadLocalEnv = async () => {
  if (envLoaded) return;
  envLoaded = true;

  try {
    const { loadEnv } = await import("vite");
    const env = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
    Object.assign(process.env, env);
  } catch {
    // Ignore env loading failures in serverless runtimes.
  }
};

const readJsonBody = async (req) => {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return {};

  return JSON.parse(rawBody);
};

const sendJson = (res, statusCode, data) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
};

export const handleGetMonitors = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { message: "Method Not Allowed" });
    return;
  }

  try {
    await loadLocalEnv();

    const apiKey = process.env.API_KEY || process.env.VITE_API_KEY;
    const apiUrl =
      process.env.API_URL || process.env.VITE_GLOBAL_API || DEFAULT_API_URL;

    if (!apiKey) {
      sendJson(res, 500, {
        message: "Missing API_KEY",
        hint: "Set API_KEY in the deployment platform or local .env file",
      });
      return;
    }

    const body = await readJsonBody(req);
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
      sendJson(res, upstreamResponse.status, {
        message: result?.error?.message || "UptimeRobot request failed",
        data: result,
      });
      return;
    }

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
