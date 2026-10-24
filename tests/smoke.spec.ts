import { expect, test } from "@playwright/test";

// Plain HTTP checks of what any visitor can reach. They change nothing, so they're safe on production, where they
// run every 30 minutes.

const SECURITY_HEADERS = {
  "content-security-policy": /default-src 'self'.*frame-ancestors 'none'/,
  "x-content-type-options": /^nosniff$/,
  "x-frame-options": /^DENY$/,
  "referrer-policy": /^strict-origin-when-cross-origin$/,
};
const NO_RUN = "00000000-0000-4000-8000-000000000000";

test("the app is up and can reach its database", async ({ request }) => {
  const live = await request.get("/healthz");
  expect(live.status()).toBe(200);
  expect(await live.json()).toMatchObject({ status: "ok" });
  const ready = await request.get("/readyz");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: "ready" });
});

test("the start page asks for a website and a work email", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Find the people at your industry's events");
  expect(html).toContain('name="website"');
  expect(html).toContain('name="email"');
});

test("every page comes with the security headers and a request id", async ({ request, baseURL }) => {
  for (const path of ["/", "/healthz", "/no-such-page"]) {
    const response = await request.get(path);
    const headers = response.headers();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers[name], `${name} on ${path}`).toMatch(value);
    }
    expect(headers["x-request-id"], `x-request-id on ${path}`).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    if (baseURL?.startsWith("https://")) {
      expect(headers["strict-transport-security"], `HSTS on ${path}`).toMatch(/max-age=\d+/);
    }
  }
});

test("the stylesheet is served", async ({ request }) => {
  const response = await request.get("/static/app.css");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/css");
});

test("a run, the console and the operator API are closed to anyone signed out", async ({ request }) => {
  expect((await request.get(`/runs/${NO_RUN}`)).status()).toBe(401);
  expect((await request.get(`/runs/${NO_RUN}/leads.csv`)).status()).toBe(401);
  expect((await request.get("/admin")).status()).toBe(401);
  // 404 where the operator API is off (no OPERATOR_API_TOKEN), 401 where it's on: never anything without a token.
  expect([401, 404]).toContain((await request.get("/admin/api/tasks")).status());
});

test("the outbox shows nothing without the QA token", async ({ request }) => {
  // It doesn't exist in production, and needs an operator or the QA token on previews and staging.
  expect((await request.get("/dev/outbox")).status()).toBe(404);
  expect((await request.get("/dev/outbox/latest?to=someone@example.com")).status()).toBe(404);
});

test("a form posted without its CSRF token is refused", async ({ request }) => {
  const response = await request.post("/start", {
    form: { website: "example.com", email: "qa@example.com" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("This page had expired");
});

test("a body too large is refused before it is read", async ({ request }) => {
  const response = await request.post("/start", {
    data: "x".repeat(300 * 1024),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(response.status()).toBe(413);
});

test("a page that doesn't exist says so", async ({ request }) => {
  expect((await request.get("/no-such-page")).status()).toBe(404);
});
