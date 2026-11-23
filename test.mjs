import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const root = dirname(fileURLToPath(import.meta.url));

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function post(text) {
  const reply = await fetch(`${BASE}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { status: reply.status, body: await reply.json() };
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(50);
  }
  throw new Error("Server did not start");
}

const child = spawn(process.execPath, [join(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
  stdio: "ignore",
});

let failed = false;

try {
  await waitForServer();

  const empty = await post("   ");
  assert(empty.status === 400, "empty text must be 400");
  assert(empty.body.status === "invalid_input", "empty text -> invalid_input");

  const timeout = await post("нужна помощь [timeout]");
  assert(timeout.status === 200, "timeout must be 200");
  assert(timeout.body.status === "manual_review", "timeout -> manual_review");
  assert(timeout.body.topic === null && timeout.body.draft === null, "timeout clears fields");

  const badTopic = await post("возврат [bad-topic]");
  assert(badTopic.body.status === "manual_review", "bad-topic -> manual_review");

  const emptyDraft = await post("вопрос [empty-draft]");
  assert(emptyDraft.body.status === "manual_review", "empty-draft -> manual_review");

  const ok = await post("Когда будет доставка?");
  assert(ok.status === 200 && ok.body.status === "ready", "happy path ready");
  assert(ok.body.topic === "delivery", "delivery topic");
  assert(typeof ok.body.draft === "string" && ok.body.draft.trim(), "non-empty draft");

  console.log("ok");
} catch (error) {
  failed = true;
  console.error(error.message || error);
} finally {
  child.kill();
  process.exit(failed ? 1 : 0);
}
