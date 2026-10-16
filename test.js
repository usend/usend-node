const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { Usend, verifyWebhook, smtpConfig } = require("./index.js");

function fake(status, body) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetch, calls };
}

test("send posts JSON with the key and idempotency header", async () => {
  const f = fake(200, { id: "e1" });
  const usend = new Usend("us_test", { baseUrl: "https://api.example.com/", fetch: f.fetch });
  const res = await usend.emails.send({ from: "a@x.com", to: "b@y.com", subject: "Hi", html: "<p>Hi</p>" }, { idempotencyKey: "k1" });
  assert.deepStrictEqual(res, { data: { id: "e1" }, error: null });
  assert.strictEqual(f.calls[0].url, "https://api.example.com/emails");
  assert.strictEqual(f.calls[0].init.method, "POST");
  assert.strictEqual(f.calls[0].init.headers.Authorization, "Bearer us_test");
  assert.strictEqual(f.calls[0].init.headers["Idempotency-Key"], "k1");
  assert.strictEqual(JSON.parse(f.calls[0].init.body).to, "b@y.com");
});

test("API errors come back as { data: null, error }", async () => {
  const err = { statusCode: 422, name: "validation_error", message: "The `to` field is required." };
  const usend = new Usend("us_test", { fetch: fake(422, err).fetch });
  assert.deepStrictEqual(await usend.emails.send({}), { data: null, error: err });
});

test("network failures do not throw", async () => {
  const usend = new Usend("us_test", { fetch: async () => { throw new Error("offline"); } });
  const res = await usend.domains.list();
  assert.strictEqual(res.data, null);
  assert.strictEqual(res.error.name, "application_error");
});

test("batch sets the validation header and default base URL", async () => {
  const f = fake(200, { data: [] });
  const usend = new Usend("us_test", { fetch: f.fetch });
  await usend.batch.send([], { validation: "permissive" });
  assert.strictEqual(f.calls[0].url, "https://api.usend.et/emails/batch");
  assert.strictEqual(f.calls[0].init.headers["x-batch-validation"], "permissive");
});

test("missing key throws", () => {
  const old = process.env.USEND_API_KEY;
  delete process.env.USEND_API_KEY;
  assert.throws(() => new Usend());
  if (old) process.env.USEND_API_KEY = old;
});

