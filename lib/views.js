// Server-side HTML rendering for TourneyRatings. Plain string templates,
// no template engine -- one less dependency to maintain. Every piece of
// user-supplied text goes through esc() before it reaches the page.

"use strict";

const CRITERIA = [
  { key: "level", label: "Level honesty", hint: "Were the divisions fair, or was somebody sandbagging?" },
  { key: "organization", label: "Organization", hint: "Schedules out on time, games starting on time, no last-minute changes." },
  { key: "stayToPlay", label: "Stay-to-play", hint: "Required or not, and were the hotels fairly priced and close?" },
  { key: "facilities", label: "Facilities", hint: "Ice, locker rooms, and the food — could families get a snack or a drink?" },
  { key: "value", label: "Value", hint: "What you got for the entry fee." },
];

const EXPERIENCE_TAGS = [
  { name: "Outdoor Ice", definition: "Games are played outdoors, on open-air rinks or natural ice." },
  { name: "Pro Ice", definition: "Games are played on a pro team's ice — an NHL arena or practice facility." },
  { name: "International Field", definition: "Teams travel in from more than one country, so your player faces opponents from abroad." },
  { name: "Pond Hockey", definition: "Old-school hockey on a frozen pond or lake, the way the game started." },
  { name: "Destination City", definition: "Hosted somewhere worth the trip on its own — bring the family, stay an extra day." },
  { name: "Northernmost", definition: "Played about as far north as youth hockey goes — Anchorage, Alaska, at 61 degrees north, past Helsinki." },
  { name: "Southernmost", definition: "Played about as far south as youth hockey goes — Ushuaia, Argentina, the southernmost city in the world, at 55 degrees south." },
  { name: "Bucket List", definition: "Hockey somewhere most North American families would never think to look — a once-in-a-lifetime trip built around a tournament." },
];

const AGE_GROUPS = ["8U", "10U", "12U", "14U", "16U", "18U", "19U"];
const LEVELS = ["AAA", "AA", "A", "BB", "B", "C", "House"];
const DIVISIONS = ["Youth", "Girls", "High School"];

const VIDEO_POLICIES = {
  "filmed-freely": "Parents could film freely",
  "paywalled-stream": "Streaming is paywalled",
  "filming-restricted": "Filming was restricted",
  "filming-restricted-paywall": "Filming restricted, and the stream is paywalled",
  "not-reported": "Not reported",
};

const VENDORS = {
  "swag-and-vendors": "Tournament swag and other vendors on site",
  "swag-only": "Tournament swag on site",
  "vendors-only": "Vendors on site, but no tournament swag",
  "none": "No vendors or tournament swag",
  "not-reported": "Not reported",
};

const EXTRA_NIGHT = {
  "yes": "Schedule forced an extra hotel night",
  "no": "No extra hotel night",
  "not-reported": "Not reported",
};

