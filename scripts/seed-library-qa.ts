// scripts/seed-library-qa.ts
//
// RP-004E1-QA — Curated Library Development / QA Seed
//
// Guarded, idempotent development-only utility that inserts a small
// curated Library catalog into the currently connected database so the
// full RP-004E1 browser flow can be exercised end-to-end (catalog
// rendering, paid direct playback, Free locked state, simulated
// Sponsored Unlock, active-unlock replay, three-per-day limit and
// chapter transitions).
//
// This script is NEVER run as part of the ordinary Prisma seed, npm
// postinstall or any deployment path. It refuses to run unless BOTH:
//
//   * env ALLOW_QA_LIBRARY_SEED=true                — explicit opt-in
//   * a `--yes` flag OR an interactive TTY confirm  — explicit intent
//
// The script writes only into LibrarySession + LibrarySessionChapter
// rows whose slugs start with the deterministic "qa-" prefix.  It
// does NOT touch Users, Jobs, Tracks, Playlists, non-QA LibrarySession
// rows, Stripe, PeriodUsage or any generation service.
//
// Chapter audio points at a private QA copy of a single repo-owned
// soundbed asset:
//
//   source (kept committed, still publicly served for its original
//   product purpose):   public/audio/soundbeds/rain_soft_diffuse.mp3
//
//   destination (runtime-generated, gitignored, only reachable through
//   the protected route):   .storage/qa-library/rain_soft_diffuse.mp3
//
// The QA catalog rows must not reference the public path directly:
// files under Next.js `public/` are automatically served by the static
// asset handler, so the same underlying bytes would be reachable at
// `/audio/soundbeds/rain_soft_diffuse.mp3` without hitting the
// authorization pipeline. That would defeat the point of the protected
// chapter audio route.
//
// Instead the seed copies the source into a private local storage root
// (`.storage/qa-library/`) whose contents are NOT under `public/` and
// therefore NOT reachable through any static path.  The protected
// chapter audio route (app/api/library/chapters/[id]/audio) already
// resolves audioKey relative to process.cwd() when S3 is not
// configured, and the private path resolves inside the repo root, so
// browser playback still works — but only through the authorized
// endpoint that enforces plan + active-unlock + chapter/session
// binding.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { prisma } from "../lib/prisma";

// ─── QA catalog definition (deterministic slugs) ─────────────────────────

/**
 * Repo-owned public source asset copied into private QA storage by the
 * seed.  This path lives under `public/` because the file has an
 * unrelated product purpose (as a soundbed available to the app's
 * own audio pipeline).  The seed never inserts this path directly as
 * an audioKey — see QA_AUDIO_KEY below.
 */
export const QA_AUDIO_SOURCE_KEY =
  "public/audio/soundbeds/rain_soft_diffuse.mp3";

/**
 * Private, gitignored local storage root where the QA seed places its
 * copy of the source asset.  Chosen to be narrow (a single
 * qa-library subfolder) so the `.gitignore` entry does not swallow
 * unrelated files, and so cleanup can safely remove just this
 * directory without affecting other local-only artefacts.
 *
 * Deliberately outside of `public/` so Next.js cannot serve it as a
 * static asset — the browser can only reach these bytes through the
 * protected `/api/library/chapters/[id]/audio` route.
 */
export const QA_STORAGE_DIR = ".storage/qa-library";

/**
 * Filename used inside QA_STORAGE_DIR.  Kept identical to the source
 * asset's basename so operator-level inspection makes the provenance
 * obvious.
 */
export const QA_AUDIO_FILENAME = "rain_soft_diffuse.mp3";

/**
 * Repo-relative audioKey referenced by every seeded LibrarySessionChapter
 * row.  MUST be:
 *   • not prefixed with `public/` (would be publicly reachable)
 *   • not an absolute path
 *   • free of `..` segments
 *   • not a URL
 * The protected chapter audio route joins this against process.cwd()
 * when S3 is not configured, matching how existing job / track local
 * fallbacks resolve their files.
 */
