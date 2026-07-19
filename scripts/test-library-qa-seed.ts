// scripts/test-library-qa-seed.ts
//
// Offline tests for the RP-004E1-QA curated Library seed
// (scripts/seed-library-qa.ts).  Nothing here touches Prisma or the
// database — the DB-integration path is exercised separately.
//
// The audio-copy tests DO drive the seed's `ensureQaAudioCopy` /
// `removeQaAudioCopy` helpers against a scratch sandbox directory
// (under the OS temp root) so the real repository is never mutated.
// The public source file inside the sandbox is a synthetic byte string
// created inside the sandbox — the real `public/audio/soundbeds/`
// asset is never touched, moved or removed.
//
// Run:
//   npx tsx scripts/test-library-qa-seed.ts

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  QA_AUDIO_KEY,
  QA_AUDIO_SOURCE_KEY,
  QA_AUDIO_FILENAME,
  QA_SLUG_PREFIX,
  QA_SESSIONS,
  QA_STORAGE_DIR,
  ensureQaAudioCopy,
  removeQaAudioCopy,
  qaAudioPaths,
} from "./seed-library-qa";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const equal =
    actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : actual === expected;
  if (equal) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.log(
      `[FAIL] ${name}\n       expected=${String(expected)}\n       actual=  ${String(actual)}`
    );
    failed++;
  }
}

function assert(name: string, cond: boolean): void {
  check(name, cond, true);
}

// ─── Catalog shape ────────────────────────────────────────────────────────

assert(
  "at least four QA sessions defined so 3/day limit + fourth-rejection can be exercised",
  QA_SESSIONS.length >= 4
);

const slugs = QA_SESSIONS.map((s) => s.slug);
assert(
  "all QA slugs use deterministic 'qa-' prefix (so cleanup filter is exact)",
  slugs.every((s) => s.startsWith(QA_SLUG_PREFIX))
);
assert("all QA slugs are unique", new Set(slugs).size === slugs.length);

// The QA seed must NOT collide with the three legacy Preset seed slugs
// (classic-asmr / sleep-story / meditation).  Those are Preset rows,
// not LibrarySession rows, but reusing the same identifiers would be
// confusing during manual QA — enforce a hard prefix separation.
const legacyPresetSlugs = new Set(["classic-asmr", "sleep-story", "meditation"]);
assert(
  "no QA slug collides with a non-QA Preset slug",
  slugs.every((s) => !legacyPresetSlugs.has(s))
);

// ─── At least one session with multiple ordered chapters ─────────────────

const multiChapter = QA_SESSIONS.filter((s) => s.chapters.length >= 2);
assert(
  "at least one QA session has >=2 chapters (chapter-transition test coverage)",
  multiChapter.length >= 1
);

for (const s of QA_SESSIONS) {
  // partIndex must start at 0 and be strictly increasing so the composite
  // unique (librarySessionId, partIndex) never collides on second-run
  // upserts and the player's ordering matches insertion order.
  const partIndexes = s.chapters.map((c) => c.partIndex);
  const uniqueIndexes = new Set(partIndexes);
  assert(
    `session ${s.slug}: partIndex values are unique`,
    uniqueIndexes.size === partIndexes.length
  );
  const sorted = [...partIndexes].sort((a, b) => a - b);
  assert(
    `session ${s.slug}: partIndex sequence is [0..N)`,
    sorted.every((v, i) => v === i)
  );
  assert(
    `session ${s.slug}: has at least one chapter`,
    s.chapters.length >= 1
  );
  assert(
    `session ${s.slug}: isActive semantic → we set true in seed (durationSeconds present)`,
    typeof s.durationSeconds === "number" && s.durationSeconds > 0
  );
}

// ─── Preset coverage across the four SoftVibe pillars ────────────────────

const presets = new Set(QA_SESSIONS.map((s) => s.preset));
for (const expected of ["sleep-story", "meditation", "kids-story", "classic-asmr"]) {
  assert(`QA catalog covers preset '${expected}'`, presets.has(expected));
}

// ─── Audio key safety ────────────────────────────────────────────────────

