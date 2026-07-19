// scripts/verify-library-qa-api.ts
//
// Read-only API smoke test — calls listActiveLibrarySessions +
// getActiveLibrarySessionDetail against the real dev database using a
// throw-away test user id, then asserts (1) the QA catalog is returned
// as expected and (2) no `audioKey` field ever leaks through the
// serializer.  Never mutates any row.
//
// Run:
//   npx tsx scripts/verify-library-qa-api.ts

import { prisma } from "../lib/prisma";
import {
  listActiveLibrarySessions,
  getActiveLibrarySessionDetail,
} from "../lib/entitlement/library-catalog";

function assert(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`[PASS] ${name}`);
  } else {
    console.log(`[FAIL] ${name}`, extra ?? "");
    process.exitCode = 1;
  }
}

function containsAudioKey(obj: unknown): boolean {
  if (obj === null || typeof obj !== "object") return false;
  if ("audioKey" in (obj as Record<string, unknown>)) return true;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (containsAudioKey(v)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  // Grab any real user id so plan lookup succeeds.  We do NOT create
  // one — if there is no user at all we skip the checks that require
  // auth and only assert the QA rows exist.
  const anyUser = await prisma.user.findFirst({ select: { id: true } });

  console.log("");
  if (!anyUser) {
    console.log(
      "No user exists in DB — skipping listActiveLibrarySessions call " +
        "(it requires an authenticated caller).  Falling back to a raw " +
        "DB check that only asserts the seeded rows exist."
    );
    const qa = await prisma.librarySession.count({
      where: { slug: { startsWith: "qa-" }, isActive: true },
    });
    assert("4 active QA LibrarySession rows exist", qa === 4, { qa });
    return;
  }

  const result = await listActiveLibrarySessions(anyUser.id);
  assert("listActiveLibrarySessions returns ok", result.ok === true, result);
  if (!result.ok) return;

  const qaSessions = result.sessions.filter((s) => s.slug.startsWith("qa-"));
  assert(
    "catalog contains 4 QA sessions",
    qaSessions.length === 4,
    qaSessions.map((s) => s.slug)
  );

  // Verify no field named `audioKey` anywhere in the response.
  assert(
    "catalog response contains no `audioKey` field",
    !containsAudioKey(result.sessions)
  );

  // Pick the multi-chapter session and verify detail.
  const multi = qaSessions.find((s) => s.slug === "qa-classic-asmr");
  assert("qa-classic-asmr is present in catalog", !!multi);
  if (!multi) return;

  assert(
    "qa-classic-asmr reports 3 chapters",
    multi.chapterCount === 3,
    multi.chapterCount
  );

  const detail = await getActiveLibrarySessionDetail(anyUser.id, multi.id);
  assert(
    "detail endpoint returns ok for qa-classic-asmr",
    detail.ok === true,
    detail
  );
  if (!detail.ok) return;

  assert(
    "detail returns exactly 3 chapters",
    detail.session.chapters.length === 3,
    detail.session.chapters.length
  );
  assert(
    "chapters ordered by partIndex asc",
    detail.session.chapters.every((c, i) => c.partIndex === i)
  );
  assert(
    "every chapter has protected audioUrl (no raw storage key)",
    detail.session.chapters.every((c) =>
      c.audioUrl.startsWith("/api/library/chapters/")
    )
  );
  assert(
    "detail response contains no `audioKey` field",
    !containsAudioKey(detail.session)
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
