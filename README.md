# Afterlight Cinema — local booking demo

This is the active reproducible portfolio demo. `../Source` is retained historical MySQL coursework, with known authentication/payment defects; do not deploy it. No old database is modified or migrated by this demo.

Requires Node 24.2+ (built-in SQLite; may print an experimental API notice). No npm dependencies or external services.

```sh
npm test
npm start
```

Open http://127.0.0.1:8795. Register a fictional account with a 12+ character password, sign in, choose 1–6 numbered seats and reserve. This creates a DEMO_UNPAID reservation, never a real ticket/payment. Passwords use salted scrypt, sessions are opaque and HttpOnly/SameSite, POSTs require a CSRF token, bookings are account-scoped, price comes from the server, and SQLite transaction/unique seat constraints prevent overselling. UUID retries return the original reservation, and mismatched retries are rejected. Three fictional films are seeded once.

Local-only: no TLS, admin UI, real show schedules, cancellations/refunds, email verification, password reset or payment-provider integration. Rate limiting is per process. No production-readiness claim. Original coursework attribution is retained. PORT and MOVIE_DB configure the local port/database.
