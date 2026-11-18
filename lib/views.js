// Server-side HTML rendering for TourneyRatings. Plain string templates,
// no template engine -- one less dependency to maintain. Every piece of
// user-supplied text goes through esc() before it reaches the page.

"use strict";

const CRITERIA = [
  { key: "level", label: "Level honesty", hint: "Were the divisions fair, or was somebody sandbagging?" },
  { key: "organization", label: "Organization", hint: "Schedules out on time, games starting on time." },
  { key: "stayToPlay", label: "Stay-to-play", hint: "Required or not, and were the hotels fairly priced and close?" },
  { key: "facilities", label: "Facilities & refs", hint: "Ice, locker rooms, and officiating." },
  { key: "value", label: "Value", hint: "What you got for the entry fee." },
];

const EXPERIENCE_TAGS = [
  { name: "Outdoor Ice", definition: "Games are played outdoors, on open-air rinks or natural ice." },
  { name: "Pro Ice", definition: "Games are played on a pro team's ice — an NHL arena or practice facility." },
  { name: "International Field", definition: "Teams travel in from more than one country, so your player faces opponents from abroad." },
  { name: "Pond Hockey", definition: "Old-school hockey on a frozen pond or lake, the way the game started." },
  { name: "Destination City", definition: "Hosted somewhere worth the trip on its own — bring the family, stay an extra day." },
];

const AGE_GROUPS = ["8U", "10U", "12U", "14U", "16U", "18U", "19U"];
const LEVELS = ["AAA", "AA", "A", "BB", "B", "House"];
const DIVISIONS = ["Youth", "Girls", "High School"];