assert(
  "QA audio key is a non-empty string",
  typeof QA_AUDIO_KEY === "string" && QA_AUDIO_KEY.length > 0
);
assert(
  "QA audio key has no '..' path-traversal segment",
  !QA_AUDIO_KEY.includes("..")
);
assert(
  "QA audio key has no leading slash (not an absolute path)",
  !QA_AUDIO_KEY.startsWith("/")
);
assert(
  "QA audio key does NOT begin with 'public/' (would be publicly served)",
  !QA_AUDIO_KEY.startsWith("public/") &&
    !QA_AUDIO_KEY.startsWith("./public/") &&
    !QA_AUDIO_KEY.startsWith("public\\")
);
assert(
  "QA audio key is NOT a URL (no scheme://)",
  !/^[a-z][a-z0-9+.-]*:\/\//i.test(QA_AUDIO_KEY)
);
assert(
  "QA audio key lives inside the private QA storage root",
  QA_AUDIO_KEY.startsWith(`${QA_STORAGE_DIR}/`)
);
assert(
  "QA audio source key remains the committed public soundbed",
  QA_AUDIO_SOURCE_KEY === "public/audio/soundbeds/rain_soft_diffuse.mp3"
);
assert(
  "QA audio filename matches the seeded audio key basename",
  path.basename(QA_AUDIO_KEY) === QA_AUDIO_FILENAME
);

const publicSourceAbs = path.join(process.cwd(), QA_AUDIO_SOURCE_KEY);
assert(
  "Public source asset exists on disk (repo-owned, unchanged by seed)",
  fs.existsSync(publicSourceAbs)
);

// ─── Protected-route resolution shape (source-level check) ───────────────