export const QA_AUDIO_KEY = `${QA_STORAGE_DIR}/${QA_AUDIO_FILENAME}`;

/**
 * The deterministic slug prefix.  Cleanup targets exactly rows whose
 * slug begins with this prefix, so non-QA catalog content can never be
 * touched even if this list changes in the future.
 */
export const QA_SLUG_PREFIX = "qa-";

export type QaChapter = {
  partIndex: number;
  title: string;
  durationSeconds: number;
};

export type QaSession = {
  slug: string;
  title: string;
  description: string;
  preset: string;
  durationSeconds: number;
  chapters: QaChapter[];
};

/**
 * Four sessions so the three-per-day Free limit and the fourth-session
 * rejection can be exercised.  One session (`qa-classic-asmr`) carries
 * three ordered chapters so the global player's chapter-transition
 * logic can be verified.
 */
export const QA_SESSIONS: QaSession[] = [
  {
    slug: "qa-sleep-story",
    title: "Sleep Story QA Session",
    description:
      "Interne Test-Session (RP-004E1-QA). Nicht Teil des finalen SoftVibe-Katalogs.",
    preset: "sleep-story",
    durationSeconds: 600,
    chapters: [
      { partIndex: 0, title: "QA-Kapitel 1", durationSeconds: 600 },
    ],
  },
  {
    slug: "qa-meditation",
    title: "Meditation QA Session",
    description:
      "Interne Test-Session (RP-004E1-QA). Nicht Teil des finalen SoftVibe-Katalogs.",
    preset: "meditation",
    durationSeconds: 300,
    chapters: [
      { partIndex: 0, title: "QA-Kapitel 1", durationSeconds: 300 },
    ],
  },
  {
    slug: "qa-kids-story",
    title: "Kids Story QA Session",
    description:
      "Interne Test-Session (RP-004E1-QA). Nicht Teil des finalen SoftVibe-Katalogs.",
    preset: "kids-story",
    durationSeconds: 240,
    chapters: [
      { partIndex: 0, title: "QA-Kapitel 1", durationSeconds: 240 },
    ],
  },
  {
    slug: "qa-classic-asmr",
    title: "Classic ASMR QA Session",
    description:
      "Interne Test-Session (RP-004E1-QA) mit mehreren Kapiteln für Übergangs-Tests. Nicht Teil des finalen SoftVibe-Katalogs.",
    preset: "classic-asmr",
    durationSeconds: 360,
    chapters: [
      { partIndex: 0, title: "QA-Kapitel 1", durationSeconds: 120 },
      { partIndex: 1, title: "QA-Kapitel 2", durationSeconds: 120 },
      { partIndex: 2, title: "QA-Kapitel 3", durationSeconds: 120 },
    ],
  },
];

// ─── Private QA audio copy (idempotent, local-only) ──────────────────────

/**
 * Compute the absolute source + destination paths for the private QA
 * audio copy against the given repository root.  Exposed so tests can
 * drive the copy against a scratch directory without touching the real
 * repository layout.  The default root is `process.cwd()`, matching how
 * the protected chapter audio route resolves local audioKeys.
 */
export function qaAudioPaths(cwd: string = process.cwd()): {
  sourceAbs: string;
  destDirAbs: string;
  destAbs: string;
} {
  const sourceAbs = path.join(cwd, QA_AUDIO_SOURCE_KEY);
  const destDirAbs = path.join(cwd, QA_STORAGE_DIR);
  const destAbs = path.join(destDirAbs, QA_AUDIO_FILENAME);
  return { sourceAbs, destDirAbs, destAbs };
}

