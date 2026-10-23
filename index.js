"use strict";
// usend for Node.js. Zero dependencies; needs Node 18+ (global fetch and Web Crypto).
//
//   const { Usend } = require("@usend/node");      // or: import { Usend } from "@usend/node";
//   const usend = new Usend(process.env.USEND_API_KEY);
//   const { data, error } = await usend.emails.send({ from, to, subject, html });
//   // or react: <WelcomeEmail /> (rendered to html here with @react-email/render, an optional peer dependency)
//
// Every method resolves to { data, error }: exactly one of them is null. Errors carry the API's
// { statusCode, name, message }; network failures use name "application_error".

const VERSION = "1.3.0";
const DEFAULT_BASE_URL = "https://api.usend.et";
const DEFAULT_SMTP_HOST = "smtp.usend.et";

const enc = encodeURIComponent;

function qs(params) {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) usp.append(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : "";
}

class Usend {
  /**
   * @param {string} [apiKey] defaults to process.env.USEND_API_KEY
   * @param {{ baseUrl?: string, fetch?: typeof fetch }} [options] baseUrl defaults to USEND_BASE_URL or https://api.usend.et
   */
  constructor(apiKey, options = {}) {
    const env = typeof process !== "undefined" ? process.env : {};
    this.key = apiKey || env.USEND_API_KEY;
    if (!this.key) throw new Error('Missing API key. Pass it to new Usend("us_...") or set USEND_API_KEY.');
    this.baseUrl = (options.baseUrl || env.USEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._fetch = options.fetch || globalThis.fetch;
    // Retries after the first attempt, with backoff, on 429 (honoring Retry-After), 5xx and network errors. A POST is only
    // retried after a 5xx or network error when it carries an Idempotency-Key, so an email is never sent twice by a retry.
    this.maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0 ? options.maxRetries : 2;
    this._sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const r = this._request.bind(this);

    /**
     * Ready-to-use SMTP settings for this key (Nodemailer shape). Port 465 is implicit TLS, 587 is STARTTLS.
     * @param {{ port?: 465 | 587, host?: string }} [o]
     */
    this.smtp = (o = {}) => smtpConfig(this.key, { baseUrl: this.baseUrl, ...o });

    this.emails = {
      send: async (email, o = {}) => r("POST", "/emails", await withReact(email), idem(o)),
      get: (id) => r("GET", `/emails/${enc(id)}`),
      list: (params) => r("GET", `/emails${qs(params)}`),
      update: ({ id, ...body }) => r("PATCH", `/emails/${enc(id)}`, body),
      cancel: (id) => r("POST", `/emails/${enc(id)}/cancel`),
      events: (id) => r("GET", `/emails/${enc(id)}/events`),
      attachments: {
        list: (emailId) => r("GET", `/emails/${enc(emailId)}/attachments`),
        get: (emailId, id) => r("GET", `/emails/${enc(emailId)}/attachments/${enc(id)}`),
      },
      /** Aggregate metrics. params: start_date, end_date, timezone, granularity, metrics, dimensions, domain_id, email_id, broadcast_id (arrays are comma-joined). */
      metrics: (params) => r("GET", `/emails/metrics${qs(params)}`),
      /** Public read-only share link. `expiresIn` such as "2 hours" (max 48h). */
      share: (id, o = {}) => r("POST", `/emails/${enc(id)}/share`, o.expiresIn || o.expires_in ? { expires_in: o.expiresIn || o.expires_in } : {}),
      /** Sends the content to the signed-in dashboard user. Dashboard sessions only: API keys get 403. */
      test: (email) => r("POST", "/emails/test", email),
      insights: (id) => r("GET", `/emails/${enc(id)}/insights`),
    };
    this.batch = {
      /** @param {{ idempotencyKey?: string, validation?: "strict" | "permissive" }} [o] */
      send: async (emails, o = {}) =>
        r("POST", "/emails/batch", Array.isArray(emails) ? await Promise.all(emails.map(withReact)) : emails, { ...idem(o), ...(o.validation ? { "x-batch-validation": o.validation } : {}) }),
    };
    this.received = {
      list: (params) => r("GET", `/inbound/emails${qs(params)}`),
      get: (id) => r("GET", `/inbound/emails/${enc(id)}`),
      /** The raw RFC 822 message as a string. */
      raw: (id) => r("GET", `/inbound/emails/${enc(id)}/raw`, undefined, {}, "text"),
      /** Attachment objects with signed download URLs. */
      attachments: {
        list: (id) => r("GET", `/emails/receiving/${enc(id)}/attachments`),
        get: (id, attachmentId) => r("GET", `/emails/receiving/${enc(id)}/attachments/${enc(attachmentId)}`),
      },
      /** The attachment file as an ArrayBuffer. */
      download: (id, attachmentId) => r("GET", `/inbound/emails/${enc(id)}/attachments/${enc(attachmentId)}`, undefined, {}, "buffer"),
    };
    this.templates = {
      create: async (t) => r("POST", "/templates", await withReact(t)),
      list: (params) => r("GET", `/templates${qs(params)}`),
      get: (idOrAlias) => r("GET", `/templates/${enc(idOrAlias)}`),
      update: async (idOrAlias, t) => r("PATCH", `/templates/${enc(idOrAlias)}`, await withReact(t)),
      publish: (idOrAlias) => r("POST", `/templates/${enc(idOrAlias)}/publish`),
      duplicate: (idOrAlias) => r("POST", `/templates/${enc(idOrAlias)}/duplicate`),
      remove: (idOrAlias) => r("DELETE", `/templates/${enc(idOrAlias)}`),
      versions: {
        list: (idOrAlias) => r("GET", `/templates/${enc(idOrAlias)}/versions`),
        get: (idOrAlias, versionId) => r("GET", `/templates/${enc(idOrAlias)}/versions/${enc(versionId)}`),
        restore: (idOrAlias, versionId) => r("POST", `/templates/${enc(idOrAlias)}/versions/${enc(versionId)}/restore`),
      },
    };
    this.domains = {
      create: (d) => r("POST", "/domains", d),
      list: () => r("GET", "/domains"),
      get: (id) => r("GET", `/domains/${enc(id)}`),
      update: ({ id, ...body }) => r("PATCH", `/domains/${enc(id)}`, body),
      verify: (id) => r("POST", `/domains/${enc(id)}/verify`),
      autoConfigure: (id, body) => r("POST", `/domains/${enc(id)}/auto-configure`, body),
      remove: (id) => r("DELETE", `/domains/${enc(id)}`),
      insights: (id) => r("GET", `/domains/${enc(id)}/insights`),
      /** Claim a name another organization verified: publish the TXT record, then verify. */
      claim: {
        create: (d) => r("POST", "/domains/claim", d),
        get: (id) => r("GET", `/domains/claim/${enc(id)}`),
        verify: (id) => r("POST", `/domains/claim/${enc(id)}/verify`),
      },
    };
    this.apiKeys = {
      create: (k) => r("POST", "/api-keys", k),
      list: () => r("GET", "/api-keys"),
      update: (id, k) => r("PATCH", `/api-keys/${enc(id)}`, k),
      remove: (id) => r("DELETE", `/api-keys/${enc(id)}`),
    };
    this.audiences = {
      create: (a) => r("POST", "/audiences", a),
      list: () => r("GET", "/audiences"),
      get: (id) => r("GET", `/audiences/${enc(id)}`),
      remove: (id) => r("DELETE", `/audiences/${enc(id)}`),
      contacts: {
        create: (audienceId, c) => r("POST", `/audiences/${enc(audienceId)}/contacts`, c),
        list: (audienceId, params) => r("GET", `/audiences/${enc(audienceId)}/contacts${qs(params)}`),
        /** Synchronous CSV import: `csv` is text with an optional header row. */
        import: (audienceId, csv) => r("POST", `/audiences/${enc(audienceId)}/contacts/import`, { csv }),
        get: (audienceId, idOrEmail) => r("GET", `/audiences/${enc(audienceId)}/contacts/${enc(idOrEmail)}`),
        update: (audienceId, idOrEmail, c) => r("PATCH", `/audiences/${enc(audienceId)}/contacts/${enc(idOrEmail)}`, c),
        remove: (audienceId, idOrEmail) => r("DELETE", `/audiences/${enc(audienceId)}/contacts/${enc(idOrEmail)}`),
      },
    };
    this.segments = {
      create: (s) => r("POST", "/segments", s),
      list: () => r("GET", "/segments"),
      get: (id) => r("GET", `/segments/${enc(id)}`),
      update: (id, s) => r("PATCH", `/segments/${enc(id)}`, s),
      remove: (id) => r("DELETE", `/segments/${enc(id)}`),
      contacts: (id, params) => r("GET", `/segments/${enc(id)}/contacts${qs(params)}`),
      metrics: (id) => r("GET", `/segments/${enc(id)}/metrics`),
    };
    this.contacts = {
      create: (c) => r("POST", "/contacts", c),
      list: (params) => r("GET", `/contacts${qs(params)}`),
      get: (idOrEmail) => r("GET", `/contacts/${enc(idOrEmail)}`),
      update: (idOrEmail, c) => r("PATCH", `/contacts/${enc(idOrEmail)}`, c),
      remove: (idOrEmail) => r("DELETE", `/contacts/${enc(idOrEmail)}`),
      stats: () => r("GET", "/contacts/stats"),
      /** Synchronous CSV import into one segment: { csv, segment_id? }. */
      import: (body) => r("POST", "/contacts/import", body),
      /** Background imports (up to 250,000 rows): send { csv } or { contacts: [...] }, then poll get(). */
      imports: {
        create: (body) => r("POST", "/contacts/imports", body),
        list: (params) => r("GET", `/contacts/imports${qs(params)}`),
        get: (id) => r("GET", `/contacts/imports/${enc(id)}`),
      },
      topics: {
        list: (idOrEmail) => r("GET", `/contacts/${enc(idOrEmail)}/topics`),
        /** @param {{ id: string, subscription: "opt_in" | "opt_out" }[]} topics */
        update: (idOrEmail, topics) => r("PATCH", `/contacts/${enc(idOrEmail)}/topics`, { topics }),
      },
      segments: {
        list: (idOrEmail) => r("GET", `/contacts/${enc(idOrEmail)}/segments`),
        add: (idOrEmail, segmentId) => r("POST", `/contacts/${enc(idOrEmail)}/segments/${enc(segmentId)}`),
        remove: (idOrEmail, segmentId) => r("DELETE", `/contacts/${enc(idOrEmail)}/segments/${enc(segmentId)}`),
      },
    };
    this.contactProperties = {
      create: (p) => r("POST", "/contact-properties", p),
      list: () => r("GET", "/contact-properties"),
      get: (id) => r("GET", `/contact-properties/${enc(id)}`),
      update: (id, p) => r("PATCH", `/contact-properties/${enc(id)}`, p),
      remove: (id) => r("DELETE", `/contact-properties/${enc(id)}`),
    };
    this.topics = {
      create: (t) => r("POST", "/topics", t),
      list: () => r("GET", "/topics"),
      get: (id) => r("GET", `/topics/${enc(id)}`),
      update: (id, t) => r("PATCH", `/topics/${enc(id)}`, t),
      remove: (id) => r("DELETE", `/topics/${enc(id)}`),
    };
    this.shortLinks = {
      /** @param {{ target_url: string, code?: string, title?: string, expires_at?: string }} link */
      create: (link) => r("POST", "/short-links", link),
      list: (params) => r("GET", `/short-links${qs(params)}`),
      get: (id) => r("GET", `/short-links/${enc(id)}`),
      /** Fields: target_url, title, expires_at (null clears), disabled. The code cannot change. */
      update: (id, link) => r("PATCH", `/short-links/${enc(id)}`, link),
      remove: (id) => r("DELETE", `/short-links/${enc(id)}`),
      /** Totals, per-day clicks and top referrers. params: { days } (1 to 365, default 30). */
      stats: (id, params) => r("GET", `/short-links/${enc(id)}/stats${qs(params)}`),
    };
    this.broadcasts = {
      create: async (b) => r("POST", "/broadcasts", await withReact(b)),
      list: (params) => r("GET", `/broadcasts${qs(params)}`),
      get: (id) => r("GET", `/broadcasts/${enc(id)}`),
      update: async (id, b) => r("PATCH", `/broadcasts/${enc(id)}`, await withReact(b)),
      send: (id, body = {}) => r("POST", `/broadcasts/${enc(id)}/send`, body),
      test: (id, to) => r("POST", `/broadcasts/${enc(id)}/test`, { to }),
      remove: (id) => r("DELETE", `/broadcasts/${enc(id)}`),
      cancel: (id) => r("POST", `/broadcasts/${enc(id)}/cancel`),
      duplicate: (id) => r("POST", `/broadcasts/${enc(id)}/duplicate`),
      recipients: (id, params) => r("GET", `/broadcasts/${enc(id)}/recipients${qs(params)}`),
      clickedLinks: (id) => r("GET", `/broadcasts/${enc(id)}/clicked-links`),
      performance: (id) => r("GET", `/broadcasts/${enc(id)}/performance`),
    };
    this.webhooks = {
      create: (w) => r("POST", "/webhooks", w),
      list: () => r("GET", "/webhooks"),
      get: (id) => r("GET", `/webhooks/${enc(id)}`),
      update: (id, w) => r("PATCH", `/webhooks/${enc(id)}`, w),
      remove: (id) => r("DELETE", `/webhooks/${enc(id)}`),
      deliveries: (id, params) => r("GET", `/webhooks/${enc(id)}/deliveries${qs(params)}`),
      replay: (id, deliveryId) => r("POST", `/webhooks/${enc(id)}/deliveries/${enc(deliveryId)}/replay`),
      rotateSecret: (id) => r("POST", `/webhooks/${enc(id)}/rotate-secret`),
      /** Deliveries across all endpoints. params: webhook_id, type, status, limit, after, before. */
      events: {
        list: (params) => r("GET", `/webhooks/events${qs(params)}`),
        get: (id) => r("GET", `/webhooks/events/${enc(id)}`),
        replay: (id) => r("POST", `/webhooks/events/${enc(id)}/replay`),
        attempts: (id) => r("GET", `/webhooks/events/${enc(id)}/attempts`),
      },
      verify: verifyWebhook,
    };
    this.suppressions = {
      list: (params) => r("GET", `/suppressions${qs(params)}`),
      create: (s) => r("POST", "/suppressions", s),
      get: (idOrEmail) => r("GET", `/suppressions/${enc(idOrEmail)}`),
      remove: (idOrEmail) => r("DELETE", `/suppressions/${enc(idOrEmail)}`),
      /** Suppress up to 100 addresses at once. */
      createBatch: (emails) => r("POST", "/suppressions/batch", { emails }),
      removeBatch: (emails) => r("DELETE", "/suppressions/batch", { emails }),
    };
    this.events = {
      create: (e) => r("POST", "/events", e),
      list: (params) => r("GET", `/events${qs(params)}`),
      get: (idOrName) => r("GET", `/events/${enc(idOrName)}`),
      update: (id, e) => r("PATCH", `/events/${enc(id)}`, e),
      remove: (id) => r("DELETE", `/events/${enc(id)}`),
      /** Fire an event for a contact: { event, contact_id | email, payload? }. */
      send: (body, o = {}) => r("POST", "/events/send", body, idem(o)),
    };
    this.automations = {
      create: (a) => r("POST", "/automations", a),
      list: (params) => r("GET", `/automations${qs(params)}`),
      get: (id) => r("GET", `/automations/${enc(id)}`),
      update: (id, a) => r("PATCH", `/automations/${enc(id)}`, a),
      remove: (id) => r("DELETE", `/automations/${enc(id)}`),
      duplicate: (id) => r("POST", `/automations/${enc(id)}/duplicate`),
      stop: (id) => r("POST", `/automations/${enc(id)}/stop`),
      runs: {
        list: (id, params) => r("GET", `/automations/${enc(id)}/runs${qs(params)}`),
        get: (id, runId) => r("GET", `/automations/${enc(id)}/runs/${enc(runId)}`),
      },
    };
    this.inboxes = {
      create: (i) => r("POST", "/inboxes", i),
      list: (params) => r("GET", `/inboxes${qs(params)}`),
      get: (id) => r("GET", `/inboxes/${enc(id)}`),
      update: (id, i) => r("PATCH", `/inboxes/${enc(id)}`, i),
      remove: (id) => r("DELETE", `/inboxes/${enc(id)}`),
      labels: {
        create: (inboxId, l) => r("POST", `/inboxes/${enc(inboxId)}/labels`, l),
        list: (inboxId) => r("GET", `/inboxes/${enc(inboxId)}/labels`),
        get: (inboxId, id) => r("GET", `/inboxes/${enc(inboxId)}/labels/${enc(id)}`),
        update: (inboxId, id, l) => r("PATCH", `/inboxes/${enc(inboxId)}/labels/${enc(id)}`, l),
        remove: (inboxId, id) => r("DELETE", `/inboxes/${enc(inboxId)}/labels/${enc(id)}`),
      },
      threads: {
        /** params: folder, label, assignee, unread, q, limit, after, before. */
        list: (inboxId, params) => r("GET", `/inboxes/${enc(inboxId)}/threads${qs(params)}`),
        get: (inboxId, id) => r("GET", `/inboxes/${enc(inboxId)}/threads/${enc(id)}`),
        /** { folder?, labels?, assignee_user_id?, read? } */
        update: (inboxId, id, t) => r("PATCH", `/inboxes/${enc(inboxId)}/threads/${enc(id)}`, t),
        remove: (inboxId, id) => r("DELETE", `/inboxes/${enc(inboxId)}/threads/${enc(id)}`),
        emails: {
          list: (inboxId, threadId, params) => r("GET", `/inboxes/${enc(inboxId)}/threads/${enc(threadId)}/emails${qs(params)}`),
          get: (inboxId, threadId, id) => r("GET", `/inboxes/${enc(inboxId)}/threads/${enc(threadId)}/emails/${enc(id)}`),
          reply: (inboxId, threadId, id, body) => r("POST", `/inboxes/${enc(inboxId)}/threads/${enc(threadId)}/emails/${enc(id)}/reply`, body),
          forward: (inboxId, threadId, id, body) => r("POST", `/inboxes/${enc(inboxId)}/threads/${enc(threadId)}/emails/${enc(id)}/forward`, body),
        },
      },
      drafts: {
        create: (inboxId, d) => r("POST", `/inboxes/${enc(inboxId)}/drafts`, d),
        list: (inboxId, params) => r("GET", `/inboxes/${enc(inboxId)}/drafts${qs(params)}`),
        get: (inboxId, id) => r("GET", `/inboxes/${enc(inboxId)}/drafts/${enc(id)}`),
        update: (inboxId, id, d) => r("PATCH", `/inboxes/${enc(inboxId)}/drafts/${enc(id)}`, d),
        remove: (inboxId, id) => r("DELETE", `/inboxes/${enc(inboxId)}/drafts/${enc(id)}`),
        send: (inboxId, id) => r("POST", `/inboxes/${enc(inboxId)}/drafts/${enc(id)}/send`),
      },
    };
    this.logs = {
      list: (params) => r("GET", `/logs${qs(params)}`),
      get: (id) => r("GET", `/logs/${enc(id)}`),
      userAgents: () => r("GET", "/logs/user-agents"),
    };
    this.stats = { get: (params) => r("GET", `/stats${qs(params)}`) };
    this.tools = { dmarcCheck: (domain) => r("POST", "/tools/dmarc-check", { domain }) };

    // OAuth 2.0 authorization server (PKCE S256). These endpoints take no API key.
    const base = this.baseUrl;
    this.oauth = {
      metadata: () => r("GET", "/.well-known/oauth-authorization-server", undefined, { Authorization: null }),
      /** Register a public client: { client_name, redirect_uris }. */
      register: (client) => r("POST", "/oauth/register", client, { Authorization: null }),
      /** { grant_type: "authorization_code", client_id, code, code_verifier, redirect_uri } or { grant_type: "refresh_token", client_id, refresh_token } */
      token: (body) => r("POST", "/oauth/token", body, { Authorization: null }),
      revoke: (body) => r("POST", "/oauth/revoke", body, { Authorization: null }),
      /** The URL to send the user's browser to. `scope` is "full_access" and/or "sending_access". */
      authorizeUrl: (p) => `${base}/oauth/authorize${qs({ response_type: "code", code_challenge_method: "S256", ...p })}`,
    };
  }

  async _request(method, path, body, headers = {}, as = "json") {
    const h = {
      Authorization: `Bearer ${this.key}`,
      "User-Agent": `usend-node/${VERSION}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    };
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    const safe = method === "GET" || method === "DELETE" || method === "HEAD" || Object.keys(h).some((k) => k.toLowerCase() === "idempotency-key");
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this._fetch(this.baseUrl + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
      } catch (e) {
        if (attempt < this.maxRetries && safe) {
          await this._sleep(retryWait(attempt, null));
          continue;
        }
        return { data: null, error: { statusCode: null, name: "application_error", message: String(e && e.message ? e.message : e) } };
      }
      const wait = res.status === 429 || (res.status >= 500 && safe) ? retryWait(attempt, res.headers && res.headers.get ? res.headers.get("retry-after") : null) : null;
      if (attempt < this.maxRetries && wait !== null) {
        await res.arrayBuffer().catch(() => {}); // free the connection before trying again
        await this._sleep(wait);
        continue;
      }
      break;
    }
    if (res.ok && as !== "json") {
      try {
        return { data: as === "text" ? await res.text() : await res.arrayBuffer(), error: null };
      } catch (e) {
        return { data: null, error: { statusCode: res.status, name: "application_error", message: String(e && e.message ? e.message : e) } };
      }
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      let error = { statusCode: res.status, name: "application_error", message: `HTTP ${res.status}` };
      if (json && json.name) error = json;
      else if (json && json.error) error = { statusCode: res.status, name: json.error, message: json.error_description || json.error };
      return { data: null, error };
    }
    return { data: json, error: null };
  }
}

/** Milliseconds to wait before a retry, or null when the server asked for more than a minute (the error is returned instead). */
function retryWait(attempt, retryAfter) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds > 60 ? null : Math.max(0, seconds * 1000);
  }
  return Math.min(500 * 2 ** attempt, 8000) + Math.random() * 250;
}

/**
 * SMTP settings for sending through usend (the API key is the password). The result works as
 * `nodemailer.createTransport(smtpConfig(key))`. The host is `smtp.usend.et`; for a self-hosted
 * platform pass `host`, set USEND_SMTP_HOST, or pass `baseUrl` (`https://api.x.com` gives `smtp.x.com`).
 */
function smtpConfig(apiKey, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  const key = apiKey || env.USEND_API_KEY;
  if (!key) throw new Error('Missing API key. Pass it to smtpConfig("us_...") or set USEND_API_KEY.');
  const port = options.port === undefined ? 465 : options.port;
  if (port !== 465 && port !== 587) throw new Error("usend accepts SMTP on port 465 (TLS) or 587 (STARTTLS).");
  return { host: options.host || env.USEND_SMTP_HOST || smtpHostFor(options.baseUrl), port, secure: port === 465, auth: { user: "usend", pass: key } };
}

function smtpHostFor(baseUrl) {
  if (!baseUrl) return DEFAULT_SMTP_HOST;
  try {
    const h = new URL(baseUrl).hostname;
    return h.startsWith("api.") ? "smtp." + h.slice(4) : DEFAULT_SMTP_HOST;
  } catch {
    return DEFAULT_SMTP_HOST;
  }
}

// React Email: `react` is rendered to `html` here, before the request, and never sent to the API (like Resend's SDK: when both
// are given, the rendered `react` replaces `html`; no `text` is derived). @react-email/render is an optional peer dependency,
// imported only when `react` is used. `reactRenderer.load` is replaceable in tests.
const reactRenderer = { load: () => import("@react-email/render") };

async function renderReact(node) {
  let render;
  try {
    const m = await reactRenderer.load();
    render = m.render || m.renderAsync || (m.default && (m.default.render || m.default.renderAsync));
  } catch (e) {
    throw new Error("Failed to render React component. Make sure to install `@react-email/render` or `@react-email/components` (npm install @react-email/render).", { cause: e });
  }
  if (typeof render !== "function") throw new Error("@react-email/render does not export a render function. Update it: npm install @react-email/render@latest");
  return render(node); // a Promise in @react-email/render 1.x and later, a string before
}

async function withReact(payload) {
  if (!payload || typeof payload !== "object" || !("react" in payload)) return payload;
  const { react, ...body } = payload;
  if (react) body.html = await renderReact(react);
  return body;
}

function idem(o) {
  return o && o.idempotencyKey ? { "Idempotency-Key": o.idempotencyKey } : {};
}

/**
 * Verifies a webhook delivery (Standard Webhooks). Pass the raw request body as a string, the request
 * headers and the endpoint's signing secret (whsec_...). Resolves to the parsed event, or throws.
 */
async function verifyWebhook({ payload, headers, secret, toleranceSeconds = 300 }) {
  const h = (n) => (typeof headers.get === "function" ? headers.get(n) : headers[n] || headers[n.toLowerCase()]);
  const id = h("webhook-id"), ts = h("webhook-timestamp"), sigs = h("webhook-signature");
  if (!id || !ts || !sigs) throw new Error("Missing webhook-id, webhook-timestamp or webhook-signature header");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSeconds) throw new Error("Webhook timestamp is too old or too new");
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${payload}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  const ok = sigs.split(" ").some((s) => {
    const [v, sig] = s.split(",");
    return v === "v1" && sig && sig.length === expected.length && timingSafeEqual(sig, expected);
  });
  if (!ok) throw new Error("Invalid webhook signature");
  return JSON.parse(payload);
}

function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = { Usend, verifyWebhook, smtpConfig, default: Usend, _reactRenderer: reactRenderer };
