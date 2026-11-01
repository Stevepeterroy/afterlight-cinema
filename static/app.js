let csrf = "",
  user = null,
  movies = [],
  selectedMovie = null,
  selected = new Set(),
  pending = null;
const $ = (id) => document.getElementById(id),
  money = (n) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(n / 100);
async function api(path, body) {
  const r = await fetch(
    "/api/" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
function message(s) {
  $("message").textContent = s;
}
async function refresh() {
  const state = await api("session");
  csrf = state.csrf;
  user = state.user;
  $("auth").hidden = !!user;
  $("logout").hidden = !user;
  $("identity").textContent = user ? "Signed in as " + user.email : "";
  movies = await api("movies");
  $("movies").replaceChildren();
  movies.forEach((m, i) => {
    const card = document.createElement("article");
    card.className = "movie";
    const poster = document.createElement("div");
    poster.className = "poster";
    poster.textContent = "0" + (i + 1);
    const title = document.createElement("h3");
    title.textContent = m.title;
    const p = document.createElement("p");
    p.textContent =
      money(m.price) + " · " + (40 - m.bookedSeats.length) + " seats available";
    const b = document.createElement("button");
    b.textContent = "Choose seats";
    b.onclick = () => {
      selectedMovie = m;
      selected.clear();
      pending = null;
      drawSeats();
      $("seating").hidden = false;
      $("seating").scrollIntoView({ behavior: "smooth" });
    };
    card.append(poster, title, p, b);
    $("movies").append(card);
  });
  if (user) {
    const bookings = await api("bookings");
    $("bookings").replaceChildren();
    if (!bookings.length)
      $("bookings").textContent = "Your next story starts with a seat.";
    bookings.forEach((b) => {
      const p = document.createElement("p");
      p.textContent = `${b.title} · Seats ${b.seats.join(", ")} · ${money(b.total)} · DEMO UNPAID`;
      $("bookings").append(p);
    });
  } else $("bookings").textContent = "Sign in to view your reservations.";
}
function drawSeats() {
  $("film").textContent = selectedMovie.title;
  $("seats").replaceChildren();
  for (let i = 1; i <= 40; i++) {
    const b = document.createElement("button");
    b.textContent = i;
    b.disabled = selectedMovie.bookedSeats.includes(i);
    b.setAttribute(
      "aria-label",
      "Seat " + i + (b.disabled ? " unavailable" : ""),
    );
    b.setAttribute("aria-pressed", selected.has(i));
    b.onclick = () => {
      if (selected.has(i)) selected.delete(i);
      else if (selected.size < 6) selected.add(i);
      else return message("Choose at most six seats.");
      pending = null;
      drawSeats();
    };
    $("seats").append(b);
  }
  $("total").textContent =
    selected.size + " seats · " + money(selected.size * selectedMovie.price);
}
$("account").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const action = e.submitter.value;
    await api(action, {
      email: $("email").value,
      password: $("password").value,
    });
    $("password").value = "";
    message(
      action === "register"
        ? "Account created. Sign in to reserve."
        : "Welcome back.",
    );
    await refresh();
  } catch (error) {
    message(error.message);
  }
};
$("logout").onclick = async () => {
  try {
    await api("logout", {});
    await refresh();
    message("Signed out.");
  } catch (e) {
    message(e.message);
  }
};
$("reserve").onclick = async () => {
  try {
    if (!user) throw Error("Sign in before reserving seats.");
    if (!selected.size) throw Error("Choose at least one seat.");
    pending ??= crypto.randomUUID();
    $("reserve").disabled = true;
    const result = await api("bookings", {
      movie_id: selectedMovie.id,
      seats: [...selected],
      request_id: pending,
    });
    message(
      "Demo reservation saved: " +
        result.id +
        " · " +
        money(result.total) +
        " · No payment taken.",
    );
    pending = null;
    $("seating").hidden = true;
    await refresh();
  } catch (error) {
    message(error.message);
  } finally {
    $("reserve").disabled = false;
  }
};
refresh().catch((e) => message(e.message));
