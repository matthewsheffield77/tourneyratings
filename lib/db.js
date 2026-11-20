// Data layer for TourneyRatings.
//
// Production: Postgres, via the `pg` package, using the DATABASE_URL
// environment variable (Render wires this in automatically). Tables are
// created on boot if missing, and the seed data (lib/seed.js) is inserted
// only when the tournaments table is empty, so seeding is idempotent and
// safe to run on every deploy.
//
// LOCAL TESTING ONLY: when DATABASE_URL is not set, the app falls back to
// an in-memory copy of the seed data so the site can be run and smoke
// tested on a machine without Postgres. Nothing persists in that mode and
// it must never be used in production -- Render always sets DATABASE_URL.

"use strict";

const seed = require("./seed");

const usePostgres = Boolean(process.env.DATABASE_URL);
let pool = null;
let mem = null; // in-memory fallback state (local testing only)

function shouldUseSsl(url) {
  if (process.env.DATABASE_SSL === "1") return true;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  // External Render Postgres URLs need SSL; internal ones work either way
  // with rejectUnauthorized disabled, so enable it for anything non-local.
  return /\.render\.com/.test(url) || process.env.DATABASE_SSL === "require";
}

async function initPostgres() {
  const { Pool } = require("pg");
  const url = process.env.DATABASE_URL;
  pool = new Pool({
    connectionString: url,
    ssl: shouldUseSsl(url) ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      organizer TEXT,
      city TEXT,
      state TEXT,
      venue TEXT,
      start_date DATE,
      end_date DATE,
      age_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
      levels JSONB NOT NULL DEFAULT '[]'::jsonb,
      games_guaranteed INTEGER,
      stay_to_play BOOLEAN NOT NULL DEFAULT false,
      entry_fee_cents INTEGER,
      gate_fee_cents INTEGER,
      schedule_release_days INTEGER,
      experience_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      featured BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      reviewer_name TEXT NOT NULL,
      team_age_group TEXT,
      level_score SMALLINT NOT NULL,
      organization_score SMALLINT NOT NULL,
      stay_to_play_score SMALLINT NOT NULL,
      facilities_score SMALLINT NOT NULL,
      value_score SMALLINT NOT NULL,
      would_return BOOLEAN,
      video_policy TEXT,
      vendors TEXT,
      food TEXT,
      extra_night TEXT,
      attended_year INTEGER,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS divisions JSONB NOT NULL DEFAULT '["Youth"]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE reviews
      ADD COLUMN IF NOT EXISTS vendors TEXT
  `);
  await pool.query(`
    ALTER TABLE reviews
      ADD COLUMN IF NOT EXISTS food TEXT
  `);
  await pool.query(`
    ALTER TABLE reviews
      ADD COLUMN IF NOT EXISTS extra_night TEXT
  `);
  await pool.query(`
    ALTER TABLE reviews
      ADD COLUMN IF NOT EXISTS attended_year INTEGER
  `);
  await pool.query(`
    ALTER TABLE tournaments ALTER COLUMN stay_to_play DROP NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      category TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_views (
      section TEXT PRIMARY KEY,
      views INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizer_submissions (
      id SERIAL PRIMARY KEY,
      tournament_name TEXT NOT NULL,
      organizer TEXT,
      contact_name TEXT,
      contact_email TEXT,
      city TEXT,
      state TEXT,
      venue TEXT,
      start_date TEXT,
      end_date TEXT,
      age_groups TEXT,
      levels TEXT,
      games_guaranteed INTEGER,
      entry_fee TEXT,
      gate_fee TEXT,
      stay_to_play BOOLEAN,
      schedule_release_days INTEGER,
      experience_tags TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Optional rating submitted together with a tournament listing (the
  // "Rate it now" section of the List Your Tournament form). The rating is
  // held with the submission and published as the tournament's first
  // review by publishSubmissionReview() once the listing goes live.
  // rating_published_review_id records the reviews.id it became, so a
  // held rating can never be published twice.
  await pool.query(`
    ALTER TABLE organizer_submissions
      ADD COLUMN IF NOT EXISTS rating_reviewer_name TEXT,
      ADD COLUMN IF NOT EXISTS rating_team_age_group TEXT,
      ADD COLUMN IF NOT EXISTS rating_level SMALLINT,
      ADD COLUMN IF NOT EXISTS rating_organization SMALLINT,
      ADD COLUMN IF NOT EXISTS rating_stay_to_play SMALLINT,
      ADD COLUMN IF NOT EXISTS rating_facilities SMALLINT,
      ADD COLUMN IF NOT EXISTS rating_value SMALLINT,
      ADD COLUMN IF NOT EXISTS rating_would_return BOOLEAN,
      ADD COLUMN IF NOT EXISTS rating_video_policy TEXT,
      ADD COLUMN IF NOT EXISTS rating_vendors TEXT,
      ADD COLUMN IF NOT EXISTS rating_food TEXT,
      ADD COLUMN IF NOT EXISTS rating_extra_night TEXT,
      ADD COLUMN IF NOT EXISTS rating_attended_year INTEGER,
      ADD COLUMN IF NOT EXISTS rating_comment TEXT,
      ADD COLUMN IF NOT EXISTS rating_published_review_id INTEGER
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM tournaments");
  if (rows[0].n === 0) {
    await seedPostgres();
    console.log(
      `Seeded Postgres with ${seed.tournaments.length} tournaments and ${seed.reviews.length} reviews.`
    );
  }
  // The seed file is the source of truth for listing data: upsert every
  // entry on boot so corrections in lib/seed.js reach the live database,
  // then remove any listings/reviews the seed has retired (2026-11-18
  // audit). Visitor-submitted reviews are never touched by this sync --
  // only the specific retired seed review ids are deleted.
  await syncTournamentsPostgres();
  await syncSeedReviewsPostgres();
  await applyRetirementsPostgres();
}

const TOURNAMENT_UPSERT = `
  INSERT INTO tournaments
    (id, name, organizer, city, state, venue, start_date, end_date,
     age_groups, levels, games_guaranteed, stay_to_play,
     entry_fee_cents, gate_fee_cents, schedule_release_days,
     experience_tags, featured, divisions)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    organizer = EXCLUDED.organizer,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    venue = EXCLUDED.venue,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    age_groups = EXCLUDED.age_groups,
    levels = EXCLUDED.levels,
    games_guaranteed = EXCLUDED.games_guaranteed,
    stay_to_play = EXCLUDED.stay_to_play,
    entry_fee_cents = EXCLUDED.entry_fee_cents,
    gate_fee_cents = EXCLUDED.gate_fee_cents,
    schedule_release_days = EXCLUDED.schedule_release_days,
    experience_tags = EXCLUDED.experience_tags,
    featured = EXCLUDED.featured,
    divisions = EXCLUDED.divisions`;

function tournamentParams(t) {
  return [
    t.id, t.name, t.organizer, t.city, t.state, t.venue,
    t.startDate, t.endDate,
    JSON.stringify(t.ageGroups), JSON.stringify(t.levels),
    t.gamesGuaranteed, t.stayToPlay,
    t.entryFeeCents, t.gateFeeCents, t.scheduleReleaseDays,
    JSON.stringify(t.experienceTags), t.featured,
    JSON.stringify(t.divisions || ["Youth"]),
  ];
}

async function syncTournamentsPostgres() {
  const all = [...(seed.tournaments || []), ...(seed.additions || [])];
  for (const t of all) {
    await pool.query(TOURNAMENT_UPSERT, tournamentParams(t));
  }
}

const REVIEW_UPSERT = `
  INSERT INTO reviews
    (id, tournament_id, reviewer_name, team_age_group,
     level_score, organization_score, stay_to_play_score,
     facilities_score, value_score, would_return, video_policy,
     vendors, food, extra_night, attended_year, comment, created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  ON CONFLICT (id) DO UPDATE SET
    tournament_id = EXCLUDED.tournament_id,
    reviewer_name = EXCLUDED.reviewer_name,
    team_age_group = EXCLUDED.team_age_group,
    level_score = EXCLUDED.level_score,
    organization_score = EXCLUDED.organization_score,
    stay_to_play_score = EXCLUDED.stay_to_play_score,
    facilities_score = EXCLUDED.facilities_score,
    value_score = EXCLUDED.value_score,
    would_return = EXCLUDED.would_return,
    video_policy = EXCLUDED.video_policy,
    vendors = EXCLUDED.vendors,
    food = EXCLUDED.food,
    extra_night = EXCLUDED.extra_night,
    attended_year = EXCLUDED.attended_year,
    comment = EXCLUDED.comment,
    created_at = EXCLUDED.created_at`;

// Seed reviews (the founder's) are seed-file content, like the listings:
// upsert them on boot so corrections reach the live database. Visitor
// reviews are never in the seed file and are never touched by this sync.
async function syncSeedReviewsPostgres() {
  for (const r of seed.reviews || []) {
    await pool.query(REVIEW_UPSERT, [
      r.id, r.tournamentId, r.reviewerName, r.teamAgeGroup,
      r.scores.level, r.scores.organization, r.scores.stayToPlay,
      r.scores.facilities, r.scores.value, r.wouldReturn, r.videoPolicy,
      r.vendors || "not-reported", r.food || "not-reported",
      r.extraNight || "not-reported", r.attendedYear ?? null,
      r.comment, r.createdAt,
    ]);
  }
}

async function applyRetirementsPostgres() {
  if ((seed.retiredReviewIds || []).length) {
    await pool.query("DELETE FROM reviews WHERE id = ANY($1::int[])", [
      seed.retiredReviewIds,
    ]);
  }
  if ((seed.retiredTournamentIds || []).length) {
    await pool.query("DELETE FROM tournaments WHERE id = ANY($1::int[])", [
      seed.retiredTournamentIds,
    ]);
  }
}

async function seedPostgres() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of seed.tournaments) {
      await client.query(
        `INSERT INTO tournaments
           (id, name, organizer, city, state, venue, start_date, end_date,
            age_groups, levels, games_guaranteed, stay_to_play,
            entry_fee_cents, gate_fee_cents, schedule_release_days,
            experience_tags, featured, divisions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          t.id, t.name, t.organizer, t.city, t.state, t.venue,
          t.startDate, t.endDate,
          JSON.stringify(t.ageGroups), JSON.stringify(t.levels),
          t.gamesGuaranteed, t.stayToPlay,
          t.entryFeeCents, t.gateFeeCents, t.scheduleReleaseDays,
          JSON.stringify(t.experienceTags), t.featured,
          JSON.stringify(t.divisions || ["Youth"]),
        ]
      );
    }
    for (const r of seed.reviews) {
      await client.query(
        `INSERT INTO reviews
           (id, tournament_id, reviewer_name, team_age_group,
            level_score, organization_score, stay_to_play_score,
            facilities_score, value_score, would_return, video_policy,
            vendors, food, extra_night, attended_year, comment, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          r.id, r.tournamentId, r.reviewerName, r.teamAgeGroup,
          r.scores.level, r.scores.organization, r.scores.stayToPlay,
          r.scores.facilities, r.scores.value, r.wouldReturn, r.videoPolicy,
          r.vendors || "not-reported", r.food || "not-reported",
          r.extraNight || "not-reported", r.attendedYear ?? null,
          r.comment, r.createdAt,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function initMemory() {
  const base = seed.tournaments.map((t) => ({ ...t }));
  for (const a of seed.additions || []) {
    if (!base.some((t) => t.id === a.id)) base.push({ ...a });
  }
  mem = {
    tournaments: base,
    reviews: seed.reviews.map((r) => ({ ...r, scores: { ...r.scores } })),
    submissions: [],
    suggestions: [],
    pageViews: {},
    nextReviewId: Math.max(...seed.reviews.map((r) => r.id)) + 1,
    nextSubmissionId: 1,
    nextSuggestionId: 1,
  };
  console.warn(
    "WARNING: DATABASE_URL is not set -- using the in-memory fallback (LOCAL TESTING ONLY). Data will not persist."
  );
}

async function init() {
  if (usePostgres) {
    await initPostgres();
  } else {
    initMemory();
  }
}

// --- Row mapping (Postgres -> app shape) ---------------------------------

function mapTournament(row) {
  return {
    id: row.id,
    name: row.name,
    organizer: row.organizer,
    city: row.city,
    state: row.state,
    venue: row.venue,
    startDate: row.start_date,
    endDate: row.end_date,
    ageGroups: row.age_groups || [],
    levels: row.levels || [],
    gamesGuaranteed: row.games_guaranteed,
    stayToPlay: row.stay_to_play,
    entryFeeCents: row.entry_fee_cents,
    gateFeeCents: row.gate_fee_cents,
    scheduleReleaseDays: row.schedule_release_days,
    experienceTags: row.experience_tags || [],
    featured: row.featured,
    divisions: row.divisions && row.divisions.length ? row.divisions : ["Youth"],
  };
}

function mapReview(row) {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    reviewerName: row.reviewer_name,
    teamAgeGroup: row.team_age_group,
    scores: {
      level: row.level_score,
      organization: row.organization_score,
      stayToPlay: row.stay_to_play_score,
      facilities: row.facilities_score,
      value: row.value_score,
    },
    wouldReturn: row.would_return,
    videoPolicy: row.video_policy,
    vendors: row.vendors,
    food: row.food,
    extraNight: row.extra_night,
    attendedYear: row.attended_year,
    comment: row.comment,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

// --- Queries ---------------------------------------------------------------

async function listTournaments() {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, name, organizer, city, state, venue,
              start_date::text AS start_date, end_date::text AS end_date,
              age_groups, levels, games_guaranteed, stay_to_play,
              entry_fee_cents, gate_fee_cents, schedule_release_days,
              experience_tags, featured, divisions
         FROM tournaments
        ORDER BY start_date ASC, name ASC`
    );
    return rows.map(mapTournament);
  }
  return mem.tournaments
    .slice()
    .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")) || a.name.localeCompare(b.name));
}

async function getTournament(id) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, name, organizer, city, state, venue,
              start_date::text AS start_date, end_date::text AS end_date,
              age_groups, levels, games_guaranteed, stay_to_play,
              entry_fee_cents, gate_fee_cents, schedule_release_days,
              experience_tags, featured, divisions
         FROM tournaments WHERE id = $1`,
      [id]
    );
    return rows.length ? mapTournament(rows[0]) : null;
  }
  return mem.tournaments.find((t) => t.id === id) || null;
}

async function listReviews(tournamentId) {
  if (pool) {
    const params = [];
    let where = "";
    if (tournamentId != null) {
      where = "WHERE tournament_id = $1";
      params.push(tournamentId);
    }
    const { rows } = await pool.query(
      `SELECT * FROM reviews ${where} ORDER BY created_at DESC`,
      params
    );
    return rows.map(mapReview);
  }
  const all = tournamentId == null
    ? mem.reviews.slice()
    : mem.reviews.filter((r) => r.tournamentId === tournamentId);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function addReview(tournamentId, data) {
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO reviews
         (id, tournament_id, reviewer_name, team_age_group,
          level_score, organization_score, stay_to_play_score,
          facilities_score, value_score, would_return, video_policy, vendors, food,
          extra_night, attended_year, comment)
       VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM reviews),
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        tournamentId, data.reviewerName, data.teamAgeGroup,
        data.scores.level, data.scores.organization, data.scores.stayToPlay,
        data.scores.facilities, data.scores.value, data.wouldReturn,
        data.videoPolicy, data.vendors, data.food,
        data.extraNight || "not-reported", data.attendedYear ?? null, data.comment,
      ]
    );
    return mapReview(rows[0]);
  }
  const review = {
    id: mem.nextReviewId++,
    tournamentId,
    reviewerName: data.reviewerName,
    teamAgeGroup: data.teamAgeGroup,
    scores: { ...data.scores },
    wouldReturn: data.wouldReturn,
    videoPolicy: data.videoPolicy,
    vendors: data.vendors,
    food: data.food,
    extraNight: data.extraNight || "not-reported",
    attendedYear: data.attendedYear ?? null,
    comment: data.comment,
    createdAt: new Date().toISOString(),
  };
  mem.reviews.push(review);
  return review;
}

async function addOrganizerSubmission(data) {
  if (pool) {
    const r = data.rating || null;
    const { rows } = await pool.query(
      `INSERT INTO organizer_submissions
         (tournament_name, organizer, contact_name, contact_email, city, state,
          venue, start_date, end_date, age_groups, levels, games_guaranteed,
          entry_fee, gate_fee, stay_to_play, schedule_release_days,
          experience_tags, notes,
          rating_reviewer_name, rating_team_age_group,
          rating_level, rating_organization, rating_stay_to_play,
          rating_facilities, rating_value, rating_would_return,
          rating_video_policy, rating_vendors, rating_food,
          rating_extra_night, rating_attended_year, rating_comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING id`,
      [
        data.tournamentName, data.organizer, data.contactName, data.contactEmail,
        data.city, data.state, data.venue, data.startDate, data.endDate,
        data.ageGroups, data.levels, data.gamesGuaranteed, data.entryFee,
        data.gateFee, data.stayToPlay, data.scheduleReleaseDays,
        data.experienceTags, data.notes,
        r ? r.reviewerName : null, r ? r.teamAgeGroup : null,
        r ? r.scores.level : null, r ? r.scores.organization : null,
        r ? r.scores.stayToPlay : null, r ? r.scores.facilities : null,
        r ? r.scores.value : null, r ? r.wouldReturn : null,
        r ? r.videoPolicy : null, r ? r.vendors : null, r ? r.food : null,
        r ? r.extraNight : null, r ? r.attendedYear : null,
        r ? r.comment : null,
      ]
    );
    return rows[0].id;
  }
  const id = mem.nextSubmissionId++;
  mem.submissions.push({ id, ...data, createdAt: new Date().toISOString() });
  return id;
}

// Publish a submission's held rating as a live review.
//
// Listings are created by hand: an approved submission is added to
// lib/seed.js and goes live on the next deploy (the seed sync upserts it).
// There is deliberately no admin UI for this. When a submission that
// carries a held rating (the optional "Rate it now" section of the List
// Your Tournament form) becomes a live tournament, call this once with the
// submission id and the new tournament id — e.g. from a one-off node
// script run with DATABASE_URL set:
//
//   node -e "const db = require('./lib/db'); db.init().then(() =>
//     db.publishSubmissionReview(SUBMISSION_ID, TOURNAMENT_ID))
//     .then((r) => { console.log(r); process.exit(0); })"
//
// The rating is inserted through addReview(), the same insert path as a
// review submitted on a tournament page. The new review's id is recorded
// on the submission (rating_published_review_id), so calling this twice
// is safe: the second call returns null instead of double-publishing.
// Returns the created review, or null when the submission has no held
// rating or its rating was already published. Throws when the submission
// or the tournament does not exist.
async function publishSubmissionReview(submissionId, tournamentId) {
  let sub = null;
  if (pool) {
    const { rows } = await pool.query(
      "SELECT * FROM organizer_submissions WHERE id = $1",
      [submissionId]
    );
    if (!rows.length) {
      throw new Error(`No organizer submission with id ${submissionId}`);
    }
    sub = mapSubmission(rows[0]);
  } else {
    sub = mem.submissions.find((s) => s.id === submissionId) || null;
    if (!sub) {
      throw new Error(`No organizer submission with id ${submissionId}`);
    }
  }
  if (!sub.rating || sub.ratingPublishedReviewId != null) return null;
  const t = await getTournament(tournamentId);
  if (!t) throw new Error(`No tournament with id ${tournamentId}`);
  const review = await addReview(tournamentId, { ...sub.rating });
  if (pool) {
    await pool.query(
      "UPDATE organizer_submissions SET rating_published_review_id = $1 WHERE id = $2",
      [review.id, submissionId]
    );
  } else {
    const stored = mem.submissions.find((s) => s.id === submissionId);
    stored.ratingPublishedReviewId = review.id;
  }
  return review;
}

async function addSuggestion(data) {
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO suggestions (name, email, category, message)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [data.name, data.email, data.category, data.message]
    );
    return rows[0].id;
  }
  const id = mem.nextSuggestionId++;
  mem.suggestions.push({ id, ...data, createdAt: new Date().toISOString() });
  return id;
}

function mapSuggestion(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    category: row.category,
    message: row.message,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

function mapSubmission(row) {
  return {
    id: row.id,
    tournamentName: row.tournament_name,
    organizer: row.organizer,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    city: row.city,
    state: row.state,
    venue: row.venue,
    startDate: row.start_date,
    endDate: row.end_date,
    ageGroups: row.age_groups,
    levels: row.levels,
    gamesGuaranteed: row.games_guaranteed,
    entryFee: row.entry_fee,
    gateFee: row.gate_fee,
    stayToPlay: row.stay_to_play,
    scheduleReleaseDays: row.schedule_release_days,
    experienceTags: row.experience_tags,
    notes: row.notes,
    // Held rating (see publishSubmissionReview): null when the submitter
    // left the optional rating section blank.
    rating:
      row.rating_level != null
        ? {
            reviewerName: row.rating_reviewer_name,
            teamAgeGroup: row.rating_team_age_group,
            scores: {
              level: row.rating_level,
              organization: row.rating_organization,
              stayToPlay: row.rating_stay_to_play,
              facilities: row.rating_facilities,
              value: row.rating_value,
            },
            wouldReturn: row.rating_would_return,
            videoPolicy: row.rating_video_policy,
            vendors: row.rating_vendors,
            food: row.rating_food,
            extraNight: row.rating_extra_night,
            attendedYear: row.rating_attended_year,
            comment: row.rating_comment,
          }
        : null,
    ratingPublishedReviewId: row.rating_published_review_id ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

async function listSuggestions() {
  if (pool) {
    const { rows } = await pool.query(
      "SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 100"
    );
    return rows.map(mapSuggestion);
  }
  return mem.suggestions.slice().reverse();
}

async function listOrganizerSubmissions() {
  if (pool) {
    const { rows } = await pool.query(
      "SELECT * FROM organizer_submissions ORDER BY created_at DESC LIMIT 100"
    );
    return rows.map(mapSubmission);
  }
  return mem.submissions.slice().reverse();
}

async function recordPageView(section) {
  if (pool) {
    await pool.query(
      `INSERT INTO page_views (section, views) VALUES ($1, 1)
       ON CONFLICT (section) DO UPDATE SET views = page_views.views + 1`,
      [section]
    );
    return;
  }
  mem.pageViews[section] = (mem.pageViews[section] || 0) + 1;
}

async function getPageViews() {
  if (pool) {
    const { rows } = await pool.query("SELECT section, views FROM page_views");
    const out = {};
    for (const r of rows) out[r.section] = r.views;
    return out;
  }
  return { ...mem.pageViews };
}

async function countSubmissions() {
  if (pool) {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM organizer_submissions"
    );
    return rows[0].n;
  }
  return mem.submissions.length;
}

module.exports = {
  init,
  listTournaments,
  getTournament,
  listReviews,
  addReview,
  addOrganizerSubmission,
  publishSubmissionReview,
  addSuggestion,
  listSuggestions,
  listOrganizerSubmissions,
  recordPageView,
  getPageViews,
  countSubmissions,
  usingPostgres: usePostgres,
};
