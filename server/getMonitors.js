import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://api.uptimerobot.com/v2/getMonitors";

let envLoaded = false;

const parseEnvValue = (rawValue) => {
  const value = rawValue.trim();
  if (!value) return "";

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let result = "";

    for (let i = 1; i < value.length; i += 1) {
      const char = value[i];
      if (char === quote && value[i - 1] !== "\\") break;
      result += char;
    }

    return result;
  }

  return value.split("#")[0].trim();
};

const applyEnvFile = async (filePath) => {
  try {
    const content = await readFile(filePath, "utf8");

    for (const line of content.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key]) continue;

      const rawValue = trimmed.slice(separatorIndex + 1);
      process.env[key] = parseEnvValue(rawValue);
    }
  } catch {
    // Ignore missing local env files.
  }
};

const loadLocalEnv = async () => {
  if (envLoaded) return;
  envLoaded = true;

  const mode = process.env.NODE_ENV || "development";
  const root = process.cwd();
  const envFiles = [
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`,
  ];

  for (const envFile of envFiles) {
    await applyEnvFile(path.join(root, envFile));
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