const FOOD = {
  "plenty": "Plenty of food options at or near the rink",
  "good-rink-food": "Good food at the rink itself",
  "snack-bar-only": "Just a basic snack bar at the rink",
  "nothing-nearby": "Not much food at the rink or nearby",
  "not-reported": "Not reported",
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function fmtScore(n) {
  return n == null ? "—" : round1(n).toFixed(1);
}

// Color tone for a score badge: green at the top, amber in the middle,
// red at the bottom, so a list can be scanned at a glance.
function scoreTone(overall) {
  if (overall == null) return "";
  if (overall >= 4.5) return " high";
  if (overall >= 3.5) return " mid";
  return " low";
}

function fmtMoney(cents) {
  if (cents == null) return null;
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function fmtDateRange(startIso, endIso) {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  if (s.y === e.y && s.m === e.m) {
    return `${MONTHS[s.m - 1]} ${s.d}–${e.d}, ${s.y}`;
  }
  if (s.y === e.y) {
    return `${MONTHS[s.m - 1]} ${s.d} – ${MONTHS[e.m - 1]} ${e.d}, ${s.y}`;
  }
  return `${MONTHS[s.m - 1]} ${s.d}, ${s.y} – ${MONTHS[e.m - 1]} ${e.d}, ${e.y}`;
}

function fmtDate(iso) {
  const p = parseDate(iso);
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

// --- Rating math -----------------------------------------------------------
// A review's overall is the mean of its five criteria. A tournament's
// overall is the mean of its reviews' overalls. This matches the
// prototype's math exactly (verified against its published averages).

function reviewOverall(review) {
  const s = review.scores;
  return (s.level + s.organization + s.stayToPlay + s.facilities + s.value) / 5;
}

function aggregate(reviews) {
  if (!reviews || reviews.length === 0) {
    return { count: 0, overall: null, criteria: null, wouldReturnPct: null };
  }
  const criteria = {};
  for (const c of CRITERIA) {
    const sum = reviews.reduce((acc, r) => acc + r.scores[c.key], 0);
    criteria[c.key] = round1(sum / reviews.length);
  }
  const overall = round1(
    reviews.reduce((acc, r) => acc + reviewOverall(r), 0) / reviews.length
  );
  const returns = reviews.filter((r) => r.wouldReturn != null);
  const wouldReturnPct = returns.length
    ? Math.round((returns.filter((r) => r.wouldReturn).length / returns.length) * 100)
    : null;
  return { count: reviews.length, overall, criteria, wouldReturnPct };
}

// --- Age / level token matching --------------------------------------------
// Most listings store clean values ("10U", "AA"), but a few store combined
// strings ("U10 U11 U12 U13", "AAA AA A House"). Tokenizing both sides the
// same way keeps matching honest for every listing.

function tokens(list) {
  const out = new Set();
  for (const item of list || []) {
    for (const raw of String(item).split(/[\s/]+/)) {
      if (!raw) continue;
      let t = raw.toUpperCase();
      const m = t.match(/^U(\d+)$/);
      if (m) t = `${m[1]}U`;
      if (t === "HOUSE") t = "House";
      out.add(t);
    }
  }
  return out;
}

function ageTokens(t) {
  return tokens(t.ageGroups);
}

function levelTokens(t) {
  return tokens(t.levels);
}

function divisionTokens(t) {
  return new Set(t.divisions && t.divisions.length ? t.divisions : ["Youth"]);
}

// --- Layout ------------------------------------------------------------------

// Remembrance poppy, shown during November (Veterans Day / Remembrance Day).
function remembrancePoppy() {
  const month = Number(
    new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "numeric" })
  );
  if (month !== 11) return "";
  return `<svg class="poppy" width="26" height="26" viewBox="0 0 32 32" role="img" aria-label="Remembrance poppy"><circle cx="10.5" cy="13" r="7" fill="#d92323"/><circle cx="21.5" cy="13" r="7" fill="#e03131"/><circle cx="16" cy="9" r="7" fill="#c8102e"/><circle cx="16" cy="20.5" r="6.5" fill="#b30d24"/><circle cx="16" cy="14.5" r="3.4" fill="#1a1a1a"/></svg>`;
}

function layout({ title, active, body, description }) {
  const metaDesc = description || "Youth hockey tournaments, rated by the parents who paid for them. Level honesty, organization, stay-to-play, facilities and value — scored before you commit your team and your money. Veteran owned.";
  const navLink = (href, key, label) =>
    `<a href="${href}"${active === key ? ' class="active"' : ""}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · TourneyRatings</title>
<meta name="description" content="${esc(metaDesc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TourneyRatings">
<meta property="og:title" content="${esc(title)} · TourneyRatings">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="https://tourneyratings.com/images/logo-photo.png">
<link rel="icon" type="image/png" href="/images/logo-tr-puck.png">
<link rel="stylesheet" href="/style.css?v=9">
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><img class="puck logo-photo" src="/images/logo-photo.png" alt="TourneyRatings logo" width="36" height="36">Tourney<span>Ratings</span></a>
    <nav class="main-nav">
      ${navLink("/tournaments", "tournaments", "Tournaments")}
      ${navLink("/top-rated", "top", "Top Rated")}
      ${navLink("/useful-websites", "useful", "Useful Websites")}
      ${navLink("/swag", "swag", "Swag")}
      ${navLink("/founder", "founder", "Founder's Story")}
      ${navLink("/list-your-tournament", "list", "List Your Tournament")}
      ${navLink("/advertise", "advertise", "Advertise")}
      ${navLink("/suggestions", "suggest", "Suggestions")}
    </nav>
  </div>
</header>
<main class="wrap" id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-about">
        <p class="footer-brand"><img class="logo-photo" src="/images/logo-photo.png" alt="" width="30" height="30">Tourney<span>Ratings</span></p>
        <p>Youth hockey tournaments, rated by parents — so families can choose the right tournament before they commit their team and their money.</p>
        <p>Built by a hockey dad. <strong>Veteran owned.</strong> ${remembrancePoppy()}</p>
        <p><a href="https://www.instagram.com/tourneyratings/" target="_blank" rel="noopener">Instagram — @tourneyratings</a></p>
      </div>
      <nav class="footer-col" aria-label="Explore">
        <h3>Explore</h3>
        <ul>
          <li><a href="/tournaments">Tournament calendar</a></li>
          <li><a href="/top-rated">Top Rated by Parents</a></li>
          <li><a href="/useful-websites">Useful Websites</a></li>
          <li><a href="/swag">Swag &amp; gear</a></li>
          <li><a href="/founder">Founder's Story</a></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="Get involved">
        <h3>Get involved</h3>
        <ul>
          <li><a href="/list-your-tournament">List your tournament</a></li>
          <li><a href="/advertise">Advertise</a></li>
          <li><a href="/suggestions">Suggestions</a></li>
        </ul>
      </nav>
      <div class="footer-col footer-qr">
        <h3>Spread the word</h3>
        <img src="/images/qr-tourneyratings.png" alt="QR code linking to tourneyratings.com" width="84" height="84">
        <p>Scan it, share it — a team flyer, a group chat, a rink bulletin board.</p>
        <p><a href="/images/qr-tourneyratings.png" download>Download the QR code (PNG)</a></p>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 TourneyRatings. All rights reserved.</span>
      <span><a href="/accessibility">Accessibility</a></span>
      <span><a href="/terms">Terms</a></span>
      <span><a href="/privacy">Privacy</a></span>
      <span>Ratings are parent opinions from real tournament weekends. We never sell scores — placement in Top Rated is earned, not bought.</span>
      <span>Homepage photos: the founder's son, #53 — the slap shot up top and the hit below.</span>
    </div>
  </div>
</footer>
<script src="/app.js"></script>
</body>
</html>`;
}

// --- Components ---------------------------------------------------------------

function scoreBadge(agg) {
  if (!agg || agg.overall == null) {
    return `<span class="score-badge none">Not rated yet</span>`;
  }
  return `<span class="score-badge${scoreTone(agg.overall)}">${fmtScore(agg.overall)}<small> / 5 · ${agg.count} review${agg.count === 1 ? "" : "s"}</small></span>`;
}

function tagBadges(t) {
  if (!t.experienceTags || t.experienceTags.length === 0) return "";
  return `<span class="tag-row">${t.experienceTags
    .map((tag) => {
      const def = EXPERIENCE_TAGS.find((x) => x.name === tag);
      return `<span class="tag" title="${esc(def ? def.definition : "")}">${esc(tag)}</span>`;
    })
    .join("")}</span>`;
}

function dataBadges(t) {
  const badges = [];
  const divisions = divisionTokens(t);
  if (divisions.has("Girls")) {
    badges.push(
      `<span class="badge ok">${divisions.size === 1 ? "Girls tournament" : "Girls division included"}</span>`
    );
  }
  if (divisions.has("High School")) {
    badges.push(`<span class="badge ok">High school</span>`);
  }
  badges.push(
    t.stayToPlay == null
      ? `<span class="badge">Stay-to-play not listed</span>`
      : t.stayToPlay
        ? `<span class="badge warn">Stay-to-play required</span>`
        : `<span class="badge ok">No stay-to-play</span>`
  );
  if (t.gateFeeCents == null) {
    badges.push(`<span class="badge">Gate fee not listed</span>`);
  } else if (t.gateFeeCents === 0) {
    badges.push(`<span class="badge ok">No gate fee</span>`);
  } else {
    badges.push(`<span class="badge warn">Gate fee ${fmtMoney(t.gateFeeCents)}</span>`);
  }
  if (t.scheduleReleaseDays != null) {
    badges.push(`<span class="badge">Schedule out ~${t.scheduleReleaseDays} days before</span>`);
  }
  if (t.gamesGuaranteed != null) {
    badges.push(`<span class="badge">${t.gamesGuaranteed} games guaranteed</span>`);
  }
  return `<span class="badge-row">${badges.join("")}</span>`;
}

function tournamentCard(t, agg) {
  const fee = fmtMoney(t.entryFeeCents);
  return `<article class="card">
  <div class="card-top">
    <h3><a href="/tournaments/${t.id}">${esc(t.name)}</a></h3>
    ${scoreBadge(agg)}
  </div>
  <p class="meta">${esc(t.city)}, ${esc(t.state)} · ${esc(fmtDateRange(t.startDate, t.endDate))}</p>
  <p class="meta">${esc(t.venue)} · by ${esc(t.organizer)}</p>
  <p class="meta">Ages ${esc(t.ageGroups.join(", "))} · Levels ${esc(t.levels.join(", "))}</p>
  <p class="fee">${fee ? `Entry fee ${fee}` : "Entry fee not listed"}</p>
  ${dataBadges(t)}
  ${tagBadges(t)}
  <p class="card-actions">
    <a href="/tournaments/${t.id}">Details &amp; reviews</a> ·
    <a href="/tournaments/${t.id}/rate">Rate this tournament</a>
  </p>
</article>`;
}

function criteriaBars(agg) {
  if (!agg || !agg.criteria) return "<p>No ratings yet — be the first parent to review this tournament.</p>";
  return `<div class="criteria">${CRITERIA.map((c) => {
    const v = agg.criteria[c.key];
    return `<div class="criterion">
      <span class="criterion-label">${esc(c.label)}</span>
      <span class="bar"><span class="bar-fill" style="width:${(v / 5) * 100}%"></span></span>
      <span class="criterion-score">${fmtScore(v)}</span>
    </div>`;
  }).join("")}</div>`;
}

function reviewCard(r, { founder = false } = {}) {
  const overall = round1(reviewOverall(r));
  const policy = r.videoPolicy && r.videoPolicy !== "not-reported"
    ? `<span class="badge">🎥 ${esc(VIDEO_POLICIES[r.videoPolicy] || r.videoPolicy)}</span>`
    : "";
  const vendor = r.vendors && r.vendors !== "not-reported"
    ? `<span class="badge">👕 ${esc(VENDORS[r.vendors] || r.vendors)}</span>`
    : "";
  const night = r.extraNight === "yes"
    ? `<span class="badge warn">🏨 Extra hotel night</span>`
    : "";
  const metaParts = [r.teamAgeGroup || ""];
  if (r.attendedYear) metaParts.push(`Attended ${r.attendedYear}`);
  metaParts.push(fmtDate(String(r.createdAt).slice(0, 10)));
  const ret = r.wouldReturn == null
    ? ""
    : `<span class="badge ${r.wouldReturn ? "ok" : "warn"}">${r.wouldReturn ? "Would return" : "Would not return"}</span>`;
  return `<article class="review${founder ? " founder" : ""}">
  <div class="review-top">
    <strong>${esc(r.reviewerName)}</strong>
    <span class="meta">${esc(metaParts.join(" · "))}</span>
    <span class="score-badge${scoreTone(overall)}">${fmtScore(overall)}<small> / 5</small></span>
  </div>
  ${founder ? `<p class="founder-flag">Review #1 — the founder's review</p>` : ""}
  <p>${esc(r.comment || "")}</p>
  <p class="review-scores">${CRITERIA.map((c) => `${esc(c.label)}: <strong>${r.scores[c.key]}</strong>`).join(" · ")}</p>
  <p>${ret} ${policy} ${vendor} ${night}</p>
</article>`;
}

function houseAd(slot) {
  return `<aside class="house-ad" aria-label="Advertisement">
  <span class="ad-label">Advertisement</span>
  <p><strong>Your brand here.</strong> Reach hockey parents while they're planning the next tournament weekend.</p>
  <p><a href="/advertise">See advertising options →</a></p>
</aside>`;
}

// --- Pages ---------------------------------------------------------------------

function homePage({ topRated, featured, bell, bellAgg, bellReview, totals }) {
  const body = `
<section class="hero">
  <h1>Youth hockey tournaments, rated by the parents who paid for them.</h1>
  <p class="lede">Before you commit your team — and your money — check the five things parents actually talk about in the stands: level honesty, organization, stay-to-play, facilities, and value.</p>
  <form class="hero-search" action="/tournaments" method="get">
    <input type="search" name="q" placeholder="Search tournaments, cities, organizers…" aria-label="Search tournaments">
    <button type="submit">Search</button>
  </form>
  <p class="hero-stats">${totals.tournaments} tournaments listed · ${totals.reviews} parent review${totals.reviews === 1 ? "" : "s"} · <a href="/tournaments">Tournaments across the U.S., Canada &amp; Europe →</a></p>
  <p><span class="vet-badge">★ Veteran Owned</span>${remembrancePoppy() ? ` <span class="poppy-wrap">${remembrancePoppy()}<span class="poppy-note">Lest we forget</span></span>` : ""}</p>
</section>


<section>
  <h2>Top Rated by Parents</h2>
  <ol class="leaderboard">
    ${topRated.map(({ t, agg }, i) => `<li>
      <span class="rank">${i + 1}</span>
      <span class="lb-main"><a href="/tournaments/${t.id}">${esc(t.name)}</a><small>${esc(t.city)}, ${esc(t.state)} · ${esc(t.organizer)}</small></span>
      <span class="score-badge${scoreTone(agg.overall)}">${fmtScore(agg.overall)}<small> / 5 · ${agg.count}</small></span>
    </li>`).join("")}
  </ol>
  <p><a href="/top-rated">Full leaderboard →</a></p>
</section>

<section>
  <h2>Featured tournaments</h2>
  <div class="grid">
    ${featured.map(({ t, agg }) => tournamentCard(t, agg)).join("")}
  </div>
</section>




<section class="founder-teaser">
  <h2>Built by a hockey dad</h2>
  <p>After years of tournament weekends with my son and daughter, the same frustrations kept coming up — so I built the comparison tool parents didn't have. It starts with one honest review: mine, of the ${esc(bell.name)} in ${esc(bell.city)} — <strong>${fmtScore(bellAgg.overall)}/5</strong>.</p>
  <p><a href="/founder">Read the founder's story →</a> · <a href="/tournaments/${bell.id}">See Review #1 →</a></p>
</section>

<section>
  <h2>From our Instagram</h2>
  <p>Follow <a href="https://www.instagram.com/tourneyratings/">@tourneyratings</a> for tournament spotlights and new reviews as they come in.</p>
  <div class="ig-strip">
    <a href="https://www.instagram.com/p/Df7cXZANcDG/"><img src="/images/ig-how-to-rate.png" alt="Instagram post: how to rate a tournament in about a minute" loading="lazy"></a>
    <a href="https://www.instagram.com/p/Df7YpmDBkXl/"><img src="/images/ig-fargo.png" alt="Instagram post: tournament spotlight on the Fargo Squirt International" loading="lazy"></a>
    <a href="https://www.instagram.com/p/Df6UqXpPSS1/"><img src="/images/ig-explainer.png" alt="Instagram post: real reviews from parents who have actually been there" loading="lazy"></a>
    <a href="https://www.instagram.com/p/Df5269_hvXK/"><img src="/images/ig-bell-capital.png" alt="Instagram post: the first parent review, of the Bell Capital Cup" loading="lazy"></a>
  </div>
</section>



<div class="ad-row single">${houseAd(1)}</div>
`;
  return layout({ title: "Youth Hockey Tournaments, Rated by Parents", active: "home", description: "Youth hockey tournament reviews and ratings by the parents who paid for them. Check level honesty, organization, stay-to-play, rink quality and value before you book — tournaments across the U.S., Canada and Europe.", body });
}

function tournamentsPage({ items, states, intlStates = [], filters, myPlayerData, matchCount }) {
  const f = filters;
  const naOptions = states
    .map((s) => `<option value="${esc(s.code)}"${f.state === s.code ? " selected" : ""}>${esc(s.code)}${s.count === 0 ? " — no tournament listed" : ""}</option>`)
    .join("");
  const intlOptions = intlStates
    .map((s) => `<option value="${esc(s.code)}"${f.state === s.code ? " selected" : ""}>${esc(s.code)}</option>`)
    .join("");
  const stateOptions =
    `<optgroup label="United States &amp; Canada">${naOptions}</optgroup>` +
    (intlOptions ? `<optgroup label="International">${intlOptions}</optgroup>` : "");
  const selectedState = [...states, ...intlStates].find((s) => s.code === f.state);
  const emptyMsg =
    selectedState && selectedState.count === 0
      ? `<p class="empty">No tournament listed for ${esc(f.state)} yet. Know one that belongs here? <a href="/list-your-tournament">List your tournament</a> — it only takes a couple of minutes.</p>`
      : `<p class="empty">No tournaments match those filters. <a href="/tournaments">Clear everything</a> and try again.</p>`;
  const ageOptions = AGE_GROUPS
    .map((a) => `<option value="${a}"${f.age === a ? " selected" : ""}>${a}</option>`)
    .join("");
  const levelOptions = LEVELS
    .map((l) => `<option value="${l}"${f.level === l ? " selected" : ""}>${l}</option>`)
    .join("");
  const tagOptions = EXPERIENCE_TAGS
    .map((tag) => `<option value="${esc(tag.name)}"${f.tag === tag.name ? " selected" : ""}>${esc(tag.name)}</option>`)
    .join("");
  const ageChecks = AGE_GROUPS
    .map((a) => `<label class="chip-check"><input type="checkbox" name="myAges" value="${a}"${f.myAges.includes(a) ? " checked" : ""}> ${a}</label>`)
    .join("");
  const levelChecks = LEVELS
    .map((l) => `<label class="chip-check"><input type="checkbox" name="myLevels" value="${l}"${f.myLevels.includes(l) ? " checked" : ""}> ${l}</label>`)
    .join("");
  const divOptions = DIVISIONS
    .map((d) => `<option value="${esc(d)}"${f.div === d ? " selected" : ""}>${esc(d)}</option>`)
    .join("");
  const divChecks = DIVISIONS
    .map((d) => `<label class="chip-check"><input type="checkbox" name="myDivs" value="${esc(d)}"${f.myDivs.includes(d) ? " checked" : ""}> ${esc(d)}</label>`)
    .join("");
  const myActive = f.myAges.length > 0 || f.myLevels.length > 0 || f.myDivs.length > 0;

  const body = `
<h1>Tournament calendar</h1>
<p class="lede">Every listing shows the facts parents ask about first — stay-to-play, gate fees, and when the schedule comes out — plus ratings from parents who've been.</p>

<p class="quick-chips">
  <a class="chip" href="/tournaments">All tournaments</a>
  <a class="chip" href="/tournaments?stp=no">No stay-to-play</a>
  <a class="chip" href="/tournaments?div=Girls">Girls division</a>
  <a class="chip" href="/tournaments?div=High%20School">High school</a>
  ${EXPERIENCE_TAGS.map((tag) => `<a class="chip" href="/tournaments?tag=${encodeURIComponent(tag.name)}">${esc(tag.name)}</a>`).join("")}
</p>

<form class="filters" action="/tournaments" method="get">
  <div class="filter-grid">
    <label>Search
      <input type="search" name="q" value="${esc(f.q)}" placeholder="Name, city, organizer…">
    </label>
    <label>Location
      <select name="state"><option value="">All locations</option>${stateOptions}</select>
    </label>
    <label>Age group
      <select name="age"><option value="">All ages</option>${ageOptions}</select>
    </label>
    <label>Level
      <select name="level"><option value="">All levels</option>${levelOptions}</select>
    </label>
    <label>Type
      <select name="div"><option value="">All types</option>${divOptions}</select>
    </label>
    <label>Stay-to-play
      <select name="stp">
        <option value=""${f.stp === "" ? " selected" : ""}>Any</option>
        <option value="yes"${f.stp === "yes" ? " selected" : ""}>Required</option>
        <option value="no"${f.stp === "no" ? " selected" : ""}>Not required</option>
      </select>
    </label>
    <label>Experience
      <select name="tag"><option value="">Any experience</option>${tagOptions}</select>
    </label>
    <label>Sort by
      <select name="sort">
        <option value="date"${f.sort === "date" ? " selected" : ""}>Date</option>
        <option value="fee-asc"${f.sort === "fee-asc" ? " selected" : ""}>Entry fee: cheapest first</option>
        <option value="fee-desc"${f.sort === "fee-desc" ? " selected" : ""}>Entry fee: most expensive first</option>
        <option value="rating"${f.sort === "rating" ? " selected" : ""}>Highest rated</option>
      </select>
    </label>
  </div>

  <fieldset class="myplayer">
    <legend>Find tournaments for your player</legend>
    <p class="meta">Pick your kid's age group and level — the list narrows to tournaments that run those divisions. Two kids? Pick both.</p>
    <div class="check-row"><span class="check-label">Age:</span> ${ageChecks}</div>
    <div class="check-row"><span class="check-label">Level:</span> ${levelChecks}</div>
    <div class="check-row"><span class="check-label">Type:</span> ${divChecks}</div>
    <p class="myplayer-count" id="myplayer-count">${myActive ? `${matchCount} tournament${matchCount === 1 ? "" : "s"} match your player` : "No player selected — showing everything."}</p>
    ${myActive ? `<p><a href="/tournaments">Clear my player ✕</a></p>` : ""}
  </fieldset>

  <p class="filter-actions"><button type="submit">Apply filters</button> <a href="/tournaments">Reset all</a></p>
</form>

<details class="tag-legend">
  <summary>What do the experience tags mean?</summary>
  <dl class="tag-defs">
    ${EXPERIENCE_TAGS.map((tag) => `<div><dt><span class="tag">${esc(tag.name)}</span></dt><dd>${esc(tag.definition)}</dd></div>`).join("")}
  </dl>
</details>

<p class="result-count">${items.length} tournament${items.length === 1 ? "" : "s"} shown</p>
<div class="grid">
  ${items.length ? items.map(({ t, agg }) => tournamentCard(t, agg)).join("") : emptyMsg}
</div>


<script type="application/json" id="myplayer-data">${JSON.stringify(myPlayerData)}</script>
`;
  return layout({ title: "Youth Hockey Tournament Calendar — Reviews & Ratings", active: "tournaments", description: "Browse youth hockey tournaments by state, age group, level and stay-to-play, with parent reviews and ratings on every listing. Find the right tournament for your player before you commit.", body });
}

function tournamentPage({ t, agg, reviews, thanks }) {
  const fee = fmtMoney(t.entryFeeCents);
  const policies = [...new Set(reviews.map((r) => r.videoPolicy).filter((p) => p && p !== "not-reported"))];
  const vendorVals = reviews.map((r) => r.vendors).filter((v) => v && v !== "not-reported");
  const vendorFacts = [];
  if (vendorVals.some((v) => v === "swag-and-vendors" || v === "swag-only")) vendorFacts.push("Tournament swag on site — shirts & hoodies");
  if (vendorVals.some((v) => v === "swag-and-vendors" || v === "vendors-only")) vendorFacts.push("Vendors on site");
  const vendorLine = vendorFacts.length
    ? `<p class="return-stat">Vendors &amp; tournament swag, as reported by parents: ${vendorFacts.join(" · ")}</p>`
    : vendorVals.includes("none")
      ? `<p class="return-stat">Vendors &amp; tournament swag, as reported by parents: no vendors or tournament swag — nothing to buy on site.</p>`
      : "";
  const nightVals = reviews.map((r) => r.extraNight).filter((v) => v && v !== "not-reported");
  const nightLine = nightVals.includes("yes")
    ? `<p class="return-stat">Schedule, as reported by parents: game times forced at least one family into an extra hotel night.</p>`
    : nightVals.includes("no")
      ? `<p class="return-stat">Schedule, as reported by parents: no extra hotel night needed.</p>`
      : "";
  const body = `
${thanks ? `<p class="flash">Thanks — your review is live and the averages above include it.</p>` : ""}
<p class="crumbs"><a href="/tournaments">← All tournaments</a></p>
<div class="detail-top">
  <div>
    <h1>${esc(t.name)}</h1>
    <p class="meta">${esc(t.city)}, ${esc(t.state)} · ${esc(fmtDateRange(t.startDate, t.endDate))}</p>
    <p class="meta">${esc(t.venue)} · run by ${esc(t.organizer)}</p>
  </div>
  ${scoreBadge(agg)}
</div>

<section class="detail-facts">
  <div><span>Entry fee</span><strong>${fee || "Not listed"}</strong></div>
  <div><span>Dates</span><strong>${esc(fmtDateRange(t.startDate, t.endDate))}</strong></div>
  <div><span>Age groups</span><strong>${esc(t.ageGroups.join(", "))}</strong></div>
  <div><span>Levels</span><strong>${esc(t.levels.join(", "))}</strong></div>
  <div><span>Type</span><strong>${esc([...divisionTokens(t)].join(", "))}</strong></div>
  <div><span>Games guaranteed</span><strong>${t.gamesGuaranteed != null ? t.gamesGuaranteed : "Not listed"}</strong></div>
  <div><span>Schedule released</span><strong>${t.scheduleReleaseDays != null ? `~${t.scheduleReleaseDays} days before` : "Not listed"}</strong></div>
</section>
<p>${dataBadges(t)} ${tagBadges(t)}</p>
${agg.wouldReturnPct != null ? `<p class="return-stat"><strong>${agg.wouldReturnPct}%</strong> of reviewers would return to this tournament.</p>` : ""}
${policies.length ? `<p class="return-stat">Filming &amp; streaming, as reported by parents: ${policies.map((p) => esc(VIDEO_POLICIES[p] || p)).join(" · ")}</p>` : ""}
${vendorLine}
${nightLine}

<section>
  <h2>Plan your trip</h2>
  <p>Traveling in for this one? Search around ${esc(t.venue)} for the tournament dates.${t.stayToPlay === true ? " This is a stay-to-play tournament, so check the organizer's hotel block first — these links are your backup and your price check." : ""}</p>
  <p><a class="button ghost" href="https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(`${t.venue}, ${t.city}, ${t.state}`)}&startDate=${t.startDate}&endDate=${t.endDate}" target="_blank" rel="noopener">Hotels near the rink</a> <a class="button ghost" href="https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights to ${t.city}, ${t.state}`)}" target="_blank" rel="noopener">Flights to ${esc(t.city)}</a> <a class="button ghost" href="https://www.expedia.com/Car-Search?destination=${encodeURIComponent(`${t.city}, ${t.state}`)}&startDate=${t.startDate}&endDate=${t.endDate}" target="_blank" rel="noopener">Rental cars</a></p>
</section>

<section>
  <h2>Research the field</h2>
  <p>Want to know who you're up against before you commit? Check the team rankings and look up player stats:</p>
  <p><a class="button ghost" href="https://myhockeyrankings.com/" target="_blank" rel="noopener">Team rankings — MYHockey Rankings</a> <a class="button ghost" href="https://www.eliteprospects.com/" target="_blank" rel="noopener">Player stats — Elite Prospects</a></p>
</section>

<section>
  <h2>Parent ratings</h2>
  ${criteriaBars(agg)}
</section>

<section>
  <h2>Reviews (${reviews.length})</h2>
  ${reviews.length ? reviews.map((r) => reviewCard(r, { founder: t.id === 13 && r.reviewerName === "Matthew S." })).join("") : `<p>No reviews yet. Played this one? <a href="/tournaments/${t.id}/rate">Be the first to rate it</a>.</p>`}
  <p><a class="button" href="/tournaments/${t.id}/rate">Rate this tournament</a> <button type="button" class="button ghost share-btn" data-title="${esc(t.name)} · TourneyRatings" data-path="/tournaments/${t.id}">Share this tournament</button></p>
</section>
`;
  return layout({ title: `${t.name} — Reviews & Ratings`, active: "tournaments", description: `${t.name} in ${t.city}, ${t.state} — parent reviews and ratings for this youth hockey tournament: level honesty, organization, stay-to-play, facilities and value, plus dates, entry fee and games guaranteed.`, body });
}

function ratePage({ t, error }) {
  const thisYear = new Date().getFullYear();
  const yearOpts = Array.from({ length: 13 }, (_, i) => thisYear - i)
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("");
  const scoreSelect = (name, label, hint) => `
    <label class="score-field">${esc(label)}
      <span class="hint">${esc(hint)}</span>
      <select name="${name}" required>
        <option value="">Choose…</option>
        <option value="5">5 — Excellent</option>
        <option value="4">4 — Good</option>
        <option value="3">3 — Average</option>
        <option value="2">2 — Poor</option>
        <option value="1">1 — Terrible</option>
      </select>
    </label>`;
  const body = `
<p class="crumbs"><a href="/tournaments/${t.id}">← ${esc(t.name)}</a></p>
<h1>Rate ${esc(t.name)}</h1>
<p class="lede">${esc(t.city)}, ${esc(t.state)} · ${esc(fmtDateRange(t.startDate, t.endDate))}. Score it the way parents talk about it in the stands — honest scores help the next family, and they hold organizers to what they advertise.</p>
${error ? `<p class="flash error">${esc(error)}</p>` : ""}
<form class="rate-form" action="/tournaments/${t.id}/reviews" method="post">
  <div class="filter-grid">
    <label>Name to show on your review
      <input type="text" name="reviewerName" id="reviewerName" maxlength="60" required>
      <span class="hint">First name + last initial is fine, or use a nickname — it just has to be you who was actually there.</span>
    </label>
    <label>Your team / age group
      <input type="text" name="teamAgeGroup" maxlength="60" placeholder="e.g. 12U AA">
    </label>
    <label>Year you attended
      <select name="attendedYear">
        <option value="">Not sure / prefer not to say</option>
        ${yearOpts}
      </select>
    </label>
  </div>
  <label class="check-field"><input type="checkbox" name="hideName" value="yes" onchange="var n=document.getElementById('reviewerName'); n.required=!this.checked; if(this.checked){n.value='';}"> Hide my name — show "Anonymous hockey parent" on my review instead</label>
  ${CRITERIA.map((c) => scoreSelect(c.key, c.label, c.hint)).join("")}
  <label class="score-field">Would you return to this tournament?
    <select name="wouldReturn">
      <option value="">No answer</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  </label>
  <label class="score-field">Filming &amp; streaming — could you film your own kid?
    <select name="videoPolicy">
      <option value="not-reported">Don't know / not reported</option>
      <option value="filmed-freely">Parents could film freely</option>
      <option value="paywalled-stream">Filming OK, but the stream is paywalled</option>
      <option value="filming-restricted">Filming was restricted</option>
      <option value="filming-restricted-paywall">Filming restricted, and the stream is paywalled</option>
    </select>
  </label>
  <label class="score-field">Did the tournament have vendors or tournament swag — shirts, hoodies, gear?
    <select name="vendors">
      <option value="not-reported">Don't know / not reported</option>
      <option value="swag-and-vendors">Yes — tournament swag and other vendors</option>
      <option value="swag-only">Yes — tournament swag (shirts, hoodies)</option>
      <option value="vendors-only">Vendors, but no tournament swag</option>
      <option value="none">No vendors or tournament swag</option>
    </select>
  </label>
  <label class="score-field">Did the game schedule force you into an extra hotel night — an early Friday game or a late Sunday finish?
    <select name="extraNight">
      <option value="not-reported">Don't know / not reported</option>
      <option value="yes">Yes — we needed an extra night</option>
      <option value="no">No — the schedule worked with our travel</option>
    </select>
  </label>
  <label class="score-field">Your review
    <textarea name="comment" rows="5" maxlength="4000" placeholder="What should the next parent know before they sign up?"></textarea>
  </label>
  <p><button type="submit">Submit review</button></p>
  <p class="hint">Reviews are shown publicly with the name you entered. Please review only a tournament your family attended, from your own experience — see the <a href="/terms#reviews">review rules</a> and <a href="/privacy">privacy policy</a>.</p>
</form>
`;
  return layout({ title: `Rate ${t.name}`, active: "tournaments", body });
}

function topRatedPage({ rated }) {
  const body = `
<h1>Top Rated by Parents</h1>
<p class="lede">Ranked by overall parent rating across the five criteria. Every score here was earned on a real tournament weekend — placement can't be bought.</p>
<ol class="leaderboard full">
  ${rated.map(({ t, agg }, i) => `<li>
    <span class="rank">${i + 1}</span>
    <span class="lb-main"><a href="/tournaments/${t.id}">${esc(t.name)}</a><small>${esc(t.city)}, ${esc(t.state)} · ${esc(fmtDateRange(t.startDate, t.endDate))} · ${esc(t.organizer)}</small>
    <small class="lb-criteria">${CRITERIA.map((c) => `${esc(c.label)} ${fmtScore(agg.criteria[c.key])}`).join(" · ")}</small></span>
    <span class="score-badge${scoreTone(agg.overall)}">${fmtScore(agg.overall)}<small> / 5 · ${agg.count} review${agg.count === 1 ? "" : "s"}</small></span>
  </li>`).join("")}
</ol>
${rated.length === 0 ? "<p>No rated tournaments yet.</p>" : ""}
`;
  return layout({ title: "Top Rated Youth Hockey Tournaments", active: "top", description: "The highest-rated youth hockey tournaments, ranked by real parent reviews — level honesty, organization, stay-to-play, facilities and value.", body });
}

function listTournamentPage({ error, thanks }) {
  const body = `
<h1>List your tournament</h1>
<p class="lede">Run a youth hockey tournament? Get it in front of parents while they're choosing their weekends. Listings are free — fill this in and we'll review it before it goes live, usually within a couple of days.</p>
${thanks ? `<p class="flash">Thanks — your tournament was submitted. We'll review the details and add it to the calendar.</p>` : ""}
${error ? `<p class="flash error">${esc(error)}</p>` : ""}
<form class="rate-form" action="/list-your-tournament" method="post">
  <div class="filter-grid">
    <label>Tournament name <input type="text" name="tournamentName" maxlength="120" required></label>
    <label>Organizer <input type="text" name="organizer" maxlength="120"></label>
    <label>Your name <input type="text" name="contactName" maxlength="60"></label>
    <label>Your email <input type="email" name="contactEmail" maxlength="120"></label>
    <label>City <input type="text" name="city" maxlength="60"></label>
    <label>State / province <input type="text" name="state" maxlength="10" placeholder="CA"></label>
    <label>Venue <input type="text" name="venue" maxlength="160"></label>
    <label>Start date <input type="date" name="startDate"></label>
    <label>End date <input type="date" name="endDate"></label>
    <label>Age groups <input type="text" name="ageGroups" maxlength="120" placeholder="8U, 10U, 12U"></label>
    <label>Levels <input type="text" name="levels" maxlength="120" placeholder="AAA, AA, A"></label>
    <label>Games guaranteed <input type="number" name="gamesGuaranteed" min="0" max="20"></label>
    <label>Entry fee <input type="text" name="entryFee" maxlength="40" placeholder="$1,895"></label>
    <label>Gate fee <input type="text" name="gateFee" maxlength="40" placeholder="None / $10"></label>
    <label>Stay-to-play?
      <select name="stayToPlay"><option value="">Not sure</option><option value="yes">Yes, required</option><option value="no">No</option></select>
    </label>
    <label>Schedule released how many days before? <input type="number" name="scheduleReleaseDays" min="0" max="120"></label>
    <label>Experience tags <input type="text" name="experienceTags" maxlength="200" placeholder="Outdoor Ice, Pro Ice, International Field, Pond Hockey, Destination City"></label>
  </div>
  <label class="score-field">Anything else parents should know
    <textarea name="notes" rows="4" maxlength="2000"></textarea>
  </label>
  <p><button type="submit">Submit tournament</button></p>
</form>
`;
  return layout({ title: "List Your Tournament", active: "list", body });
}

function advertisePage({ thanks, error } = {}) {
  const body = `
<h1>Sponsors &amp; Advertising</h1>
<p class="lede">Tournament weekends are travel weekends. The parents reading this site are booking hotels, buying gear, and planning team dinners — in the exact cities where tournaments happen.</p>

<section>
  <h2>Who you'll reach</h2>
  <ul>
    <li>Youth hockey parents researching tournaments before they commit a team — and a four-figure weekend budget.</li>
    <li>Team managers choosing next season's calendar.</li>
    <li>Families traveling: hotels, restaurants, gear, and things to do between games.</li>
  </ul>
  <h2>Your options</h2>
  <ul>
    <li><strong>Featured tournament listing</strong> — organizers: your tournament highlighted on the homepage and calendar, clearly labeled as featured.</li>
    <li><strong>Display placements</strong> — your business in the sponsor spot on the homepage, the calendar, and tournament pages. Best for hotels, restaurants, rinks, and hockey retailers near tournament venues.</li>
    <li><strong>Site sponsor</strong> — season-long recognition as a founding sponsor of TourneyRatings, with your logo on this page and the homepage sponsor spot.</li>
  </ul>
  <p><strong>One hard rule:</strong> we never sell ratings. Top Rated by Parents is ranked by parent reviews only, and no payment changes a score — that's the whole reason parents trust this site.</p>
  <h2>Founding rates</h2>
  <p>TourneyRatings is new and growing, and founding sponsors and advertisers lock in launch pricing. Tell us about your business below and we'll send the current rate card.</p>
</section>

<section class="qr-share">
  <img src="/images/qr-tourneyratings.png" alt="QR code linking to tourneyratings.com" width="150" height="150">
  <div>
    <h2>Send your families here</h2>
    <p>Running a tournament or a business on this site? Copy this QR code onto your own tournament page, flyer, or rink board — it links straight to TourneyRatings, where your families can rate their weekend.</p>
    <p><strong><a href="/images/qr-tourneyratings.png" download>Download the QR code (PNG)</a></strong></p>
    <p class="meta">On a phone, press and hold the code to save or copy it. On a computer, right-click it.</p>
  </div>
</section>

<section>
  <h2>Ask about sponsoring or advertising</h2>
  ${thanks ? `<p class="flash">Thanks — your inquiry is in. We'll get back to you with the rate card.</p>` : ""}
  ${error ? `<p class="flash error">${esc(error)}</p>` : ""}
  <form class="rate-form" action="/advertise" method="post">
    <div class="filter-grid">
      <label>Your name or business <input type="text" name="name" maxlength="60" required></label>
      <label>Your email <input type="email" name="email" maxlength="120" required></label>
    </div>
    <label class="score-field">What would you like to promote? (your business, your city, and which option interests you)
      <textarea name="message" rows="5" maxlength="4000" required></textarea>
    </label>
    <p><button type="submit">Send inquiry</button></p>
  </form>
</section>
`;
  return layout({ title: "Sponsors & Advertising", active: "advertise", body });
}

const SUGGESTION_CATEGORIES = ["Suggestion", "Bug report", "Tournament info fix", "Advertising inquiry", "Other"];

function suggestionsPage({ error, thanks }) {
  const body = `
<h1>Suggestions &amp; feedback</h1>
<p class="lede">This site gets better when parents tell us what's missing. Spot a tournament that isn't listed, a detail that's wrong, or something about the site itself that's bugging you? Tell us here.</p>
${thanks ? `<p class="flash">Thanks — your feedback is in. We read every one.</p>` : ""}
${error ? `<p class="flash error">${esc(error)}</p>` : ""}
<form class="rate-form" action="/suggestions" method="post">
  <div class="filter-grid">
    <label>Your name (optional) <input type="text" name="name" maxlength="60"></label>
    <label>Your email (optional, if you want a reply) <input type="email" name="email" maxlength="120"></label>
    <label>What kind of feedback is this?
      <select name="category">
        ${SUGGESTION_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
      </select>
    </label>
  </div>
  <label class="score-field">Your suggestion or feedback
    <textarea name="message" rows="6" maxlength="4000" required></textarea>
  </label>
  <p><button type="submit">Send feedback</button></p>
</form>
`;
  return layout({ title: "Suggestions & Feedback", active: "suggest", body });
}

// --- Founder's story ---------------------------------------------------------

function founderPage({ bell, bellAgg, bellReview }) {
  const body = `
<h1>Why I Built TourneyRatings</h1>
<div class="story">
<p>Our family's hockey journey started back in 2012, when we signed our son up for Little Kings at four years old. Like a lot of hockey parents, I had no idea what we were signing up for — the early mornings, the freezing rinks, the road trips. Fourteen years later, I wouldn't trade a minute of it. Both of my kids are still playing today, in ACHA college hockey.</p>
<p>Over those years, our family has played in more tournaments than I can count. In a typical year we'd do at least five — three out of state, and two closer to home, with Arizona and Las Vegas as regular stops.</p>
<p>Some were unforgettable — in 2019 we took my son's Squirt BB team to the Bell Capital Cup in Ottawa, and it remains one of the greatest tournaments we ever did. Outdoor rinks everywhere, teams from Korea, Canada, New York, and New Jersey, skating trails in the woods, and my son's team playing on the same ice as the Ottawa Senators. One of my kids' favorite memories from that trip didn't even happen at the tournament — it was an outdoor rink in Ottawa, where the kids helped scrape the ice and then fell into a pickup game with a bunch of local kids. That's what a great tournament trip can be.</p>
<p>The hockey community as a whole is small and close-knit. You meet people along this path — other parents in the stands, coaches, families from teams you played once in a city you may never visit again — and some of them become real friends, people you stay in contact with over the years. That's a big part of what this sport gives a family.</p>
<p>Those tournaments gave us a lot of great memories over the years — some good, some bad, but every one of them worth a story. We've also lived the other side of it: stay-to-play hotels an hour from the rink at inflated prices (we did that hour-long drive at a tournament in Boston — it was pretty bad), teams split across two different hotels, some hotels just plain bad, tournaments with barely any teams in them, schedules that changed at the last minute, and divisions where one team clearly didn't belong. Even the travel could go sideways — one trip to Chicago, we landed and every rental car in the city was already taken. Every hockey parent has a story like that — and usually, we only hear them after the check has already cleared.</p>
<blockquote class="founder-quote">"No matter if it's a good experience or a bad experience, at least we'll have a story to tell in the future."</blockquote>
<p>That's what I used to tell my kids on those trips. It hasn't been wrong yet.</p>
<p>And for those of us not on the East Coast, there's another challenge. In the Northeast, teams can play in all kinds of tournaments and face opponents from different states all the time — everybody comes to them. Here in California, it's generally just California teams playing each other; teams from other states coming out to our tournaments is rare. If you want your kids to face someone new, you travel — and a trip like that costs too much to gamble on a tournament you know nothing about.</p>
<p>That's why I built TourneyRatings. Parents put a lot of money into this sport, and the kids put in even more — the early mornings, the practices, the work and effort all season long. Families deserve the most for everything they put in, and the kids' hard work deserves to pay off.</p>
<p>Parents should be able to look up a tournament, educate themselves before they commit, and choose the ones that are right for their family — not just sign up for whatever everybody else is doing. Here, parents rate tournaments on the things that actually matter: fair divisions, organization, stay-to-play, facilities, and value for your money. No marketing — just honest reviews from families who were there. And when organizers, coaches, and managers know parents are paying attention, it holds them accountable to run tournaments the right way.</p>
<p>If you've played in a tournament, good or bad, leave a review. You'll be helping another hockey family the way I wish someone had helped ours back in 2012.</p>
<p class="signoff">— Matthew S., hockey dad, Southern California</p>
<p><a class="button" href="/tournaments">Browse the tournament calendar</a> <a class="button ghost" href="/top-rated">See the top rated tournaments</a></p>
</div>

<section>
  <h2>Review #1 — where it started</h2>
  ${reviewCard(bellReview, { founder: true })}
  <p><a href="/tournaments/${bell.id}">${esc(bell.name)} — full details →</a></p>
</section>

<section>
  <h2>Shout-outs</h2>
  <p>TourneyRatings is a community project as much as a website. These are some of the folks in the hockey world who showed early support — a follow, kind words, real feedback. Thank you.</p>
  <ul class="shoutouts">
    <li><strong><a href="https://www.instagram.com/moms.rate.the.rink/">Moms Rate the Rink</a></strong> — three SoCal hockey moms who rate rinks on video. Among the first to follow @tourneyratings, and generous with practical feedback.</li>
    <li><strong><a href="https://www.instagram.com/ourkidsplayhockey/">Our Kids Play Hockey</a></strong> — the hockey-parent podcast that took the time to write back with encouragement and keep this site in mind for a future tournaments episode.</li>
  </ul>
  <p class="meta">Want to help spread the word? Follow <a href="https://www.instagram.com/tourneyratings/">@tourneyratings</a> and <a href="/tournaments">rate your last tournament</a>.</p>
</section>

<section class="photo-band" role="img" aria-label="The founder's son delivering a hit along the boards during a game">
  <blockquote class="photo-band-quote">"No matter if it's a good experience or a bad experience, at least we'll have a story to tell in the future."
    <cite>— the founder, to his kids on tournament trips</cite>
  </blockquote>
</section>
`;
  return layout({ title: "Why I Built TourneyRatings — Founder's Story", active: "founder", body });
}

// --- Admin (private; the route 404s unless the correct key is given) --------

function adminPage({ suggestions, submissions, pageViews, totals }) {
  const viewRows = Object.entries(pageViews)
    .sort((a, b) => b[1] - a[1])
    .map(([section, n]) => `<tr><td>${esc(section)}</td><td><strong>${n}</strong></td></tr>`)
    .join("");
  const sugRows = suggestions.length
    ? suggestions.map((s) => `<article class="review">
        <div class="review-top"><strong>${esc(s.category || "Suggestion")}</strong>
        <span class="meta">${esc(s.name || "Anonymous")}${s.email ? ` · ${esc(s.email)}` : ""} · ${esc(fmtDate(String(s.createdAt).slice(0, 10)))}</span></div>
        <p>${esc(s.message)}</p>
      </article>`).join("")
    : "<p>Nothing yet.</p>";
  const subRows = submissions.length
    ? submissions.map((s) => `<article class="review">
        <div class="review-top"><strong>${esc(s.tournamentName)}</strong>
        <span class="meta">${esc(s.city || "")}${s.city && s.state ? ", " : ""}${esc(s.state || "")} · ${esc(fmtDate(String(s.createdAt).slice(0, 10)))}</span></div>
        <p class="meta">Organizer: ${esc(s.organizer || "—")} · Contact: ${esc(s.contactName || "—")}${s.contactEmail ? ` (${esc(s.contactEmail)})` : ""}</p>
        <p class="meta">Venue: ${esc(s.venue || "—")} · Dates: ${esc(s.startDate || "?")} – ${esc(s.endDate || "?")} · Ages: ${esc(s.ageGroups || "—")} · Levels: ${esc(s.levels || "—")} · Games: ${s.gamesGuaranteed != null ? s.gamesGuaranteed : "—"} · Fee: ${esc(s.entryFee || "—")} · Gate: ${esc(s.gateFee || "—")} · Stay-to-play: ${s.stayToPlay == null ? "not sure" : s.stayToPlay ? "yes" : "no"} · Schedule out: ${s.scheduleReleaseDays != null ? `~${s.scheduleReleaseDays} days` : "—"}</p>
        ${s.experienceTags ? `<p class="meta">Tags: ${esc(s.experienceTags)}</p>` : ""}
        ${s.notes ? `<p>${esc(s.notes)}</p>` : ""}
      </article>`).join("")
    : "<p>Nothing yet.</p>";
  const body = `
<h1>Site inbox &amp; stats</h1>
<p class="lede">Private page — suggestions, organizer submissions, and page views since the counters started. ${totals.tournaments} tournaments listed · ${totals.reviews} parent reviews.</p>

<section>
  <h2>Page views</h2>
  ${viewRows ? `<table class="admin-table"><tr><th>Section</th><th>Views</th></tr>${viewRows}</table>` : "<p>No views counted yet.</p>"}
</section>

<section>
  <h2>Suggestions &amp; feedback (${suggestions.length})</h2>
  ${sugRows}
</section>

<section>
  <h2>Organizer submissions (${submissions.length})</h2>
  ${subRows}
</section>
`;
  return layout({ title: "Admin", active: "", body });
}

function termsPage() {
  const body = `
<h1>Terms of Service</h1>
<div class="story">
<p><em>Last updated November 18, 2026.</em></p>
<h2>What this site is</h2>
<p>TourneyRatings lists youth hockey tournaments and publishes reviews written by parents who attended them. By using this site, you agree to these terms. If you do not agree, please do not use the site.</p>
<h2>Tournament listings</h2>
<p>Listings are compiled from organizers' public information. We work to keep them accurate and we correct errors when they are brought to our attention, but dates, fees, divisions, and policies can change at any time. Always confirm the details with the tournament organizer before you commit your team or your money. Tournament names and event names belong to their organizers and are used here only to identify the events.</p>
<h2 id="reviews">Reviews and ratings</h2>
<p>Reviews are the opinions of the parents who wrote them, not of TourneyRatings. If you submit a review, you agree to these rules:</p>
<p>Review only a tournament you or your family actually attended. Base the review on your own experience, and be honest — the whole point of this site is that the ratings can be trusted. Do not submit fake reviews, reviews for someone else, or more than one review of the same tournament edition. Do not include abusive language, personal attacks, or anyone's private personal information.</p>
<p>We may decline or remove a review that breaks these rules, is spam, or appears to be fake. Moderation decisions are based on these rules — never on whether a review is positive or negative. Ratings are never for sale, and no payment by an organizer or advertiser changes a score or a ranking.</p>
<p>If you run a tournament listed here and believe a review contains a factual error, contact us through the <a href="/suggestions">Suggestions page</a> and we will take a look. We may add a correction note where a review is shown to be factually wrong.</p>
<h2>Your submissions</h2>
<p>When you send us a suggestion, a tournament listing, or an advertising inquiry, you keep ownership of what you wrote. You give us permission to publish the tournament information you submit, and to display your review publicly together with the name you provide. Do not submit anything you do not have the right to share.</p>
<h2>Advertising</h2>
<p>Sponsored and featured placements on this site are labeled as such. Advertising and sponsorship never affect ratings, scores, or rankings.</p>
<h2>Acceptable use</h2>
<p>Do not misuse this site: no impersonating another person or organization, no attempting to disrupt or gain unauthorized access to the site, no posting unlawful content, and no automated collection of site content at rates that burden the service.</p>
<h2>No warranty; limits</h2>
<p>This site is provided "as is." Families make their own decisions about which tournaments to attend, and to the extent allowed by law we are not liable for decisions made in reliance on a listing or a review, or for losses arising from use of the site.</p>
<h2>Who this site is for</h2>
<p>TourneyRatings is written for parents, guardians, coaches, and organizers — adults. It is not directed at children.</p>
<h2>Changes and contact</h2>
<p>We may update these terms from time to time; the current version will always be posted here, and continuing to use the site means you accept the updated terms. These terms are governed by California law. Questions: use the <a href="/suggestions">Suggestions page</a>.</p>
</div>
`;
  return layout({ title: "Terms of Service", active: "", body });
}

function privacyPage() {
  const body = `
<h1>Privacy Policy</h1>
<div class="story">
<p><em>Last updated November 18, 2026.</em></p>
<h2>The short version</h2>
<p>We collect as little as we can run the site with. We do not sell personal information, we do not share it for marketing, and this site runs no third-party advertising trackers and sets no tracking cookies.</p>
<h2>What we collect</h2>
<p><strong>Reviews.</strong> When you review a tournament, we store the name you enter, your team's age group, your scores, and your comments. Reviews are public by design: your review is displayed on the site together with the name you provided, so please use the form of your name you are comfortable seeing in public (for example, "Matthew S.").</p>
<p><strong>Forms.</strong> The Suggestions form, the List Your Tournament form, and the advertising inquiry form collect the name and email address you enter, along with your message and any tournament details you provide. Form submissions are not published.</p>
<p><strong>Basic technical counts.</strong> We keep aggregate counts of page views by site section (for example, how many times the calendar was viewed) so we know what parents use. These counts are not tied to you personally. Our hosting provider also keeps standard server logs, as every website host does.</p>
<h2>How we use it</h2>
<p>To operate the site, publish reviews, respond to your messages, correct listings, and prevent spam and abuse. That is all.</p>
<h2>What we share</h2>
<p>Reviews are public, as described above. Everything else — your email address and your form messages — is not published, not sold, and not shared with third parties for their marketing. We would disclose information only if the law required it.</p>
<h2>Your choices</h2>
<p>You can ask us to remove your review or delete information you sent through a form at any time. Contact us through the <a href="/suggestions">Suggestions page</a> and tell us what you submitted and what you would like removed, and we will take care of it.</p>
<h2>Children</h2>
<p>This site is for adults — parents, guardians, coaches, and organizers. It is not directed at children, and we do not knowingly collect personal information from children under 13.</p>
<h2>Security</h2>
<p>We use reasonable measures to protect the information we store. No system is perfectly secure, but the less a site collects, the less there is to protect — which is why we collect so little.</p>
<h2>Changes and contact</h2>
<p>If this policy changes, the updated version will be posted here with a new date. Questions about privacy: use the <a href="/suggestions">Suggestions page</a>.</p>
</div>
`;
  return layout({ title: "Privacy Policy", active: "", body });
}

function accessibilityPage() {
  const body = `
<h1>Accessibility</h1>
<div class="story">
<p>TourneyRatings is built for every hockey parent, including parents who use assistive technology. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA, and we treat accessibility as ongoing work, not a one-time check.</p>
<h2>What we do</h2>
<p>Pages use semantic structure with landmarks and a logical heading order, plus a "Skip to main content" link for keyboard and screen-reader users. Every form field has a label, images that carry meaning have text alternatives, and text and controls are styled to meet WCAG AA contrast ratios. Interactive elements show a visible focus indicator when you navigate by keyboard.</p>
<h2>Known limits</h2>
<p>This site links out to organizer, ranking, and travel websites that we do not control, and we cannot guarantee their accessibility. Tournament information itself comes from organizers and parent reviews, so an occasional listing may be easier to use in one format than another.</p>
<h2>Hit a barrier? Tell us</h2>
<p>If any part of this site is hard or impossible for you to use, please let us know through the <a href="/suggestions">Suggestions page</a> and tell us what you were trying to do. We will fix the barrier or provide the information another way — whichever gets you the answer faster.</p>
</div>
`;
  return layout({ title: "Accessibility", active: "", body });
}

function usefulWebsitesPage({ outdoor }) {
  const outdoorList = (outdoor || [])
    .map(
      (t) =>
        `<li><a href="/tournaments/${t.id}">${esc(t.name)}</a> — ${esc(t.city)}, ${esc(t.state)} · ${esc(fmtDateRange(t.startDate, t.endDate))}</li>`
    )
    .join("");
  const body = `
<h1>Useful websites for hockey families</h1>
<p class="lede">The sites we point other hockey parents to — for finding outdoor ice, checking how strong the field is, and looking up the rules before you register.</p>

<h2>Outdoor rinks</h2>
<p><strong><a href="https://www.rinkwatch.org/" target="_blank" rel="noopener">RinkWatch</a></strong> — an interactive map of outdoor rinks across Canada and the northern United States, run by researchers at Wilfrid Laurier University. Volunteers pin their backyard and neighborhood rinks on the map and report all winter whether the ice is skateable. Headed to a winter tournament? Check the map for an outdoor rink near your hotel — some of the best tournament memories happen on borrowed ice between games.</p>
<p><strong><a href="https://www.rinktime.com/" target="_blank" rel="noopener">RinkTime</a></strong> — a directory of ice rinks across the U.S. and Canada, indoor and outdoor, searchable by city and state.</p>

<h2>Know the field</h2>
<p><strong><a href="https://myhockeyrankings.com/" target="_blank" rel="noopener">MYHockey Rankings</a></strong> — team rankings by age group and level, updated through the season. The quickest way to sanity-check whether a tournament division matches your team's level.</p>
<p><strong><a href="https://www.eliteprospects.com/" target="_blank" rel="noopener">Elite Prospects</a></strong> — rosters, player stats and league standings, from youth hockey up through college and the pros.</p>

<h2>Rules &amp; registration</h2>
<p><strong><a href="https://www.usahockey.com/" target="_blank" rel="noopener">USA Hockey</a></strong> — the national governing body: age classifications, playing rules, coaching and officiating info, and player registration.</p>

<h2>Outdoor &amp; pond hockey tournaments on TourneyRatings</h2>
${outdoorList ? `<ul>${outdoorList}</ul>` : `<p>No outdoor tournaments are listed right now — <a href="/tournaments">browse the calendar</a>.</p>`}
<p>Know a site that belongs on this page? <a href="/suggestions">Send us a suggestion</a>.</p>
`;
  return layout({ title: "Useful Websites for Hockey Families", active: "useful", description: "Useful websites for youth hockey families: RinkWatch's outdoor rink map, MYHockey Rankings, Elite Prospects, USA Hockey, and TourneyRatings' outdoor and pond hockey tournaments.", body });
}

function swagPage() {
  const body = `
<h1>Hockey swag &amp; gear</h1>
<p class="lede">Tournament weekends are about more than the games — it's the shirt you live in at the rink, the gear that survives the season. Violent Gentlemen is the one in my closet; the rest are the brands and shops hockey families keep coming back to. Nobody pays to be on this page — same rule as the ratings.</p>

<h2>What I wear</h2>
<p><span class="badge ok">★ The founder's personal favorite</span></p>
<p><strong><a href="https://vghc.com/" target="_blank" rel="noopener">Violent Gentlemen Hockey Club</a></strong> — my personal favorite, and my go-to shirts, full stop. I wear them all the time: at the rink, on tournament trips, everywhere. Hockey apparel made by people who clearly love the game as much as the families living it.</p>

<h2>More brands hockey families wear</h2>
<p><strong><a href="https://www.gongshowgear.ca/" target="_blank" rel="noopener">Gongshow</a></strong> — the Canadian hockey lifestyle brand. Hoodies, tees and hats built around locker-room culture and hockey humor; if you've been to a tournament in Canada, you've seen their gear in the stands.</p>
<p><strong><a href="https://saucehockey.com/" target="_blank" rel="noopener">Sauce Hockey</a></strong> — a U.S. hockey lifestyle brand in the same lane: tees, hoodies and hats with a laid-back, hockey-culture feel, made for players and the parents who drive them everywhere.</p>

<h2>Where I buy gear</h2>
<p><strong><a href="https://www.purehockey.com/" target="_blank" rel="noopener">Pure Hockey</a></strong> — one of the biggest hockey retailers in the country, with stores across the U.S. and a full online shop. Skates, sticks, protective, goalie gear — when one of the kids needs something before a tournament weekend, this is one of the first places I look.</p>

<p>More picks land here as I find them. Got a brand or a shop you swear by? <a href="/suggestions">Send us a suggestion</a>.</p>
`;
  return layout({ title: "Hockey Swag & Gear — The Founder's Picks", active: "swag", description: "The founder's hockey swag and gear picks: Violent Gentlemen Hockey Club shirts, Gongshow and Sauce Hockey apparel, and Pure Hockey for gear. Nobody pays to be listed — just what a hockey dad actually wears and buys.", body });
}

function notFoundPage() {
  const body = `<h1>That page isn't here</h1><p>The tournament you're looking for may have skated off. <a href="/tournaments">Back to the calendar →</a></p>`;
  return layout({ title: "Not Found", active: "", body });
}

module.exports = {
  CRITERIA,
  EXPERIENCE_TAGS,
  AGE_GROUPS,
  LEVELS,
  DIVISIONS,
  VIDEO_POLICIES,
  VENDORS,
  FOOD,
  EXTRA_NIGHT,
  esc,
  fmtMoney,
  fmtDateRange,
  fmtScore,
  reviewOverall,
  aggregate,
  ageTokens,
  levelTokens,
  divisionTokens,
  homePage,
  tournamentsPage,
  tournamentPage,
  ratePage,
  topRatedPage,
  listTournamentPage,
  advertisePage,
  SUGGESTION_CATEGORIES,
  suggestionsPage,
  founderPage,
  termsPage,
  privacyPage,
  accessibilityPage,
  usefulWebsitesPage,
  swagPage,
  adminPage,
  notFoundPage,
};
