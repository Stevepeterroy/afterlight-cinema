const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { Store } = require("./store");
const { randomUUID } = require("node:crypto");
const { createServer } = require("./server");
function setup(t) {
  const s = new Store(":memory:");
  t.after(() => s.close());
  s.register("a@example.test", "long-local-password");
  const token = s.login("a@example.test", "long-local-password");
  return { s, user: s.user(token), token };
}
test("passwords, sessions, logout and invalid input", (t) => {
  const { s, user, token } = setup(t);
  assert.ok(user.id);
  assert.throws(() => s.login("a@example.test", "incorrect"));
  assert.throws(() => s.register("bad", "short"));
  s.logout(token);
  assert.equal(s.user(token), null);
});
test("server pricing, stock conflict, atomic rollback and replay", (t) => {
  const { s, user } = setup(t);
  const body = {
    movie_id: 1,
    seats: [1, 2],
    request_id: randomUUID(),
    total: 1,
    payment: "paid",
  };
  const first = s.book(user.id, body);
  assert.equal(first.total, 40000);
  assert.equal(first.payment, "DEMO_UNPAID");
  assert.deepEqual(s.book(user.id, body), first);
  assert.throws(() => s.book(user.id, { ...body, seats: [3] }));
  assert.throws(() =>
    s.book(user.id, { movie_id: 1, seats: [3, 2], request_id: randomUUID() }),
  );
  assert.equal(s.movies()[0].bookedSeats.includes(3), false);
  assert.equal(s.bookings(user.id).length, 1);
});
test("account isolation and invalid seats", (t) => {
  const { s, user } = setup(t);
  const b = { movie_id: 1, seats: [1], request_id: randomUUID() };
  s.book(user.id, b);
  s.register("b@example.test", "long-local-password");
  const other = s.user(s.login("b@example.test", "long-local-password"));
  assert.equal(s.bookings(other.id).length, 0);
  assert.throws(() => s.book(other.id, b));
  for (const seats of [[], [1, 1], [0], [41], ["1"], [1, 2, 3, 4, 5, 6, 7]])
    assert.throws(() =>
      s.book(user.id, { ...b, seats, request_id: randomUUID() }),
    );
});
test("HTTP authorization, CSRF, malformed body and static assets", async (t) => {
  const { s } = setup(t);
  const server = createServer(s);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(base + "/api/bookings")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/../store.js")).status, 404);
  assert.equal((await fetch(base + "/api/movies")).status, 200);
});

test("HTTP register, login, booking ownership, price and logout", async (t) => {
  const store = new Store(":memory:");
  const server = createServer(store);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const state = await fetch(base + "/api/session");
  const csrf = (await state.json()).csrf;
  let cookies = "csrf=" + csrf;
  async function post(path, data, origin = base) {
    const res = await fetch(base + "/api/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        Cookie: cookies,
        Origin: origin,
      },
      body: JSON.stringify(data),
    });
    return res;
  }
  const account = {
    email: "http-demo@example.test",
    password: "local-test-password-only",
  };
  assert.equal(
    (await post("register", account, "http://wrong.test")).status,
    403,
  );
  assert.equal((await post("register", account)).status, 201);
  const login = await post("login", account);
  assert.equal(login.status, 200);
  cookies += "; " + login.headers.get("set-cookie").split(";")[0];
  const booking = await post("bookings", {
    movie_id: 1,
    seats: [5, 6],
    request_id: randomUUID(),
    total: 1,
    payment: "paid",
  });
  assert.equal(booking.status, 201);
  assert.equal((await booking.json()).total, 40000);
  const listing = await fetch(base + "/api/bookings", {
    headers: { Cookie: cookies },
  });
  assert.equal((await listing.json()).length, 1);
  assert.equal((await post("logout", {})).status, 200);
  assert.equal(
    (await fetch(base + "/api/bookings", { headers: { Cookie: cookies } }))
      .status,
    401,
  );
});
