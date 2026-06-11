import { handleGetMonitors } from "../server/getMonitors.js";

export default async function handler(req, res) {
  await handleGetMonitors(req, res);
}