test("verifyWebhook accepts a valid signature and rejects a forged one", async () => {
  const secretBytes = crypto.randomBytes(24);
  const secret = "whsec_" + secretBytes.toString("base64");
  const payload = JSON.stringify({ type: "email.delivered", created_at: "now", data: { email_id: "e1" } });
  const id = "msg_1", ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", secretBytes).update(`${id}.${ts}.${payload}`).digest("base64");
  const headers = { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
  const event = await verifyWebhook({ payload, headers, secret });
  assert.strictEqual(event.data.email_id, "e1");
  await assert.rejects(verifyWebhook({ payload: payload + " ", headers, secret }));
});

test("smtpConfig gives Nodemailer settings for 465 and 587", () => {
  assert.deepStrictEqual(smtpConfig("us_k"), { host: "smtp.usend.et", port: 465, secure: true, auth: { user: "usend", pass: "us_k" } });
  assert.deepStrictEqual(smtpConfig("us_k", { port: 587 }), { host: "smtp.usend.et", port: 587, secure: false, auth: { user: "usend", pass: "us_k" } });
  assert.throws(() => smtpConfig("us_k", { port: 25 }), /465.*587/);
  assert.throws(() => smtpConfig(""), /Missing API key/);
});

test("the SMTP host follows the base URL of a self-hosted platform", () => {
  const usend = new Usend("us_k", { baseUrl: "https://api.acme.com" });
  assert.strictEqual(usend.smtp().host, "smtp.acme.com");
  assert.strictEqual(usend.smtp({ host: "mail.acme.com", port: 587 }).host, "mail.acme.com");
  assert.strictEqual(new Usend("us_k", { baseUrl: "http://localhost:8080" }).smtp().host, "smtp.usend.et");
});

test("new resources hit the documented method, path and body", async () => {
  const cases = [
    [(u) => u.emails.metrics({ start_date: "2026-10-01", dimensions: "domain" }), "GET", "/emails/metrics?start_date=2026-10-01&dimensions=domain"],
    [(u) => u.emails.share("e 1", { expiresIn: "2 hours" }), "POST", "/emails/e%201/share", { expires_in: "2 hours" }],
    [(u) => u.emails.test({ from: "a@x.com", html: "x" }), "POST", "/emails/test", { from: "a@x.com", html: "x" }],
    [(u) => u.emails.insights("e1"), "GET", "/emails/e1/insights"],
    [(u) => u.received.attachments.list("r1"), "GET", "/emails/receiving/r1/attachments"],
    [(u) => u.received.attachments.get("r1", "a1"), "GET", "/emails/receiving/r1/attachments/a1"],
    [(u) => u.templates.versions.list("welcome"), "GET", "/templates/welcome/versions"],
    [(u) => u.templates.versions.get("welcome", "v1"), "GET", "/templates/welcome/versions/v1"],
    [(u) => u.templates.versions.restore("welcome", "v1"), "POST", "/templates/welcome/versions/v1/restore"],
    [(u) => u.domains.insights("d1"), "GET", "/domains/d1/insights"],
    [(u) => u.domains.claim.create({ name: "a.com" }), "POST", "/domains/claim", { name: "a.com" }],
    [(u) => u.domains.claim.get("c1"), "GET", "/domains/claim/c1"],
    [(u) => u.domains.claim.verify("c1"), "POST", "/domains/claim/c1/verify"],
    [(u) => u.apiKeys.update("k1", { name: "n" }), "PATCH", "/api-keys/k1", { name: "n" }],
    [(u) => u.audiences.create({ name: "A" }), "POST", "/audiences", { name: "A" }],
    [(u) => u.audiences.list(), "GET", "/audiences"],
    [(u) => u.audiences.contacts.import("a1", "email\nx@y.com"), "POST", "/audiences/a1/contacts/import", { csv: "email\nx@y.com" }],
    [(u) => u.audiences.contacts.get("a1", "x@y.com"), "GET", "/audiences/a1/contacts/x%40y.com"],
    [(u) => u.segments.update("s1", { name: "N" }), "PATCH", "/segments/s1", { name: "N" }],
    [(u) => u.segments.contacts("s1", { limit: 5 }), "GET", "/segments/s1/contacts?limit=5"],
    [(u) => u.segments.metrics("s1"), "GET", "/segments/s1/metrics"],
    [(u) => u.contacts.stats(), "GET", "/contacts/stats"],
    [(u) => u.contacts.import({ csv: "x" }), "POST", "/contacts/import", { csv: "x" }],
    [(u) => u.contacts.imports.create({ contacts: [{ email: "a@b.com" }] }), "POST", "/contacts/imports", { contacts: [{ email: "a@b.com" }] }],
    [(u) => u.contacts.imports.list({ status: "completed" }), "GET", "/contacts/imports?status=completed"],
    [(u) => u.contacts.imports.get("i1"), "GET", "/contacts/imports/i1"],
    [(u) => u.contacts.topics.list("c1"), "GET", "/contacts/c1/topics"],
    [(u) => u.contacts.topics.update("c1", [{ id: "t1", subscription: "opt_out" }]), "PATCH", "/contacts/c1/topics", { topics: [{ id: "t1", subscription: "opt_out" }] }],
    [(u) => u.contactProperties.create({ key: "plan", type: "string" }), "POST", "/contact-properties", { key: "plan", type: "string" }],
    [(u) => u.contactProperties.update("p1", { fallback_value: "x" }), "PATCH", "/contact-properties/p1", { fallback_value: "x" }],
    [(u) => u.contactProperties.remove("p1"), "DELETE", "/contact-properties/p1"],
    [(u) => u.topics.create({ name: "News" }), "POST", "/topics", { name: "News" }],
    [(u) => u.topics.remove("t1"), "DELETE", "/topics/t1"],
    [(u) => u.shortLinks.create({ target_url: "https://example.com", code: "promo" }), "POST", "/short-links", { target_url: "https://example.com", code: "promo" }],
    [(u) => u.shortLinks.list({ limit: 5 }), "GET", "/short-links?limit=5"],
    [(u) => u.shortLinks.get("s1"), "GET", "/short-links/s1"],
    [(u) => u.shortLinks.update("s1", { disabled: true }), "PATCH", "/short-links/s1", { disabled: true }],
    [(u) => u.shortLinks.remove("s1"), "DELETE", "/short-links/s1"],
    [(u) => u.shortLinks.stats("s1", { days: 7 }), "GET", "/short-links/s1/stats?days=7"],
    [(u) => u.broadcasts.cancel("b1"), "POST", "/broadcasts/b1/cancel"],
    [(u) => u.broadcasts.duplicate("b1"), "POST", "/broadcasts/b1/duplicate"],
    [(u) => u.broadcasts.recipients("b1", { type: "opened" }), "GET", "/broadcasts/b1/recipients?type=opened"],
    [(u) => u.broadcasts.clickedLinks("b1"), "GET", "/broadcasts/b1/clicked-links"],
    [(u) => u.broadcasts.performance("b1"), "GET", "/broadcasts/b1/performance"],
    [(u) => u.webhooks.rotateSecret("w1"), "POST", "/webhooks/w1/rotate-secret"],
    [(u) => u.webhooks.events.list({ type: "email.bounced" }), "GET", "/webhooks/events?type=email.bounced"],
    [(u) => u.webhooks.events.get("v1"), "GET", "/webhooks/events/v1"],
    [(u) => u.webhooks.events.replay("v1"), "POST", "/webhooks/events/v1/replay"],
    [(u) => u.webhooks.events.attempts("v1"), "GET", "/webhooks/events/v1/attempts"],
    [(u) => u.suppressions.get("a@b.com"), "GET", "/suppressions/a%40b.com"],
    [(u) => u.suppressions.createBatch(["a@b.com"]), "POST", "/suppressions/batch", { emails: ["a@b.com"] }],
    [(u) => u.suppressions.removeBatch(["a@b.com"]), "DELETE", "/suppressions/batch", { emails: ["a@b.com"] }],
    [(u) => u.events.create({ name: "order.paid", schema: { total: "number" } }), "POST", "/events", { name: "order.paid", schema: { total: "number" } }],
    [(u) => u.events.list(), "GET", "/events"],
    [(u) => u.events.get("order.paid"), "GET", "/events/order.paid"],
    [(u) => u.events.update("e1", { schema: null }), "PATCH", "/events/e1", { schema: null }],
    [(u) => u.events.remove("e1"), "DELETE", "/events/e1"],
    [(u) => u.events.send({ event: "order.paid", email: "a@b.com" }), "POST", "/events/send", { event: "order.paid", email: "a@b.com" }],
    [(u) => u.automations.create({ name: "A", steps: [], connections: [] }), "POST", "/automations", { name: "A", steps: [], connections: [] }],
    [(u) => u.automations.list({ status: "enabled" }), "GET", "/automations?status=enabled"],
    [(u) => u.automations.get("a1"), "GET", "/automations/a1"],
    [(u) => u.automations.update("a1", { status: "disabled" }), "PATCH", "/automations/a1", { status: "disabled" }],
    [(u) => u.automations.remove("a1"), "DELETE", "/automations/a1"],
    [(u) => u.automations.duplicate("a1"), "POST", "/automations/a1/duplicate"],
    [(u) => u.automations.stop("a1"), "POST", "/automations/a1/stop"],
    [(u) => u.automations.runs.list("a1", { status: "running" }), "GET", "/automations/a1/runs?status=running"],
    [(u) => u.automations.runs.get("a1", "r1"), "GET", "/automations/a1/runs/r1"],
    [(u) => u.inboxes.create({ name: "Support", address: "s@a.com" }), "POST", "/inboxes", { name: "Support", address: "s@a.com" }],
    [(u) => u.inboxes.update("i1", { enabled: false }), "PATCH", "/inboxes/i1", { enabled: false }],
    [(u) => u.inboxes.labels.create("i1", { name: "VIP" }), "POST", "/inboxes/i1/labels", { name: "VIP" }],
    [(u) => u.inboxes.labels.remove("i1", "l1"), "DELETE", "/inboxes/i1/labels/l1"],
    [(u) => u.inboxes.threads.list("i1", { folder: "inbox", unread: true }), "GET", "/inboxes/i1/threads?folder=inbox&unread=true"],
    [(u) => u.inboxes.threads.update("i1", "t1", { read: true }), "PATCH", "/inboxes/i1/threads/t1", { read: true }],
    [(u) => u.inboxes.threads.emails.list("i1", "t1"), "GET", "/inboxes/i1/threads/t1/emails"],
    [(u) => u.inboxes.threads.emails.reply("i1", "t1", "m1", { text: "ok" }), "POST", "/inboxes/i1/threads/t1/emails/m1/reply", { text: "ok" }],
    [(u) => u.inboxes.threads.emails.forward("i1", "t1", "m1", { to: ["a@b.com"] }), "POST", "/inboxes/i1/threads/t1/emails/m1/forward", { to: ["a@b.com"] }],
    [(u) => u.inboxes.drafts.create("i1", { subject: "S" }), "POST", "/inboxes/i1/drafts", { subject: "S" }],
    [(u) => u.inboxes.drafts.send("i1", "d1"), "POST", "/inboxes/i1/drafts/d1/send"],
    [(u) => u.logs.list({ status: "4xx" }), "GET", "/logs?status=4xx"],
    [(u) => u.logs.get("l1"), "GET", "/logs/l1"],
    [(u) => u.logs.userAgents(), "GET", "/logs/user-agents"],
    [(u) => u.stats.get({ days: 7 }), "GET", "/stats?days=7"],
    [(u) => u.tools.dmarcCheck("a.com"), "POST", "/tools/dmarc-check", { domain: "a.com" }],
  ];
  for (const [call, method, path, body] of cases) {
    const f = fake(200, { object: "x" });
    const res = await call(new Usend("us_test", { baseUrl: "https://api.example.com", fetch: f.fetch }));
    assert.strictEqual(res.error, null, path);
    assert.strictEqual(f.calls[0].init.method, method, path);
    assert.strictEqual(f.calls[0].url, "https://api.example.com" + path);
    assert.strictEqual(f.calls[0].init.headers.Authorization, "Bearer us_test");
    if (body === undefined) assert.strictEqual(f.calls[0].init.body, undefined, path);
    else assert.deepStrictEqual(JSON.parse(f.calls[0].init.body), body, path);
  }
});

test("events.send accepts an idempotency key", async () => {
  const f = fake(200, { object: "event" });
  await new Usend("us_test", { fetch: f.fetch }).events.send({ event: "x", email: "a@b.com" }, { idempotencyKey: "k9" });
  assert.strictEqual(f.calls[0].init.headers["Idempotency-Key"], "k9");
});

test("raw and download return text and bytes", async () => {
  const fetch = async () => ({ ok: true, status: 200, text: async () => "Subject: hi", arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  const usend = new Usend("us_test", { fetch });
  assert.deepStrictEqual(await usend.received.raw("r1"), { data: "Subject: hi", error: null });
  assert.strictEqual((await usend.received.download("r1", "a1")).data.byteLength, 2);
});

test("OAuth calls send no key, map OAuth errors, and build the authorize URL", async () => {
  const f = fake(200, { access_token: "usa_1" });
  const usend = new Usend("us_test", { baseUrl: "https://api.example.com", fetch: f.fetch });
  await usend.oauth.token({ grant_type: "refresh_token", client_id: "c", refresh_token: "r" });
  assert.strictEqual(f.calls[0].url, "https://api.example.com/oauth/token");
  assert.strictEqual(f.calls[0].init.headers.Authorization, undefined);
  await usend.oauth.register({ client_name: "App", redirect_uris: ["https://a.test/cb"] });
  await usend.oauth.revoke({ token: "t" });
  await usend.oauth.metadata();
  assert.deepStrictEqual(f.calls.slice(1).map((c) => c.url.replace("https://api.example.com", "")),
    ["/oauth/register", "/oauth/revoke", "/.well-known/oauth-authorization-server"]);
  const bad = new Usend("us_test", { fetch: fake(400, { error: "invalid_grant", error_description: "Code expired." }).fetch });
  assert.deepStrictEqual(await bad.oauth.token({ grant_type: "authorization_code", client_id: "c" }),
    { data: null, error: { statusCode: 400, name: "invalid_grant", message: "Code expired." } });
  const u = new URL(usend.oauth.authorizeUrl({ client_id: "c", redirect_uri: "https://a.test/cb", scope: "full_access", code_challenge: "abc" }));
  assert.strictEqual(u.origin + u.pathname, "https://api.example.com/oauth/authorize");
  assert.strictEqual(u.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(u.searchParams.get("response_type"), "code");
});
