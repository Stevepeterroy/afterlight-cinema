const { DatabaseSync } = require("node:sqlite");
const {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} = require("node:crypto");
class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password TEXT);
 CREATE TABLE IF NOT EXISTS movies(id INTEGER PRIMARY KEY,title TEXT,price INTEGER);
 CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),movie_id INTEGER REFERENCES movies(id),total INTEGER,request_id TEXT UNIQUE);
 CREATE TABLE IF NOT EXISTS seats(movie_id INTEGER,seat INTEGER,booking_id TEXT REFERENCES bookings(id),PRIMARY KEY(movie_id,seat));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);`);
    if (!this.db.prepare("SELECT count(*) AS n FROM movies").get().n) {
      for (const title of [
        "The Last Horizon",
        "Monsoon Letters",
        "Midnight Orbit",
      ])
        this.db
          .prepare("INSERT INTO movies(title,price) VALUES(?,?)")
          .run(title, 20000);
    }
  }
  register(email, password) {
    if (
      typeof email !== "string" ||
      !/^([^\s@]{1,64})@([^\s@.]+\.)+[^\s@.]+$/.test(email) ||
      email.length > 254 ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      throw Error("Valid email and 12–128 character password required");
    email = email.toLowerCase();
    const salt = randomBytes(16).toString("hex");
    try {
      this.db
        .prepare("INSERT INTO users(email,password) VALUES(?,?)")
        .run(
          email,
          salt + ":" + scryptSync(password, salt, 64).toString("hex"),
        );
    } catch (e) {
      if (e.code?.startsWith("ERR_SQLITE")) throw Error("Email unavailable");
      throw e;
    }
  }
  login(email, password) {
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 128
    )
      throw Error("Invalid credentials");
    const row = this.db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.toLowerCase());
    const [salt, hash] = (row?.password || "dummy:" + "0".repeat(128)).split(
      ":",
    );
    const match = timingSafeEqual(
      scryptSync(password, salt, 64),
      Buffer.from(hash, "hex"),
    );
    if (!row || !match) throw Error("Invalid credentials");
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(token, row.id, Date.now() + 3600000);
    return token;
  }
  user(token) {
    if (typeof token !== "string" || token.length > 100) return null;
    return (
      this.db
        .prepare(
          "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        )
        .get(token, Date.now()) || null
    );
  }
  logout(token) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  }
  movies() {
    return this.db
      .prepare("SELECT * FROM movies")
      .all()
      .map((m) => ({
        ...m,
        bookedSeats: this.db
          .prepare("SELECT seat FROM seats WHERE movie_id=?")
          .all(m.id)
          .map((s) => s.seat),
      }));
  }
  bookings(user) {
    return this.db
      .prepare(
        "SELECT b.id,b.movie_id,m.title,b.total FROM bookings b JOIN movies m ON m.id=b.movie_id WHERE user_id=?",
      )
      .all(user)
      .map((b) => ({
        ...b,
        seats: this.db
          .prepare("SELECT seat FROM seats WHERE booking_id=? ORDER BY seat")
          .all(b.id)
          .map((s) => s.seat),
        payment: "DEMO_UNPAID",
      }));
  }
  book(user, body) {
    if (
      !body ||
      typeof body !== "object" ||
      !Number.isInteger(body.movie_id) ||
      !Array.isArray(body.seats) ||
      body.seats.length < 1 ||
      body.seats.length > 6 ||
      body.seats.some((s) => !Number.isInteger(s) || s < 1 || s > 40) ||
      new Set(body.seats).size !== body.seats.length ||
      typeof body.request_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.request_id,
      )
    )
      throw Error("Choose 1–6 distinct seats (1–40) and a valid request ID");
    const { movie_id, request_id } = body;
    const seats = [...body.seats].sort((a, b) => a - b);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT * FROM bookings WHERE request_id=?")
        .get(request_id);
      if (old) {
        const prior = this.db
          .prepare("SELECT seat FROM seats WHERE booking_id=? ORDER BY seat")
          .all(old.id)
          .map((s) => s.seat);
        if (
          old.user_id !== user ||
          old.movie_id !== movie_id ||
          JSON.stringify(prior) !== JSON.stringify(seats)
        )
          throw Error("Request ID conflict");
        this.db.exec("COMMIT");
        return { id: old.id, total: old.total, payment: "DEMO_UNPAID" };
      }
      const movie = this.db
        .prepare("SELECT * FROM movies WHERE id=?")
        .get(movie_id);
      if (!movie) throw Error("Movie unavailable");
      const id = randomUUID(),
        total = movie.price * seats.length;
      this.db
        .prepare("INSERT INTO bookings VALUES(?,?,?,?,?)")
        .run(id, user, movie_id, total, request_id);
      for (const seat of seats) {
        if (
          this.db
            .prepare("SELECT 1 FROM seats WHERE movie_id=? AND seat=?")
            .get(movie_id, seat)
        )
          throw Error("A selected seat is already booked");
        this.db
          .prepare("INSERT INTO seats VALUES(?,?,?)")
          .run(movie_id, seat, id);
      }
      this.db.exec("COMMIT");
      return { id, total, payment: "DEMO_UNPAID" };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