// The route joins audioKey with process.cwd() when S3 is not configured
// (see app/api/library/chapters/[id]/audio/route.ts).  Verify that the
// resolved absolute path stays under the private QA storage root — a
// positive assertion that the audioKey lands where we intend it to.
{
  const cwd = process.cwd();
  const { destAbs, destDirAbs } = qaAudioPaths(cwd);
  const routeResolved = path.join(cwd, QA_AUDIO_KEY.replace(/^\/+/, ""));
  assert(
    "Protected route resolution matches ensureQaAudioCopy destination",
    routeResolved === destAbs
  );
  const relFromRoot = path.relative(destDirAbs, routeResolved);
  assert(
    "Protected route resolution stays inside the private QA storage root",
    !relFromRoot.startsWith("..") && !path.isAbsolute(relFromRoot)
  );

  // Read the route source once to confirm the safety features we depend
  // on (traversal reject + no leading slash + cwd-relative join) are
  // still present.  Any regression here would silently re-open the
  // route to relative-escape audioKeys.
  const routePath = path.resolve(
    __dirname,
    "..",
    "app",
    "api",
    "library",
    "chapters",
    "[id]",
    "audio",
    "route.ts"
  );
  const routeSrc = fs.readFileSync(routePath, "utf8");
  assert(
    "Route source: still rejects audioKeys containing '..'",
    /includes\(["']\.\.["']\)/.test(routeSrc)
  );
  assert(
    "Route source: still resolves audioKey relative to process.cwd()",
    routeSrc.includes("process.cwd()")
  );
  assert(
    "Route source: still strips leading slashes before joining",
    /replace\(\s*\/\^\\?\/\+\/\s*,\s*["']["']\s*\)/.test(routeSrc)
  );
}

// ─── Idempotent private-copy flow (sandboxed) ────────────────────────────

// Drive ensureQaAudioCopy against a scratch dir so the real repo tree
// is not disturbed.  We manually stage a synthetic "source" file
// inside the sandbox that mirrors the public/audio/soundbeds/ layout.
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sv-qa-seed-"));
  try {
    const syntheticSourceAbs = path.join(sandbox, QA_AUDIO_SOURCE_KEY);
    fs.mkdirSync(path.dirname(syntheticSourceAbs), { recursive: true });
    const originalBytes = Buffer.from("softvibe-qa-source-bytes");
    fs.writeFileSync(syntheticSourceAbs, originalBytes);

    const { destAbs, destDirAbs } = qaAudioPaths(sandbox);

    // Initial copy: destination does not yet exist.
    assert(
      "Sandbox: private QA copy absent before first ensure",
      !fs.existsSync(destAbs)
    );
    const first = ensureQaAudioCopy(sandbox);
    assert(
      "Sandbox: first ensure creates the private QA copy",
      first.action === "created"
    );
    assert(
      "Sandbox: private QA file exists after first ensure",
      fs.existsSync(destAbs)
    );
    assert(
      "Sandbox: private QA directory exists after first ensure",
      fs.existsSync(destDirAbs) && fs.statSync(destDirAbs).isDirectory()
    );
    assert(
      "Sandbox: public source file still exists after ensure",
      fs.existsSync(syntheticSourceAbs)
    );
    assert(
      "Sandbox: private QA copy matches the source bytes",
      Buffer.compare(fs.readFileSync(destAbs), originalBytes) === 0
    );

    // Idempotency: second ensure reuses (same size, no rewrite).
    const second = ensureQaAudioCopy(sandbox);
    assert(
      "Sandbox: repeated ensure is idempotent (reuse)",
      second.action === "reused"
    );
    assert(
      "Sandbox: private QA file still present after second ensure",
      fs.existsSync(destAbs)
    );

    // Cleanup: removes only the private QA copy + empty dir.
    const cleanup1 = removeQaAudioCopy(sandbox);
    assert(
      "Sandbox: cleanup reports fileRemoved=true on first call",
      cleanup1.fileRemoved === true
    );
    assert(
      "Sandbox: cleanup reports dirRemoved=true when dir is empty",
      cleanup1.dirRemoved === true
    );
    assert(
      "Sandbox: private QA file gone after cleanup",
      !fs.existsSync(destAbs)
    );
    assert(
      "Sandbox: private QA directory gone after cleanup",
      !fs.existsSync(destDirAbs)
    );

    // Public source must survive cleanup — this is the entire point.
    assert(
      "Sandbox: PUBLIC source file untouched by cleanup",
      fs.existsSync(syntheticSourceAbs)
    );
    assert(
      "Sandbox: PUBLIC source bytes untouched by cleanup",
      Buffer.compare(fs.readFileSync(syntheticSourceAbs), originalBytes) === 0
    );

    // Cleanup is idempotent — second call is a no-op.
    const cleanup2 = removeQaAudioCopy(sandbox);
    assert(
      "Sandbox: cleanup is idempotent (second call → no removal)",
      cleanup2.fileRemoved === false && cleanup2.dirRemoved === false
    );

    // Repeated seed after cleanup recreates the copy safely.
    const third = ensureQaAudioCopy(sandbox);
    assert(
      "Sandbox: re-seed after cleanup recreates the private QA copy",
      third.action === "created" && fs.existsSync(destAbs)
    );

    // Cleanup with foreign file present: dir NOT removed (safety).
    fs.writeFileSync(path.join(destDirAbs, "not-a-qa-file.txt"), "hello");
    const cleanup3 = removeQaAudioCopy(sandbox);
    assert(
      "Sandbox: cleanup removes private QA copy even with unrelated sibling",
      cleanup3.fileRemoved === true
    );
    assert(
      "Sandbox: cleanup leaves private QA dir when unrelated sibling remains",
      cleanup3.dirRemoved === false && fs.existsSync(destDirAbs)
    );
    assert(
      "Sandbox: unrelated sibling file preserved by cleanup",
      fs.existsSync(path.join(destDirAbs, "not-a-qa-file.txt"))
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ─── Cleanup filter behaviour (pure predicate) ───────────────────────────

// This mirrors the SQL predicate `slug startsWith 'qa-'`.  We check that
// realistic non-QA slugs are preserved and every QA slug is targeted.
const nonQaSampleSlugs = [
  "classic-asmr",
  "sleep-story",
  "meditation",
  "editorial-forest-walk",
  "curated-2026-launch",
];
for (const slug of nonQaSampleSlugs) {
  assert(
    `cleanup preserves non-QA slug '${slug}'`,
    !slug.startsWith(QA_SLUG_PREFIX)
  );
}
for (const slug of slugs) {
  assert(
    `cleanup targets QA slug '${slug}'`,
    slug.startsWith(QA_SLUG_PREFIX)
  );
}

// ─── Description marks rows clearly as QA ────────────────────────────────

for (const s of QA_SESSIONS) {
  assert(
    `session ${s.slug}: description marks the row as an internal QA seed`,
    typeof s.description === "string" && /Test-Session/i.test(s.description)
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log("");
console.log(`Total: ${passed + failed}, passed: ${passed}, failed: ${failed}`);
if (failed > 0) process.exit(1);