/**
 * Copy the repo-owned source asset into the private QA storage
 * directory.  Idempotent: if the destination already exists AND has
 * the same byte length as the source, the copy is skipped so repeated
 * seeds do not needlessly re-write the file.
 *
 * Never makes an external call, never touches non-QA files, never
 * modifies the source file.  Returns "created", "refreshed" or
 * "reused" so the operator sees what happened.
 */
export function ensureQaAudioCopy(cwd: string = process.cwd()):
  | { action: "created" | "refreshed" | "reused"; destAbs: string }
{
  const { sourceAbs, destDirAbs, destAbs } = qaAudioPaths(cwd);

  const srcStat = fs.statSync(sourceAbs);

  if (!fs.existsSync(destDirAbs)) {
    fs.mkdirSync(destDirAbs, { recursive: true });
  }

  if (fs.existsSync(destAbs)) {
    const destStat = fs.statSync(destAbs);
    if (destStat.size === srcStat.size) {
      return { action: "reused", destAbs };
    }
    // Same filename but different size — refresh from the source so the
    // seed's audioKey always points at the canonical bytes.
    fs.copyFileSync(sourceAbs, destAbs);
    return { action: "refreshed", destAbs };
  }

  fs.copyFileSync(sourceAbs, destAbs);
  return { action: "created", destAbs };
}

/**
 * Remove the private QA audio copy, and (best-effort) the QA storage
 * directory if it is now empty.  NEVER touches the public source file
 * or anything outside QA_STORAGE_DIR.  Safe to call repeatedly.
 */
export function removeQaAudioCopy(cwd: string = process.cwd()):
  | { fileRemoved: boolean; dirRemoved: boolean }
{
  const { destDirAbs, destAbs } = qaAudioPaths(cwd);

  let fileRemoved = false;
  if (fs.existsSync(destAbs)) {
    fs.rmSync(destAbs, { force: true });
    fileRemoved = true;
  }

  let dirRemoved = false;
  if (fs.existsSync(destDirAbs)) {
    const remaining = fs.readdirSync(destDirAbs);
    if (remaining.length === 0) {
      fs.rmdirSync(destDirAbs);
      dirRemoved = true;
    }
  }

  return { fileRemoved, dirRemoved };
}

// ─── Guards + safety plumbing ────────────────────────────────────────────

/**
 * Return the connected database host with any credentials scrubbed, so
 * the operator can visually confirm they are pointed at the intended
 * development database before writing.  Returns "<unknown>" if the URL
 * cannot be parsed — refusing to log the raw value.
 */
function redactedDatabaseHost(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "<no DATABASE_URL>";
  try {
    const u = new URL(raw);
    const db = u.pathname.replace(/^\//, "");
    return `${u.hostname}${db ? "/" + db : ""}`;
  } catch {
    return "<unparseable>";
  }
}

function isYesFlag(argv: string[]): boolean {
  return argv.includes("--yes") || argv.includes("-y");
}

function parseMode(argv: string[]): "seed" | "cleanup" {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const first = positional[0];
  if (first === "cleanup") return "cleanup";
  return "seed";
}

async function interactiveConfirm(mode: "seed" | "cleanup"): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      "Refusing to run: no --yes flag and stdin is not a TTY. " +
        "Pass --yes to acknowledge writing to the currently connected database."
    );
    return false;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return await new Promise<boolean>((resolve) => {
    rl.question(
      `Proceed with QA library ${mode} against the shown database? (yes/no) `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "yes");
      }
    );
  });
}

/**
 * Refuse to run unless every guard is satisfied.  Any failure prints a
 * clear reason and returns false so the caller exits non-zero.
 */
