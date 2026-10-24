# event-leads-qa

Independent QA for [Event Leads](https://github.com/sdsouza133/events-leads). These tests only see what a user
sees, the pages and their HTTP answers, so they can't share the app's blind spots. They are the "Smoke" and
"End-to-end" layers in the app's [testing strategy](https://github.com/sdsouza133/events-leads/blob/main/docs/TESTING.md).

| Suite | File | What it checks | Where it may run |
|---|---|---|---|
| Smoke | `tests/smoke.spec.ts` | The app is up and reaches its database; the start page; security headers on every response; the stylesheet; runs, the console and the operator API closed to anyone signed out; the outbox closed without the QA token; CSRF refusal; bodies over 256 KB refused; 404s | Anywhere, production included: it changes nothing |
| End-to-end | `tests/e2e.spec.ts` | A real browser through a whole run: the start form, the sign-in link from the email, the plan, approval, the list, and its CSV | Only where emails are kept and `QA_TOKEN` opens the outbox: the local stack, previews, staging. Never production |

The end-to-end test checks first that `QA_TOKEN` opens the site's outbox, and fails before creating anything if it
doesn't, so a token set by mistake for production can't start a run there.

## Running it

You need Node 22 and Docker. The tests run against the app started from a checkout of `events-leads`, with fake
providers (no real API is called) and a throwaway Postgres:

```bash
git clone https://github.com/sdsouza133/events-leads app          # any branch or commit you want to test
export SECRET_KEY=$(openssl rand -hex 32) QA_TOKEN=$(openssl rand -hex 24)
docker compose up --build --detach --wait web worker
npm ci
npx playwright install chromium
npx playwright test                   # both suites; --project=smoke or --project=e2e for one
docker compose down --volumes         # when you're done
```

To test a deployed site instead, point `QA_BASE_URL` at it. Without `QA_TOKEN` only the smoke tests run:

```bash
QA_BASE_URL=https://events.theb2bdynamics.com npx playwright test
```

| Variable | Default | What it's for |
|---|---|---|
| `QA_BASE_URL` | `http://localhost:8000` | The site under test |
| `QA_TOKEN` | unset | Opens the site's outbox (`X-QA-Token`), which the end-to-end test needs. Except on the local stack, the tests refuse to start unless the site uses HTTPS, and requests carrying it never follow a redirect |
| `QA_DOMAIN` | `example.org` | The test company. A reserved domain: the fake providers' people work at example.com, and the app leaves out anyone at the requester's own company |

## CI

`.github/workflows/qa.yml` runs both suites on every pull request and every push to `main`, against the app built
from `events-leads` `main` (or the `APP_REF` repository variable). Run it by hand from the Actions tab to test another
`app_ref`, or a deployed site with `base_url`. The end-to-end test runs there only if the `QA_TOKEN` secret is set.
A failed run uploads the Playwright report and prints the app's logs. Against the local stack the report holds a trace
of each failed test. Against a deployed site there is no trace, since a trace records request headers, the QA token
included.

Tests never retry: a test that passes on its second try is a bug to find, not a result to report.