const VIDEO_POLICIES = {
  "filmed-freely": "Parents could film freely",
  "paywalled-stream": "Streaming is paywalled",
  "filming-restricted": "Filming was restricted",
  "filming-restricted-paywall": "Filming restricted, and the stream is paywalled",
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

function layout({ title, active, body }) {
  const navLink = (href, key, label) =>
    `<a href="${href}"${active === key ? ' class="active"' : ""}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · TourneyRatings</title>
<meta name="description" content="Youth hockey tournaments, rated by the parents who paid for them. Level honesty, organization, stay-to-play, facilities and value — scored before you commit your team and your money. Veteran owned.">
<link rel="stylesheet" href="/style.css?v=4">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><svg class="puck" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="#7fc4f0"/><circle cx="16" cy="16" r="11" fill="#0b2a4a"/><path d="M9 11.5 L23 20.5" stroke="#c8102e" stroke-width="3.2" stroke-linecap="round"/></svg>Tourney<span>Ratings</span></a>
    <nav class="main-nav">
      ${navLink("/tournaments", "tournaments", "Tournaments")}
      ${navLink("/top-rated", "top", "Top Rated")}
      ${navLink("/founder", "founder", "Founder's Story")}
      ${navLink("/list-your-tournament", "list", "List Your Tournament")}
      ${navLink("/advertise", "advertise", "Advertise")}
      ${navLink("/suggestions", "suggest", "Suggestions")}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p><strong>TourneyRatings</strong> — youth hockey tournaments, rated by parents. Built by a hockey dad. <strong>Veteran owned.</strong> ${remembrancePoppy()}</p>
    <p class="footer-links">
      <a href="/tournaments">Tournament calendar</a> ·
      <a href="/top-rated">Top Rated by Parents</a> ·
      <a href="/founder">Founder's Story</a> ·
      <a href="/list-your-tournament">List your tournament</a> ·
      <a href="/advertise">Advertise</a> ·
      <a href="/suggestions">Suggestions</a>
    </p>
    <p class="fineprint">Ratings are parent opinions from real tournament weekends. We never sell scores — placement in Top Rated is earned, not bought.</p>
    <p class="fineprint">Homepage photo: Atlantic Ambience, via Pexels (free to use).</p>
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
  for (const d of divisionTokens(t)) {
    if (d === "Girls") badges.push(`<span class="badge ok">Girls tournament</span>`);
    if (d === "High School") badges.push(`<span class="badge ok">High school</span>`);
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
  const ret = r.wouldReturn == null
    ? ""
    : `<span class="badge ${r.wouldReturn ? "ok" : "warn"}">${r.wouldReturn ? "Would return" : "Would not return"}</span>`;
  return `<article class="review${founder ? " founder" : ""}">
  <div class="review-top">
    <strong>${esc(r.reviewerName)}</strong>
    <span class="meta">${esc(r.teamAgeGroup || "")} · ${esc(fmtDate(String(r.createdAt).slice(0, 10)))}</span>
    <span class="score-badge${scoreTone(overall)}">${fmtScore(overall)}<small> / 5</small></span>
  </div>
  ${founder ? `<p class="founder-flag">Review #1 — the founder's review</p>` : ""}
  <p>${esc(r.comment || "")}</p>
  <p class="review-scores">${CRITERIA.map((c) => `${esc(c.label)}: <strong>${r.scores[c.key]}</strong>`).join(" · ")}</p>
  <p>${ret} ${policy}</p>
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
  <p class="lede">Before you commit your team — and your money — check the five things parents actually talk about in the stands: level honesty, organization, stay-to-play, facilities &amp; refs, and value.</p>
  <form class="hero-search" action="/tournaments" method="get">
    <input type="search" name="q" placeholder="Search tournaments, cities, organizers…" aria-label="Search tournaments">
    <button type="submit">Search</button>
  </form>
  <p class="hero-stats">${totals.tournaments} tournaments listed · ${totals.reviews} parent reviews · <a href="/tournaments">Tournaments across the U.S. &amp; Canada →</a></p>
  <p><span class="vet-badge">★ Veteran Owned</span>${remembrancePoppy() ? ` <span class="poppy-wrap">${remembrancePoppy()}<span class="poppy-note">Lest we forget</span></span>` : ""}</p>
</section>

<section class="spotlight">
  <div class="spotlight-story">
    <h2>Why this site exists</h2>
    <p>I'm a hockey dad. After years of tournament weekends with my son and daughter, the same frustrations kept coming up: stay-to-play hotels at marked-up rates an hour from the rink, divisions with a team clearly playing down, schedules that drop the Wednesday before a Friday start. There was no structured way for parents to compare tournaments before signing up — so I built one.</p>
    <p>TourneyRatings covers tournaments across the U.S. and Canada, and it starts with one honest review: mine. If you've played a tournament, good or bad, your review is what makes this work.</p>
    <p><a href="/founder">Read the full story — from Little Kings in 2012 to two kids in college hockey →</a></p>
    <p><a class="button" href="/tournaments">Browse the calendar</a> <a class="button ghost" href="/tournaments/${bell.id}/rate">Review a tournament</a></p>
  </div>
  <div class="spotlight-review">
    <h2>Review #1</h2>
    ${reviewCard(bellReview, { founder: true })}
    <p><a href="/tournaments/${bell.id}">${esc(bell.name)} — full details →</a></p>
  </div>
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

<section>
  <h2>What the experience tags mean</h2>
  <dl class="tag-defs">
    ${EXPERIENCE_TAGS.map((tag) => `<div><dt><span class="tag">${esc(tag.name)}</span></dt><dd>${esc(tag.definition)}</dd></div>`).join("")}
  </dl>
</section>

<section class="qr-share">
  <img src="/images/qr-tourneyratings.png" alt="QR code linking to tourneyratings.com" width="150" height="150">
  <div>
    <h2>Spread the word</h2>
    <p>This QR code links straight to TourneyRatings. Copy it and put it anywhere hockey parents will see it — a team flyer, a group chat, a rink bulletin board, a tournament page. The more parents rate, the more every family gets out of this.</p>
    <p><strong><a href="/images/qr-tourneyratings.png" download>Download the QR code (PNG)</a></strong></p>
    <p class="meta">On a phone, press and hold the code to save or copy it. On a computer, right-click it.</p>
  </div>
</section>

<div class="ad-row single">${houseAd(1)}</div>
`;
  return layout({ title: "Youth Hockey Tournaments, Rated by Parents", active: "home", body });
}

function tournamentsPage({ items, states, filters, myPlayerData, matchCount }) {
  const f = filters;
  const stateOptions = states
    .map((s) => `<option value="${esc(s.code)}"${f.state === s.code ? " selected" : ""}>${esc(s.code)}${s.count === 0 ? " — no tournament listed" : ""}</option>`)
    .join("");
  const selectedState = states.find((s) => s.code === f.state);
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
  <a class="chip" href="/tournaments?div=Girls">Girls tournaments</a>
  <a class="chip" href="/tournaments?div=High%20School">High school</a>
  ${EXPERIENCE_TAGS.map((tag) => `<a class="chip" href="/tournaments?tag=${encodeURIComponent(tag.name)}">${esc(tag.name)}</a>`).join("")}
</p>

<form class="filters" action="/tournaments" method="get">
  <div class="filter-grid">
    <label>Search
      <input type="search" name="q" value="${esc(f.q)}" placeholder="Name, city, organizer…">
    </label>
    <label>State / province
      <select name="state"><option value="">All states</option>${stateOptions}</select>
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

<p class="result-count">${items.length} tournament${items.length === 1 ? "" : "s"} shown</p>
<div class="grid">
  ${items.length ? items.map(({ t, agg }) => tournamentCard(t, agg)).join("") : emptyMsg}
</div>

<details class="tag-legend">
  <summary>What do the experience tags mean?</summary>
  <dl class="tag-defs">
    ${EXPERIENCE_TAGS.map((tag) => `<div><dt><span class="tag">${esc(tag.name)}</span></dt><dd>${esc(tag.definition)}</dd></div>`).join("")}
  </dl>
</details>

<script type="application/json" id="myplayer-data">${JSON.stringify(myPlayerData)}</script>
`;
  return layout({ title: "Tournament Calendar", active: "tournaments", body });
}

function tournamentPage({ t, agg, reviews, thanks }) {
  const fee = fmtMoney(t.entryFeeCents);
  const policies = [...new Set(reviews.map((r) => r.videoPolicy).filter((p) => p && p !== "not-reported"))];
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
  return layout({ title: t.name, active: "tournaments", body });
}

function ratePage({ t, error }) {
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
    <label>Your name (first name + last initial is fine)
      <input type="text" name="reviewerName" maxlength="60" required>
    </label>
    <label>Your team / age group
      <input type="text" name="teamAgeGroup" maxlength="60" placeholder="e.g. 12U AA">
    </label>
  </div>
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
  <label class="score-field">Your review
    <textarea name="comment" rows="5" maxlength="4000" placeholder="What should the next parent know before they sign up?"></textarea>
  </label>
  <p><button type="submit">Submit review</button></p>
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
  return layout({ title: "Top Rated by Parents", active: "top", body });
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

function founderPage() {
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
<p>Parents should be able to look up a tournament, educate themselves before they commit, and choose the ones that are right for their family — not just sign up for whatever everybody else is doing. Here, parents rate tournaments on the things that actually matter: fair divisions, organization, stay-to-play, facilities and officiating, and value for your money. No marketing — just honest reviews from families who were there. And when organizers, coaches, and managers know parents are paying attention, it holds them accountable to run tournaments the right way.</p>
<p>If you've played in a tournament, good or bad, leave a review. You'll be helping another hockey family the way I wish someone had helped ours back in 2012.</p>
<p class="signoff">— Matthew S., hockey dad, Southern California</p>
<p><a class="button" href="/tournaments">Browse the tournament calendar</a> <a class="button ghost" href="/top-rated">See the top rated tournaments</a></p>
</div>
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
  adminPage,
  notFoundPage,
};
