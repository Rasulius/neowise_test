import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "./server.mjs";

async function withServer(run) {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function postTriage(baseUrl, body, headers = { "Content-Type": "application/json" }) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers,
    body,
  });
  const data = await response.json();
  return { status: response.status, data };
}

test("returns manual_review when model fails", async () => {
  await withServer(async (baseUrl) => {
    const { status, data } = await postTriage(baseUrl, JSON.stringify({ text: "[error] заявка" }));
    assert.equal(status, 200);
    assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
  });
});

test("returns manual_review on timeout", async () => {
  await withServer(async (baseUrl) => {
    const { status, data } = await postTriage(baseUrl, JSON.stringify({ text: "[timeout] заявка" }));
    assert.equal(status, 200);
    assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
  });
});

test("returns manual_review on unsuitable model output", async () => {
  await withServer(async (baseUrl) => {
    for (const text of ["[bad-json]", "[bad-topic]", "[empty-draft]"]) {
      const { status, data } = await postTriage(baseUrl, JSON.stringify({ text }));
      assert.equal(status, 200, `expected 200 for ${text}`);
      assert.deepEqual(data, { status: "manual_review", topic: null, draft: null }, `expected manual_review for ${text}`);
    }
  });
});

test("rejects invalid input with 400", async () => {
  await withServer(async (baseUrl) => {
    const cases = [
      JSON.stringify({ text: "" }),
      JSON.stringify({ text: "   " }),
      JSON.stringify({}),
      JSON.stringify({ text: 123 }),
      "{",
    ];
    for (const body of cases) {
      const { status, data } = await postTriage(baseUrl, body);
      assert.equal(status, 400, `expected 400 for ${body}`);
      assert.deepEqual(data, { status: "invalid_input" }, `expected invalid_input for ${body}`);
    }
  });
});

test("returns ready result for valid model output", async () => {
  await withServer(async (baseUrl) => {
    const { status, data } = await postTriage(baseUrl, JSON.stringify({ text: "Вопрос про доставку заказа" }));
    assert.equal(status, 200);
    assert.equal(data.status, "ready");
    assert.equal(data.topic, "delivery");
    assert.equal(typeof data.draft, "string");
    assert.ok(data.draft.trim().length > 0);
  });
});