async function checkGuards(
  mode: "seed" | "cleanup",
  argv: string[]
): Promise<boolean> {
  const host = redactedDatabaseHost();
  console.log("");
  console.log("═════════════════════════════════════════════════════════════");
  console.log(" SoftVibe QA Library Seed  —  DEVELOPMENT-ONLY");
  console.log("═════════════════════════════════════════════════════════════");
  console.log(` Mode         : ${mode}`);
  console.log(` Database     : ${host}`);
  console.log(` NODE_ENV     : ${process.env.NODE_ENV ?? "<unset>"}`);
  console.log(` Source asset : ${QA_AUDIO_SOURCE_KEY}`);
  console.log(` Private copy : ${QA_AUDIO_KEY}`);
  console.log("─────────────────────────────────────────────────────────────");
  console.log(" This command MODIFIES the connected database.");
  console.log(" It writes rows only for slugs prefixed with 'qa-'.");
  console.log("─────────────────────────────────────────────────────────────");

  if (process.env.ALLOW_QA_LIBRARY_SEED !== "true") {
    console.error(
      "Refused: ALLOW_QA_LIBRARY_SEED is not set to 'true'. " +
        "This guard is required to prevent accidental catalog writes."
    );
    return false;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refused: NODE_ENV=production is set. The QA seed is development-only."
    );
    return false;
  }

  const sourceAbs = path.join(process.cwd(), QA_AUDIO_SOURCE_KEY);
  if (!fs.existsSync(sourceAbs)) {
    console.error(
      `Refused: repo-owned QA audio source asset not found at ${sourceAbs}. ` +
        "The seed cannot prepare the private QA copy without it."
    );
    return false;
  }

  if (isYesFlag(argv)) {
    console.log(" Confirmed via --yes flag.");
    return true;
  }

  return await interactiveConfirm(mode);
}

// ─── Seed / cleanup ──────────────────────────────────────────────────────

type SeedReport = {
  mode: "seed";
  sessions: Array<{
    slug: string;
    id: string;
    chapterCount: number;
    action: "created" | "updated";
  }>;
  audioKey: string;
  audioCopyAction: "created" | "refreshed" | "reused";
  audioReuseNote: string;
};

type CleanupReport = {
  mode: "cleanup";
  removedSlugs: string[];
  removedChapterCount: number;
  preservedNonQaCount: number;
  privateAudioFileRemoved: boolean;
  privateAudioDirRemoved: boolean;
};

async function runSeed(): Promise<SeedReport> {
  // Prepare the private QA audio copy BEFORE writing any database rows,
  // so a filesystem failure aborts the seed without leaving DB rows that
  // reference an unreachable audioKey.
  const copy = ensureQaAudioCopy();

  const report: SeedReport = {
    mode: "seed",
    sessions: [],
    audioKey: QA_AUDIO_KEY,
    audioCopyAction: copy.action,
    audioReuseNote:
      "No user-owned Track rows referenced. Chapters point at the " +
      "private QA copy under .storage/qa-library/, which is NOT served " +
      "by Next.js static asset handling and can only be reached through " +
      "the protected /api/library/chapters/[id]/audio route. Cleanup " +
      "removes only LibrarySession and LibrarySessionChapter rows with " +
      "slug prefix 'qa-' plus the private QA copy — the public source " +
      "asset is never touched.",
  };

  for (const s of QA_SESSIONS) {
    const existing = await prisma.librarySession.findUnique({
      where: { slug: s.slug },
      select: { id: true },
    });

    const session = await prisma.librarySession.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        title: s.title,
        description: s.description,
        preset: s.preset,
        durationSeconds: s.durationSeconds,
        isActive: true,
      },
      update: {
        title: s.title,
        description: s.description,
        preset: s.preset,
        durationSeconds: s.durationSeconds,
        isActive: true,
      },
      select: { id: true },
    });

    for (const c of s.chapters) {
      await prisma.librarySessionChapter.upsert({
        where: {
          librarySessionId_partIndex: {
            librarySessionId: session.id,
            partIndex: c.partIndex,
          },
        },
        create: {
          librarySessionId: session.id,
          partIndex: c.partIndex,
          title: c.title,
          audioKey: QA_AUDIO_KEY,
          durationSeconds: c.durationSeconds,
        },
        update: {
          title: c.title,
          audioKey: QA_AUDIO_KEY,
          durationSeconds: c.durationSeconds,
        },
      });
    }

    report.sessions.push({
      slug: s.slug,
      id: session.id,
      chapterCount: s.chapters.length,
      action: existing ? "updated" : "created",
    });
  }

  return report;
}

