# usend for Node.js

The official Node.js SDK for [usend](https://usend.et), the email API for developers.

```bash
npm install @usend/node
```

```js
import { Usend } from "@usend/node";

const usend = new Usend(process.env.USEND_API_KEY);

const { data, error } = await usend.emails.send({
  from: "Acme <hello@acme.com>",
  to: "ann@example.com",
  subject: "Your login code",
  html: "<p>Your code is <b>482913</b></p>",
});
```

Every method resolves to `{ data, error }`; exactly one is `null`. Errors have `statusCode`, `name` and `message`.

- Needs Node.js 18 or newer. No dependencies.
- Requests are retried (`maxRetries`, default 2) with backoff on `429` (honoring `Retry-After`), `5xx` and network errors. A `POST` is only retried after a
  `5xx` or network error when it carries an idempotency key, so an email is never sent twice by a retry.
- The key defaults to `USEND_API_KEY`; the base URL to `USEND_BASE_URL` or `https://api.usend.et`
  (`new Usend(key, { baseUrl })`).
- `usend.smtp()` / `smtpConfig(key)` return SMTP settings (host `smtp.usend.et`, port 465 or 587).
- Resources: `emails` (incl. `metrics`, `share`, `test`, `insights`), `batch`, `received`, `templates` (+ `versions`),
  `domains` (+ `claim`, `insights`), `apiKeys`, `audiences`, `segments`, `contacts` (+ `imports`, `topics`),
  `contactProperties`, `topics`, `shortLinks` (+ `stats`), `broadcasts` (+ `cancel`, `duplicate`, `recipients`, `clickedLinks`, `performance`),
  `webhooks` (+ `rotateSecret`, `events`), `suppressions` (+ `createBatch`, `removeBatch`), `events`, `automations`
  (+ `runs`), `inboxes` (+ `labels`, `threads`, `drafts`), `logs`, `stats`, `tools`, `oauth`.
- Every endpoint is described in [`openapi/openapi.yaml`](../../openapi/openapi.yaml) (OpenAPI 3.1).

```js
await usend.events.send({ event: "order.paid", email: "ann@example.com", payload: { total: 42 } });
const { data: inboxes } = await usend.inboxes.list();
await usend.suppressions.createBatch(["a@example.com", "b@example.com"]);

// OAuth (PKCE S256): send the user to authorizeUrl, then exchange the code. No API key is sent.
const url = usend.oauth.authorizeUrl({ client_id, redirect_uri, scope: "sending_access", code_challenge, state });
const { data: tokens } = await usend.oauth.token({ grant_type: "authorization_code", client_id, code, code_verifier, redirect_uri });
```

Send through SMTP (for example with Nodemailer); the API key is the password:

```js
import nodemailer from "nodemailer";

const transport = nodemailer.createTransport(usend.smtp()); // smtp.usend.et:465, or usend.smtp({ port: 587 })
```

Verify a webhook (pass the raw body):

```js
import { verifyWebhook } from "@usend/node";

const event = await verifyWebhook({ payload: rawBody, headers: req.headers, secret: process.env.USEND_WEBHOOK_SECRET });
```

Docs: https://usend.et/docs
