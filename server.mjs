import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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

function isReadyPayload(result) {
  return (
    result &&
    typeof result.topic === "string" &&
    ALLOWED_TOPICS.has(result.topic) &&
    typeof result.draft === "string" &&
    result.draft.trim().length > 0
  );
}

function manualReview(response) {
  return json(response, 200, { status: "manual_review", topic: null, draft: null });
}

async function handleTriage(request, response) {
  let body;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  const text = body?.text;
  if (typeof text !== "string" || text.trim() === "") {
    return json(response, 400, { status: "invalid_input" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const raw = await classify(text, { signal: controller.signal });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return manualReview(response);
    }
    if (!isReadyPayload(parsed)) {
      return manualReview(response);
    }
    return json(response, 200, {
      status: "ready",
      topic: parsed.topic,
      draft: parsed.draft,
    });
  } catch {
    return manualReview(response);
  } finally {
    clearTimeout(timer);
  }
}

const port = Number(process.env.PORT || 3000);

createServer(async (request, response) => {
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
}).listen(port, "127.0.0.1", () => {
  if (process.env.NODE_ENV !== "test") {
    console.log(`http://127.0.0.1:${port}`);
  }
});
