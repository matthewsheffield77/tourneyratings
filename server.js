// TourneyRatings -- youth hockey tournaments, rated by parents.
// A deliberately boring stack: Express + Postgres (pg), server-rendered
// pages, one small client script. Easy to run, easy to keep running.

"use strict";

const path = require("path");
const express = require("express");
const db = require("./lib/db");
const views = require("./lib/views");
const EVENT_LINKS = require("./lib/event-links.json");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// --- Helpers ---------------------------------------------------------------

async function tournamentsWithRatings() {
  const [tournaments, reviews] = await Promise.all([
    db.listTournaments(),
    db.listReviews(null),
  ]);
  const byTournament = new Map();
  for (const r of reviews) {
    if (!byTournament.has(r.tournamentId)) byTournament.set(r.tournamentId, []);
    byTournament.get(r.tournamentId).push(r);
  }
  return tournaments.map((t) => ({
    t,
    reviews: byTournament.get(t.id) || [],
    agg: views.aggregate(byTournament.get(t.id) || []),
  }));
}

function parseFilters(query) {
  const multi = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter(Boolean);
  return {
    q: String(query.q || "").trim(),
    state: String(query.state || "").trim(),
    age: String(query.age || "").trim(),
    level: String(query.level || "").trim(),
    stp: ["yes", "no"].includes(query.stp) ? query.stp : "",
    tag: views.FILTERABLE_TAGS.some((x) => x.name === String(query.tag || "").trim())
      ? String(query.tag).trim()
      : "",
    sort: ["date", "fee-asc", "fee-desc", "rating", "state", "name"].includes(query.sort)
      ? query.sort
      : "date",
    month: /^(0[1-9]|1[0-2])$/.test(String(query.month || "").trim())
      ? String(query.month).trim()
      : "",
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    myAges: multi(query.myAges).filter((a) => views.AGE_GROUPS.includes(a)),
    myLevels: multi(query.myLevels).filter((l) => views.LEVELS.includes(l)),
    div: views.DIVISIONS.includes(String(query.div || "").trim())
      ? String(query.div).trim()
      : "",
    myDivs: multi(query.myDivs).filter((d) => views.DIVISIONS.includes(d)),
  };
}

function selectedDivs(f) {
  const out = new Set(f.myDivs);
  if (f.div) out.add(f.div);
  return [...out];
}

function matchesDivisions(t, f) {
  const divs = selectedDivs(f);
  if (!divs.length) return true;
  const have = views.divisionTokens(t);
  return divs.some((d) => have.has(d));
}

function matchesMyPlayer(t, f) {
  if (f.myAges.length) {
    const ages = views.ageTokens(t);
    if (!f.myAges.some((a) => ages.has(a))) return false;
  }
  if (f.myLevels.length) {
    const levels = views.levelTokens(t);
    if (!f.myLevels.some((l) => levels.has(l))) return false;
  }
  if (f.myDivs.length) {
    const divs = views.divisionTokens(t);
    if (!f.myDivs.some((d) => divs.has(d))) return false;
  }
  return true;
}