async function runCleanup(): Promise<CleanupReport> {
  // Fetch identifiers before deletion so we can report exactly what was
  // removed AND separately count non-QA rows to confirm they were left
  // untouched.  Chapter/unlock rows cascade via the schema relations.
  const qaSessions = await prisma.librarySession.findMany({
    where: { slug: { startsWith: QA_SLUG_PREFIX } },
    select: {
      id: true,
      slug: true,
      _count: { select: { chapters: true } },
    },
  });

  const removedSlugs = qaSessions.map((s) => s.slug).sort();
  const removedChapterCount = qaSessions.reduce(
    (n, s) => n + s._count.chapters,
    0
  );

  const preservedNonQaCount = await prisma.librarySession.count({
    where: { slug: { not: { startsWith: QA_SLUG_PREFIX } } },
  });

  if (qaSessions.length > 0) {
    await prisma.librarySession.deleteMany({
      where: { slug: { startsWith: QA_SLUG_PREFIX } },
    });
  }

  // Best-effort removal of the private QA audio copy AFTER the DB rows
  // that referenced it are gone.  Never touches the public source
  // asset.  Safe to call on a system that never ran the seed.
  const { fileRemoved, dirRemoved } = removeQaAudioCopy();

  return {
    mode: "cleanup",
    removedSlugs,
    removedChapterCount,
    preservedNonQaCount,
    privateAudioFileRemoved: fileRemoved,
    privateAudioDirRemoved: dirRemoved,
  };
}

// ─── Entrypoint ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);

  const ok = await checkGuards(mode, argv);
  if (!ok) {
    console.log("Aborted. No changes were written.");
    process.exit(1);
  }

  if (mode === "seed") {
    const report = await runSeed();
    console.log("");
    console.log("QA library seed complete.");
    console.log(` Audio key referenced: ${report.audioKey}`);
    console.log(` Private audio copy : ${report.audioCopyAction}`);
    console.log(` ${report.audioReuseNote}`);
    console.log(" Sessions:");
    for (const s of report.sessions) {
      console.log(
        `  • ${s.slug}  id=${s.id}  chapters=${s.chapterCount}  (${s.action})`
      );
    }
    console.log("");
    return;
  }

  const report = await runCleanup();
  console.log("");
  console.log("QA library cleanup complete.");
  if (report.removedSlugs.length === 0) {
    console.log(" Nothing to remove — no rows with prefix 'qa-' were present.");
  } else {
    console.log(
      ` Removed ${report.removedSlugs.length} session(s) ` +
        `(${report.removedChapterCount} chapter(s) cascaded):`
    );
    for (const slug of report.removedSlugs) console.log(`  • ${slug}`);
  }
  console.log(
    ` Non-QA LibrarySession rows preserved: ${report.preservedNonQaCount}`
  );
  console.log(
    ` Private QA audio file removed: ${report.privateAudioFileRemoved}`
  );
  console.log(
    ` Private QA storage dir removed: ${report.privateAudioDirRemoved}`
  );
  console.log(
    ` Public source asset (${QA_AUDIO_SOURCE_KEY}) is never touched by cleanup.`
  );
  console.log("");
}

// Only run when executed directly (npm run seed:library:qa …).  When the
// module is imported by a test harness, main() must not fire.
const entrypoint = process.argv[1] ?? "";
if (entrypoint.endsWith("seed-library-qa.ts")) {
  main()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("QA library seed failed:", err);
      return prisma.$disconnect().finally(() => process.exit(1));
    });
}

export { runSeed, runCleanup, redactedDatabaseHost };
