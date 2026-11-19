import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const MODEL_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleTriage(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  if (!payload || typeof payload.text !== "string" || payload.text.trim() === "") {
    return json(response, 400, { status: "invalid_input" });
  }

  try {
    const raw = await classify(payload.text, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    const parsed = JSON.parse(raw);
    const topic = parsed?.topic;
    const draft = parsed?.draft;
    if (!ALLOWED_TOPICS.has(topic) || typeof draft !== "string" || draft.trim() === "") {
      return json(response, 200, { status: "manual_review", topic: null, draft: null });
    }
    return json(response, 200, { status: "ready", topic, draft });
  } catch {
    return json(response, 200, { status: "manual_review", topic: null, draft: null });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  createAppServer().listen(port, "127.0.0.1", () => {
    console.log(`Server listening on http://127.0.0.1:${port}`);
  });
}