function applyFilters(items, f) {
  let out = items.filter(({ t }) => {
    if (f.q) {
      const hay = `${t.name} ${t.organizer} ${t.city} ${t.venue} ${t.state}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    if (f.state && t.state !== f.state) return false;
    if (f.age && !views.ageTokens(t).has(f.age)) return false;
    if (f.level && !views.levelTokens(t).has(f.level)) return false;
    if (f.stp === "yes" && t.stayToPlay !== true) return false;
    if (f.stp === "no" && t.stayToPlay !== false) return false;
    if (f.month && String(t.startDate).slice(5, 7) !== f.month) return false;
    if (f.tag && !(t.experienceTags || []).includes(f.tag)) return false;
    if (!matchesDivisions(t, f)) return false;
    if (!matchesMyPlayer(t, f)) return false;
    return true;
  });

  const byName = (a, b) => a.t.name.localeCompare(b.t.name);
  if (f.sort === "fee-asc" || f.sort === "fee-desc") {
    const dir = f.sort === "fee-asc" ? 1 : -1;
    out.sort((a, b) => {
      const fa = a.t.entryFeeCents;
      const fb = b.t.entryFeeCents;
      if (fa == null && fb == null) return byName(a, b);
      if (fa == null) return 1; // unpriced listings always last
      if (fb == null) return -1;
      return (fa - fb) * dir || byName(a, b);
    });
  } else if (f.sort === "state") {
    out.sort(
      (a, b) =>
        a.t.state.localeCompare(b.t.state) ||
        a.t.city.localeCompare(b.t.city) ||
        byName(a, b)
    );
  } else if (f.sort === "name") {
    out.sort((a, b) => byName(a, b) || a.t.startDate.localeCompare(b.t.startDate));
  } else if (f.sort === "rating") {
    out.sort((a, b) => {
      const oa = a.agg.overall;
      const ob = b.agg.overall;
      if (oa == null && ob == null) return byName(a, b);
      if (oa == null) return 1; // unrated always last
      if (ob == null) return -1;
      return ob - oa || b.agg.count - a.agg.count || byName(a, b);
    });
  } else {
    out.sort((a, b) => a.t.startDate.localeCompare(b.t.startDate) || byName(a, b));
  }
  return out;
}

function cleanText(v, max) {
  return String(v || "").trim().slice(0, max);
}

function parseScore(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// Fire-and-forget page-view counting by section (feeds the admin stats).
// A counting failure must never break a page, so errors are swallowed.
function track(section) {
  db.recordPageView(section).catch(() => {});
}

// --- Routes ------------------------------------------------------------------

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.get("/favicon.ico", (req, res) => res.redirect(302, "/images/logo-tr-puck.png"));

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(
    "User-agent: *\nAllow: /\n\nSitemap: https://tourneyratings.com/sitemap.xml\n"
  );
});

app.get("/sitemap.xml", async (req, res, next) => {
  try {
    const base = "https://tourneyratings.com";
    const staticPaths = ["/", "/tournaments", "/top-rated", "/useful-websites", "/swag", "/founder", "/accessibility", "/terms", "/privacy", "/advertise", "/list-your-tournament", "/suggestions"];
    const tournaments = await db.listTournaments();
    const urls = staticPaths.concat(tournaments.map((t) => `/tournaments/${t.id}`));
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join("\n") +
      "\n</urlset>\n";
    res.type("application/xml").send(xml);
  } catch (err) {
    next(err);
  }
});

app.get("/", async (req, res, next) => {
  try {
    track("home");
    const items = await tournamentsWithRatings();
    const rated = items
      .filter((x) => x.agg.overall != null)
      .sort((a, b) => b.agg.overall - a.agg.overall || b.agg.count - a.agg.count);
    const featured = items
      .filter((x) => x.t.featured)
      .sort((a, b) => a.t.startDate.localeCompare(b.t.startDate))
      .slice(0, 3);
    const bellItem = items.find((x) => x.t.id === 13);
    const bellReview = bellItem.reviews.find((r) => r.reviewerName === "Matthew S.") || bellItem.reviews[0];
    const totals = {
      tournaments: items.length,
      reviews: items.reduce((n, x) => n + x.reviews.length, 0),
    };
    res.send(
      views.homePage({
        topRated: rated.slice(0, 5),
        featured,
        bell: bellItem.t,
        bellAgg: bellItem.agg,
        bellReview,
        totals,
      })
    );
  } catch (err) {
    next(err);
  }
});

app.get("/tournaments", async (req, res, next) => {
  try {
    track("calendar");
    const items = await tournamentsWithRatings();
    const filters = parseFilters(req.query);
    // Every state is listed in the filter, even with no tournaments yet —
    // states with zero listings are labeled "no tournament listed".
    const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
    // All 13 Canadian provinces and territories, listed in the filter the
    // same way as US states (zero-count ones included).
    const CANADA = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
    // Canonicalize the location filter to the stored code's exact casing
    // (US codes are uppercase; country names are not).
    if (filters.state) {
      const known = [...US_STATES, ...CANADA, ...items.map(({ t }) => t.state)];
      const canonical = known.find(
        (c) => c.toUpperCase() === filters.state.toUpperCase()
      );
      if (canonical) filters.state = canonical;
    }
    const filtered = applyFilters(items, filters);
    const PAGE_SIZE = 20;
    const totalCount = filtered.length;
    const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const stateCounts = {};
    items.forEach(({ t }) => {
      stateCounts[t.state] = (stateCounts[t.state] || 0) + 1;
    });
    const states = [...US_STATES]
      .sort()
      .map((code) => ({ code, count: stateCounts[code] || 0 }));
    // Canada gets its own group, built exactly like the US group.
    const canadaStates = [...CANADA]
      .sort()
      .map((code) => ({ code, count: stateCounts[code] || 0 }));
    // Any other code in the data is a country (international listings);
    // those get their own group in the location filter.
    const intlStates = Object.keys(stateCounts)
      .filter((c) => !US_STATES.includes(c) && !CANADA.includes(c))
      .sort()
      .map((code) => ({ code, count: stateCounts[code] }));
    // My Player live-count data: token sets for every tournament.
    const myPlayerData = items.map(({ t }) => ({
      ages: [...views.ageTokens(t)],
      levels: [...views.levelTokens(t)],
      divs: [...views.divisionTokens(t)],
    }));
    const matchCount = items.filter(({ t }) => matchesMyPlayer(t, filters)).length;
    res.send(
      views.tournamentsPage({
        items: pageItems,
        totalCount,
        page,
        pageCount,
        states,
        canadaStates,
        intlStates,
        filters,
        myPlayerData,
        matchCount,
      })
    );
  } catch (err) {
    next(err);
  }
});

app.get("/tournaments/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = Number.isInteger(id) ? await db.getTournament(id) : null;
    if (!t) return res.status(404).send(views.notFoundPage());
    track("tournament pages");
    const reviews = await db.listReviews(id);
    res.send(
      views.tournamentPage({
        t,
        eventUrl: EVENT_LINKS[String(id)] || null,
        agg: views.aggregate(reviews),
        reviews,
        thanks: req.query.thanks === "1",
      })
    );
  } catch (err) {
    next(err);
  }
});

app.get("/tournaments/:id/rate", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = Number.isInteger(id) ? await db.getTournament(id) : null;
    if (!t) return res.status(404).send(views.notFoundPage());
    res.send(views.ratePage({ t, error: null }));
  } catch (err) {
    next(err);
  }
});

app.post("/tournaments/:id/reviews", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = Number.isInteger(id) ? await db.getTournament(id) : null;
    if (!t) return res.status(404).send(views.notFoundPage());

    const b = req.body || {};
    const scores = {
      level: parseScore(b.level),
      organization: parseScore(b.organization),
      stayToPlay: parseScore(b.stayToPlay),
      facilities: parseScore(b.facilities),
      value: parseScore(b.value),
    };
    const reviewerName =
      b.hideName === "yes" ? "Anonymous hockey parent" : cleanText(b.reviewerName, 60);
    if (!reviewerName || Object.values(scores).some((s) => s == null)) {
      return res
        .status(400)
        .send(views.ratePage({ t, error: "Please add a name to show on your review (or check the hide-my-name box) and a 1–5 score for all five criteria." }));
    }
    const videoPolicy = Object.keys(views.VIDEO_POLICIES).includes(b.videoPolicy)
      ? b.videoPolicy
      : "not-reported";
    const vendors = Object.keys(views.VENDORS).includes(b.vendors)
      ? b.vendors
      : "not-reported";
    const food = Object.keys(views.FOOD).includes(b.food)
      ? b.food
      : "not-reported";
    const extraNight = Object.keys(views.EXTRA_NIGHT).includes(b.extraNight)
      ? b.extraNight
      : "not-reported";
    const yr = parseInt(b.attendedYear, 10);
    const attendedYear =
      Number.isInteger(yr) && yr >= 2000 && yr <= new Date().getFullYear() + 1
        ? yr
        : null;
    await db.addReview(id, {
      reviewerName,
      teamAgeGroup: cleanText(b.teamAgeGroup, 60),
      scores,
      wouldReturn: b.wouldReturn === "yes" ? true : b.wouldReturn === "no" ? false : null,
      videoPolicy,
      vendors,
      food,
      extraNight,
      attendedYear,
      comment: cleanText(b.comment, 4000),
    });
    res.redirect(`/tournaments/${id}?thanks=1`);
  } catch (err) {
    next(err);
  }
});

app.get("/top-rated", async (req, res, next) => {
  try {
    track("top-rated");
    const items = await tournamentsWithRatings();
    const rated = items
      .filter((x) => x.agg.overall != null)
      .sort((a, b) => b.agg.overall - a.agg.overall || b.agg.count - a.agg.count || a.t.name.localeCompare(b.t.name));
    res.send(views.topRatedPage({ rated }));
  } catch (err) {
    next(err);
  }
});

app.get("/list-your-tournament", (req, res) => {
  res.send(views.listTournamentPage({ error: null, thanks: req.query.thanks === "1" }));
});

app.post("/list-your-tournament", async (req, res, next) => {
  try {
    const b = req.body || {};
    const tournamentName = cleanText(b.tournamentName, 120);
    if (!tournamentName) {
      return res
        .status(400)
        .send(views.listTournamentPage({ error: "Please include the tournament name.", thanks: false }));
    }
    const intOrNull = (v) => {
      const n = parseInt(v, 10);
      return Number.isInteger(n) ? n : null;
    };
    // Optional rating ("Rate it now" section of the form). All-or-nothing:
    // if the submitter touches any part of the rating section, the five
    // criteria scores and a display name (or the hide-my-name box) are
    // required — the same rule as the tournament-page review form. A
    // fully blank rating section stores no rating and changes nothing.
    // (The rating selects for video policy / vendors / extra night always
    // submit their default, so they never count as "touched" on their own.)
    const ratingScores = {
      level: parseScore(b.ratingLevel),
      organization: parseScore(b.ratingOrganization),
      stayToPlay: parseScore(b.ratingStayToPlay),
      facilities: parseScore(b.ratingFacilities),
      value: parseScore(b.ratingValue),
    };
    const ratingTouched =
      [b.ratingLevel, b.ratingOrganization, b.ratingStayToPlay, b.ratingFacilities, b.ratingValue]
        .some((v) => String(v || "").trim() !== "") ||
      b.ratingHideName === "yes" ||
      cleanText(b.ratingReviewerName, 60) !== "" ||
      cleanText(b.ratingTeamAgeGroup, 60) !== "" ||
      cleanText(b.ratingComment, 4000) !== "" ||
      String(b.ratingAttendedYear || "") !== "" ||
      String(b.ratingWouldReturn || "") !== "";
    let rating = null;
    if (ratingTouched) {
      const reviewerName =
        b.ratingHideName === "yes"
          ? "Anonymous hockey parent"
          : cleanText(b.ratingReviewerName, 60);
      if (!reviewerName || Object.values(ratingScores).some((s) => s == null)) {
        return res.status(400).send(
          views.listTournamentPage({
            error:
              "Your rating is only partly filled in. To include it, please add a name to show on your review (or check the hide-my-name box) and a 1–5 score for all five criteria — or clear the rating section and submit the listing on its own.",
            thanks: false,
          })
        );
      }
      const videoPolicy = Object.keys(views.VIDEO_POLICIES).includes(b.ratingVideoPolicy)
        ? b.ratingVideoPolicy
        : "not-reported";
      const vendors = Object.keys(views.VENDORS).includes(b.ratingVendors)
        ? b.ratingVendors
        : "not-reported";
      const extraNight = Object.keys(views.EXTRA_NIGHT).includes(b.ratingExtraNight)
        ? b.ratingExtraNight
        : "not-reported";
      const yr = parseInt(b.ratingAttendedYear, 10);
      rating = {
        reviewerName,
        teamAgeGroup: cleanText(b.ratingTeamAgeGroup, 60),
        scores: ratingScores,
        wouldReturn:
          b.ratingWouldReturn === "yes" ? true : b.ratingWouldReturn === "no" ? false : null,
        videoPolicy,
        vendors,
        food: "not-reported",
        extraNight,
        attendedYear:
          Number.isInteger(yr) && yr >= 2000 && yr <= new Date().getFullYear() + 1 ? yr : null,
        comment: cleanText(b.ratingComment, 4000),
      };
    }
    await db.addOrganizerSubmission({
      tournamentName,
      organizer: cleanText(b.organizer, 120),
      contactName: cleanText(b.contactName, 60),
      contactEmail: cleanText(b.contactEmail, 120),
      city: cleanText(b.city, 60),
      state: cleanText(b.state, 10).toUpperCase(),
      venue: cleanText(b.venue, 160),
      startDate: cleanText(b.startDate, 10),
      endDate: cleanText(b.endDate, 10),
      ageGroups: cleanText(b.ageGroups, 120),
      levels: cleanText(b.levels, 120),
      gamesGuaranteed: intOrNull(b.gamesGuaranteed),
      entryFee: cleanText(b.entryFee, 40),
      gateFee: cleanText(b.gateFee, 40),
      stayToPlay: b.stayToPlay === "yes" ? true : b.stayToPlay === "no" ? false : null,
      scheduleReleaseDays: intOrNull(b.scheduleReleaseDays),
      experienceTags: cleanText(b.experienceTags, 200),
      notes: cleanText(b.notes, 2000),
      rating,
    });
    res.redirect("/list-your-tournament?thanks=1");
  } catch (err) {
    next(err);
  }
});

app.get("/advertise", (req, res) => {
  res.send(views.advertisePage({ thanks: req.query.thanks === "1", error: null }));
});

app.post("/advertise", async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = cleanText(b.name, 60);
    const email = cleanText(b.email, 120);
    const message = cleanText(b.message, 4000);
    if (!name || !email || !message) {
      return res.status(400).send(
        views.advertisePage({ thanks: false, error: "Please add your name or business, your email, and a few words about what you'd like to promote." })
      );
    }
    await db.addSuggestion({ name, email, category: "Advertising inquiry", message });
    res.redirect("/advertise?thanks=1");
  } catch (err) {
    next(err);
  }
});

app.get("/founder", async (req, res, next) => {
  try {
    track("founder");
    const items = await tournamentsWithRatings();
    const bellItem = items.find((x) => x.t.id === 13);
    const bellReview = bellItem.reviews.find((r) => r.reviewerName === "Matthew S.") || bellItem.reviews[0];
    res.send(views.founderPage({ bell: bellItem.t, bellAgg: bellItem.agg, bellReview }));
  } catch (err) {
    next(err);
  }
});

app.get("/accessibility", (req, res) => {
  track("accessibility");
  res.send(views.accessibilityPage());
});

app.get("/terms", (req, res) => {
  track("terms");
  res.send(views.termsPage());
});

app.get("/privacy", (req, res) => {
  track("privacy");
  res.send(views.privacyPage());
});

app.get("/swag", (req, res) => {
  track("swag");
  res.send(views.swagPage());
});

app.get("/useful-websites", async (req, res, next) => {
  try {
    track("useful-websites");
    const tournaments = await db.listTournaments();
    const outdoor = tournaments
      .filter((t) => (t.experienceTags || []).some((tag) => tag === "Outdoor Ice" || tag === "Pond Hockey"))
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    res.send(views.usefulWebsitesPage({ outdoor }));
  } catch (err) {
    next(err);
  }
});

app.get("/suggestions", (req, res) => {
  res.send(views.suggestionsPage({ error: null, thanks: req.query.thanks === "1" }));
});

app.post("/suggestions", async (req, res, next) => {
  try {
    const b = req.body || {};
    const message = cleanText(b.message, 4000);
    if (!message) {
      return res
        .status(400)
        .send(views.suggestionsPage({ error: "Please write a few words so we know what you mean.", thanks: false }));
    }
    const category = views.SUGGESTION_CATEGORIES.includes(b.category) ? b.category : "Suggestion";
    await db.addSuggestion({
      name: cleanText(b.name, 60),
      email: cleanText(b.email, 120),
      category,
      message,
    });
    res.redirect("/suggestions?thanks=1");
  } catch (err) {
    next(err);
  }
});

// Private inbox + stats. 404s unless the ADMIN_KEY environment variable is
// set AND passed exactly as ?key=... — the page simply does not exist to
// anyone else. Nothing links here.
app.get("/admin", async (req, res, next) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) {
    return res.status(404).send(views.notFoundPage());
  }
  try {
    const [suggestions, submissions, pageViews, items] = await Promise.all([
      db.listSuggestions(),
      db.listOrganizerSubmissions(),
      db.getPageViews(),
      tournamentsWithRatings(),
    ]);
    const totals = {
      tournaments: items.length,
      reviews: items.reduce((n, x) => n + x.reviews.length, 0),
    };
    res.send(views.adminPage({ suggestions, submissions, pageViews, totals }));
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).send(views.notFoundPage());
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Something went wrong on our end. Please try again in a minute.");
});

// --- Boot ----------------------------------------------------------------------

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `TourneyRatings listening on port ${PORT} (database: ${db.usingPostgres ? "Postgres" : "in-memory fallback"})`
      );
    });
  })
  .catch((err) => {
    console.error("Failed to initialize the database:", err);
    process.exit(1);
  });
