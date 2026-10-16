export interface UsendError {
  statusCode: number | null;
  name: string;
  message: string;
}
export type Response<T> = Promise<{ data: T; error: null } | { data: null; error: UsendError }>;

export interface Attachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  content_type?: string;
}
export interface Tag {
  name: string;
  value: string;
}
export interface SendEmail {
  from?: string;
  to: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  headers?: Record<string, string>;
  tags?: Tag[];
  attachments?: Attachment[];
  /** ISO 8601, or "in 1 hour", "tomorrow at 9am" (UTC). Up to 30 days ahead. */
  scheduled_at?: string;
  template?: { id: string; variables?: Record<string, string | number> };
}
export interface RequestOptions {
  idempotencyKey?: string;
}
export interface List<T> {
  object: "list";
  data: T[];
  has_more?: boolean;
}
export interface Page {
  limit?: number;
  after?: string;
  before?: string;
}
type Obj = Record<string, any>;

export declare class Usend {
  constructor(apiKey?: string, options?: { baseUrl?: string; fetch?: typeof fetch });
  /** SMTP settings for this key, in Nodemailer's shape. */
  smtp(options?: SmtpOptions): SmtpConfig;
  emails: {
    send(email: SendEmail, options?: RequestOptions): Response<{ id: string }>;
    get(id: string): Response<Obj>;
    list(params?: Page): Response<List<Obj>>;
    update(params: { id: string; scheduled_at: string }): Response<{ object: "email"; id: string }>;
    cancel(id: string): Response<{ object: "email"; id: string }>;
    events(id: string): Response<List<Obj>>;
    attachments: {
      list(emailId: string): Response<List<Obj>>;
      get(emailId: string, id: string): Response<Obj>;
    };
    metrics(params?: Obj): Response<Obj>;
    share(id: string, options?: { expiresIn?: string; expires_in?: string }): Response<{ object: "email"; id: string; url: string }>;
    /** Dashboard sessions only: API keys get 403. */
    test(email: { from: string; subject?: string; html?: string; text?: string }): Response<{ id: string; to: string }>;
    insights(id: string): Response<Obj>;
  };
  batch: {
    send(
      emails: SendEmail[],
      options?: RequestOptions & { validation?: "strict" | "permissive" },
    ): Response<{ data: { id: string }[]; errors?: { index: number; message: string }[] }>;
  };
  received: {
    list(params?: Page): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    raw(id: string): Response<string>;
    attachments: { list(id: string): Response<List<Obj>>; get(id: string, attachmentId: string): Response<Obj> };
    download(id: string, attachmentId: string): Response<ArrayBuffer>;
  };
  templates: {
    create(t: Obj): Response<{ object: "template"; id: string }>;
    list(params?: Page): Response<List<Obj>>;
    get(idOrAlias: string): Response<Obj>;
    update(idOrAlias: string, t: Obj): Response<{ object: "template"; id: string }>;
    publish(idOrAlias: string): Response<{ object: "template"; id: string }>;
    duplicate(idOrAlias: string): Response<{ object: "template"; id: string }>;
    remove(idOrAlias: string): Response<Obj>;
    versions: {
      list(idOrAlias: string): Response<List<Obj>>;
      get(idOrAlias: string, versionId: string): Response<Obj>;
      restore(idOrAlias: string, versionId: string): Response<Obj>;
    };
  };
  domains: {
    create(d: { name: string; custom_return_path?: string }): Response<Obj>;
    list(): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(d: { id: string; open_tracking?: boolean; click_tracking?: boolean; receiving_enabled?: boolean; custom_return_path?: string }): Response<Obj>;
    verify(id: string): Response<Obj>;
    autoConfigure(id: string, body: { provider: "cloudflare"; api_token: string }): Response<Obj>;
    remove(id: string): Response<Obj>;
    insights(id: string): Response<Obj>;
    claim: {
      create(d: { name: string; custom_return_path?: string; open_tracking?: boolean; click_tracking?: boolean }): Response<Obj>;
      get(id: string): Response<Obj>;
      verify(id: string): Response<Obj>;
    };
  };
  apiKeys: {
    create(k: { name: string; permission?: "full_access" | "sending_access"; domain_id?: string }): Response<{ id: string; token: string }>;
    list(): Response<List<Obj>>;
    update(id: string, k: { name?: string; permission?: "full_access" | "sending_access"; domain_id?: string | null }): Response<Obj>;
    remove(id: string): Response<Obj>;
  };
  audiences: {
    create(a: { name: string }): Response<Obj>;
    list(): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    remove(id: string): Response<Obj>;
    contacts: {
      create(audienceId: string, c: Obj): Response<Obj>;
      list(audienceId: string, params?: Page): Response<List<Obj>>;
      import(audienceId: string, csv: string): Response<Obj>;
      get(audienceId: string, idOrEmail: string): Response<Obj>;
      update(audienceId: string, idOrEmail: string, c: Obj): Response<Obj>;
      remove(audienceId: string, idOrEmail: string): Response<Obj>;
    };
  };
  segments: {
    create(s: { name: string }): Response<Obj>;
    list(): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, s: { name: string }): Response<Obj>;
    remove(id: string): Response<Obj>;
    contacts(id: string, params?: Page & { subscription?: "subscribed" | "unsubscribed" }): Response<List<Obj>>;
    metrics(id: string): Response<Obj>;
  };
  contacts: {
    create(c: { email: string; first_name?: string; last_name?: string; unsubscribed?: boolean; segments?: string[] }): Response<{ object: "contact"; id: string }>;
    list(params?: Page & { segment_id?: string; topic_id?: string; subscription?: "subscribed" | "unsubscribed"; q?: string }): Response<List<Obj>>;
    stats(): Response<{ object: "contact_stats"; total: number; subscribers: number; unsubscribers: number }>;
    import(body: { csv: string; segment_id?: string }): Response<Obj>;
    imports: {
      create(body: { segment_id?: string; csv?: string; contacts?: Obj[] }): Response<Obj>;
      list(params?: Page & { status?: string }): Response<List<Obj>>;
      get(id: string): Response<Obj>;
    };
    topics: {
      list(idOrEmail: string): Response<List<Obj>>;
      update(idOrEmail: string, topics: { id: string; subscription: "opt_in" | "opt_out" }[]): Response<Obj>;
    };
    get(idOrEmail: string): Response<Obj>;
    update(idOrEmail: string, c: Obj): Response<Obj>;
    remove(idOrEmail: string): Response<Obj>;
    segments: {
      list(idOrEmail: string): Response<List<Obj>>;
      add(idOrEmail: string, segmentId: string): Response<Obj>;
      remove(idOrEmail: string, segmentId: string): Response<Obj>;
    };
  };
  contactProperties: {
    create(p: { key: string; type: "string" | "number" | "boolean" | "date"; fallback_value?: any }): Response<Obj>;
    list(): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, p: { fallback_value: any }): Response<Obj>;
    remove(id: string): Response<Obj>;
  };
  topics: {
    create(t: { name: string; description?: string; default_subscription?: "opt_in" | "opt_out" }): Response<Obj>;
    list(): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, t: Obj): Response<Obj>;
    remove(id: string): Response<Obj>;
  };
  shortLinks: {
    create(link: { target_url: string; code?: string; title?: string; expires_at?: string }): Response<Obj>;
    list(params?: { limit?: number; after?: string; before?: string }): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, link: { target_url?: string; title?: string; expires_at?: string | null; disabled?: boolean }): Response<Obj>;
    remove(id: string): Response<Obj>;
    stats(id: string, params?: { days?: number }): Response<Obj>;
  };
  broadcasts: {
    create(b: { audience_id: string; from: string; subject: string; html?: string; text?: string; reply_to?: string | string[]; name?: string }): Response<{ id: string }>;
    list(params?: Obj): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, b: Obj): Response<Obj>;
    send(id: string, body?: { scheduled_at?: string }): Response<{ id: string }>;
    test(id: string, to: string): Response<{ id: string }>;
    remove(id: string): Response<Obj>;
    cancel(id: string): Response<Obj>;
    duplicate(id: string): Response<Obj>;
    recipients(id: string, params: Page & { type: "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed" | "suppressed"; email?: string; bounce_type?: "permanent" | "transient" | "undetermined" }): Response<List<Obj>>;
    clickedLinks(id: string): Response<List<Obj>>;
    performance(id: string): Response<Obj>;
  };
  webhooks: {
    create(w: { endpoint: string; events: string[] }): Response<Obj>;
    list(): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, w: { endpoint?: string; events?: string[]; enabled?: boolean }): Response<Obj>;
    remove(id: string): Response<Obj>;
    deliveries(id: string, params?: Page): Response<List<Obj>>;
    replay(id: string, deliveryId: string): Response<Obj>;
    rotateSecret(id: string): Response<{ object: "webhook"; id: string; signing_secret: string }>;
    events: {
      list(params?: Page & { webhook_id?: string; type?: string; status?: "pending" | "succeeded" | "failed" }): Response<List<Obj>>;
      get(id: string): Response<Obj>;
      replay(id: string): Response<Obj>;
      attempts(id: string): Response<List<Obj>>;
    };
    verify: typeof verifyWebhook;
  };
  suppressions: {
    list(params?: Page): Response<List<Obj>>;
    create(s: { email: string }): Response<Obj>;
    get(idOrEmail: string): Response<Obj>;
    remove(idOrEmail: string): Response<Obj>;
    createBatch(emails: string[]): Response<List<Obj>>;
    removeBatch(emails: string[]): Response<List<Obj>>;
  };
  events: {
    create(e: { name: string; schema?: Record<string, "string" | "number" | "boolean" | "date"> }): Response<Obj>;
    list(params?: Page): Response<List<Obj>>;
    get(idOrName: string): Response<Obj>;
    update(id: string, e: { name?: string; schema?: Obj | null }): Response<Obj>;
    remove(id: string): Response<Obj>;
    send(body: { event: string; contact_id?: string; email?: string; payload?: Obj }, options?: RequestOptions): Response<{ object: "event"; event: string; id: string }>;
  };
  automations: {
    create(a: { name: string; status?: "draft" | "enabled" | "disabled"; steps: Obj[]; connections: Obj[] }): Response<Obj>;
    list(params?: Page & { status?: string }): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, a: Obj): Response<Obj>;
    remove(id: string): Response<Obj>;
    duplicate(id: string): Response<Obj>;
    stop(id: string): Response<{ id: string; status: "stopped"; cancelled_runs: number }>;
    runs: {
      list(id: string, params?: Page & { status?: "running" | "completed" | "failed" | "cancelled" }): Response<List<Obj>>;
      get(id: string, runId: string): Response<Obj>;
    };
  };
  inboxes: {
    create(i: { name: string; address: string; enabled?: boolean }): Response<Obj>;
    list(params?: Page): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    update(id: string, i: { name?: string; enabled?: boolean }): Response<Obj>;
    remove(id: string): Response<Obj>;
    labels: {
      create(inboxId: string, l: { name: string; color?: string }): Response<Obj>;
      list(inboxId: string): Response<List<Obj>>;
      get(inboxId: string, id: string): Response<Obj>;
      update(inboxId: string, id: string, l: { name?: string; color?: string }): Response<Obj>;
      remove(inboxId: string, id: string): Response<Obj>;
    };
    threads: {
      list(inboxId: string, params?: Page & { folder?: "inbox" | "archive" | "spam" | "trash"; label?: string; assignee?: string; unread?: boolean; q?: string }): Response<List<Obj>>;
      get(inboxId: string, id: string): Response<Obj>;
      update(inboxId: string, id: string, t: { folder?: string; labels?: string[]; assignee_user_id?: string | null; read?: boolean }): Response<Obj>;
      remove(inboxId: string, id: string): Response<Obj>;
      emails: {
        list(inboxId: string, threadId: string, params?: Page): Response<List<Obj>>;
        get(inboxId: string, threadId: string, id: string): Response<Obj>;
        reply(inboxId: string, threadId: string, id: string, body: { text?: string; html?: string; to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; reply_all?: boolean }): Response<Obj>;
        forward(inboxId: string, threadId: string, id: string, body: { to: string[]; text?: string; html?: string; cc?: string[]; bcc?: string[]; subject?: string }): Response<Obj>;
      };
    };
    drafts: {
      create(inboxId: string, d: Obj): Response<Obj>;
      list(inboxId: string, params?: Page): Response<List<Obj>>;
      get(inboxId: string, id: string): Response<Obj>;
      update(inboxId: string, id: string, d: Obj): Response<Obj>;
      remove(inboxId: string, id: string): Response<Obj>;
      send(inboxId: string, id: string): Response<Obj>;
    };
  };
  logs: {
    list(params?: Page & { status?: string; method?: string; source?: "api" | "dashboard"; user_agent?: string; api_key_id?: string; q?: string; days?: number }): Response<List<Obj>>;
    get(id: string): Response<Obj>;
    userAgents(): Response<{ data: string[] }>;
  };
  stats: { get(params?: { days?: number }): Response<Obj> };
  tools: { dmarcCheck(domain: string): Response<Obj> };
  /** OAuth 2.0 (PKCE S256). These calls send no API key. Errors carry the OAuth error code as `name`. */
  oauth: {
    metadata(): Response<Obj>;
    register(client: { client_name: string; redirect_uris: string[] }): Response<Obj>;
    token(body: { grant_type: "authorization_code" | "refresh_token"; client_id: string; code?: string; code_verifier?: string; redirect_uri?: string; refresh_token?: string }): Response<{ access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string }>;
    revoke(body: { token: string; client_id?: string }): Response<Obj>;
    authorizeUrl(params: { client_id: string; redirect_uri: string; scope: string; code_challenge: string; state?: string }): string;
  };
}

export interface SmtpOptions {
  /** 465 = implicit TLS (default), 587 = STARTTLS. */
  port?: 465 | 587;
  /** Defaults to USEND_SMTP_HOST, then smtp.<domain> of the base URL, then smtp.usend.et. */
  host?: string;
  baseUrl?: string;
}
export interface SmtpConfig {
  host: string;
  port: 465 | 587;
  secure: boolean;
  auth: { user: string; pass: string };
}

/** SMTP settings for sending through usend with an API key; pass to nodemailer.createTransport(). */
export declare function smtpConfig(apiKey?: string, options?: SmtpOptions): SmtpConfig;

/** Verifies a webhook delivery (Standard Webhooks) and returns the parsed event; throws if it is not authentic. */
export declare function verifyWebhook(args: {
  payload: string;
  headers: Headers | Record<string, string | undefined>;
  secret: string;
  toleranceSeconds?: number;
}): Promise<{ type: string; created_at: string; data: Obj }>;

export default Usend;
