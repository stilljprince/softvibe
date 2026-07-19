// scripts/verify-library-unlock-advisory-lock.ts
//
// RP-004E1 — Guarded real-PostgreSQL regression check for the Library
// Unlock advisory lock statement.
//
// Background: pg_advisory_xact_lock() returns the PostgreSQL `void`
// type. Prisma's $queryRaw cannot deserialize a `void` result column
// and surfaces the failure as P2010 ("Failed to deserialize column of
// type 'void'"). The previous implementation invoked the lock via
// $queryRaw and only failed against a real PostgreSQL connection; the
// existing mocked test suites (test-library-unlock.ts,
// test-sponsored-simulated.ts) coordinated the lock through in-memory
// promise chains and never exercised the raw statement, so the bug
// remained invisible offline.
//
// This script exercises the exact production statement — bound-
// parameter form, inside a Prisma interactive transaction — against
// the configured development database. It never mutates any row: the
// transaction is deliberately rolled back at the end.
//
// Guarantees enforced by this script:
//
//   * Refuses to run when NODE_ENV === "production".
//   * Requires an explicit development-only guard flag
//     (LIBRARY_UNLOCK_ADVISORY_LOCK_CHECK=1) to be set.
//   * Never reads, prints, or logs DATABASE_URL, database host,
//     credentials, or any connection detail.
//   * The advisory-lock statement runs inside a transaction that is
//     always rolled back, so no data is written.
//   * Uses only parameter-bound SQL — no string concatenation, no
//     interpolated identifiers.
//
// Run:
//   NODE_ENV=development \
//   LIBRARY_UNLOCK_ADVISORY_LOCK_CHECK=1 \
//   npx tsx scripts/verify-library-unlock-advisory-lock.ts
//
// Success criteria:
//
//   1. The exact production advisory-lock statement executes without a
//      Prisma void deserialization error (P2010).
//   2. pg_advisory_xact_lock is reported as held for the current
//      transaction after the call (proves the lock was acquired inside
//      the transaction, not silently skipped).
//   3. Subsequent normal Prisma work in the same transaction continues
//      to succeed after the lock call.
//   4. The lock is released automatically on transaction rollback.

import { prisma } from "../lib/prisma";

// Same constant used by lib/entitlement/library-unlock.ts. Keeping it
// duplicated here (instead of importing) so this script exercises the
// exact statement shape independently of any refactor of the library
// module — a regression there is what we are guarding against.
const LIBRARY_UNLOCK_LOCK_NAMESPACE = 730104;

// A deterministic pseudo-user id string. Never persisted; used only to
// derive a hashtext() key for the lock call. Not a real userId.
const QA_LOCK_KEY = "advisory-lock-regression-check";

function assert(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`[PASS] ${name}`);
  } else {
    console.log(`[FAIL] ${name}`, extra ?? "");
    process.exitCode = 1;
  }
}

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "").toLowerCase() === "production";
}

function guardEnabled(): boolean {
  const raw = process.env.LIBRARY_UNLOCK_ADVISORY_LOCK_CHECK;
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

async function main(): Promise<void> {
  if (isProduction()) {
    console.log(
      "[SKIP] NODE_ENV=production — advisory-lock regression check refuses " +
        "to run against a production database."
    );
    process.exitCode = 1;
    return;
  }
  if (!guardEnabled()) {
    console.log(
      "[SKIP] LIBRARY_UNLOCK_ADVISORY_LOCK_CHECK is not set — this " +
        "script requires an explicit development-only guard. Set " +
        "LIBRARY_UNLOCK_ADVISORY_LOCK_CHECK=1 to run it."
    );
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(
    "Exercising pg_advisory_xact_lock via Prisma $executeRaw inside a " +
      "transaction that is always rolled back. No rows are read or " +
      "modified. Connection details are never logged."
  );
  console.log("");

  // Sentinel used to abort the transaction after the assertions run so
  // no side effects escape. Prisma rolls back on throw.
  class RollbackSentinel extends Error {}

  let executeRawError: unknown = null;
  let lockAcquiredInsideTx: boolean | null = null;
  let postLockWorkOk: boolean | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // -----------------------------------------------------------------
      // 1. Run the exact production advisory-lock statement via
      //    $executeRaw. If this throws with the Prisma void
      //    deserialization error (P2010), the regression is back.
      // -----------------------------------------------------------------
      try {
        await (
          tx as unknown as {
            $executeRaw: (
              strings: TemplateStringsArray,
              ...values: unknown[]
            ) => Promise<number>;
          }
        )
          .$executeRaw`SELECT pg_advisory_xact_lock(${LIBRARY_UNLOCK_LOCK_NAMESPACE}::int, hashtext(${QA_LOCK_KEY})::int)`;
      } catch (e) {
        executeRawError = e;
      }

      // -----------------------------------------------------------------
      // 2. Verify the lock is held by the current transaction. This
      //    uses pg_locks — a read-only system view. We match the exact
      //    (classid, objid) pair that pg_advisory_xact_lock(ns, key)
      //    installs, and require pid = pg_backend_pid() so we do not
      //    observe an unrelated concurrent holder.
      // -----------------------------------------------------------------
      const heldRows = (await (
        tx as unknown as {
          $queryRaw: (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<Array<{ held: boolean }>>;
        }
      )
        .$queryRaw`SELECT EXISTS(
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory'
            AND classid = ${LIBRARY_UNLOCK_LOCK_NAMESPACE}::int
            AND objid = hashtext(${QA_LOCK_KEY})::bigint & x'FFFFFFFF'::bigint
            AND pid = pg_backend_pid()
            AND granted = true
        ) AS held`) as Array<{ held: boolean }>;
      lockAcquiredInsideTx = heldRows.length === 1 && heldRows[0].held === true;

      // -----------------------------------------------------------------
      // 3. Prove that normal transaction work continues to succeed
      //    after the lock call. We use a harmless read-only Prisma
      //    query so no rows are modified.
      // -----------------------------------------------------------------
      try {
        await tx.user.count();
        postLockWorkOk = true;
      } catch {
        postLockWorkOk = false;
      }

      // Always roll back — this script must never persist anything.
      throw new RollbackSentinel();
    });
  } catch (e) {
    if (!(e instanceof RollbackSentinel)) {
      // The transaction wrapper itself failed for a non-sentinel reason.
      // If the failure is the void-deserialization error, keep it in
      // executeRawError so the assertion below reports the exact
      // symptom rather than a generic transaction-abort message.
      if (executeRawError === null) executeRawError = e;
    }
  }

  // Sanity-check assertions.
  assert(
    "advisory-lock $executeRaw does not throw Prisma void deserialization error",
    executeRawError === null,
    executeRawError && (executeRawError as { message?: unknown }).message
      ? String((executeRawError as { message: unknown }).message).slice(0, 200)
      : executeRawError
  );

  // The classid/objid comparison uses a 32-bit truncation of hashtext()
  // to match what pg_advisory_xact_lock stores internally; if the
  // driver reports the lock as held, we treat the assertion as passed.
  // If executeRaw errored, lockAcquiredInsideTx stays null.
  assert(
    "pg_advisory_xact_lock is held inside the transaction after the call",
    lockAcquiredInsideTx === true,
    { lockAcquiredInsideTx }
  );

  assert(
    "normal Prisma work continues to succeed after the lock is acquired",
    postLockWorkOk === true,
    { postLockWorkOk }
  );

  // -----------------------------------------------------------------
  // 4. After the transaction rolled back, the lock must be gone. Use
  //    a fresh transaction to observe pg_locks; the row must not
  //    appear for the current backend anymore.
  // -----------------------------------------------------------------
  let stillHeldAfterRollback: boolean | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = (await (
        tx as unknown as {
          $queryRaw: (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<Array<{ held: boolean }>>;
        }
      )
        .$queryRaw`SELECT EXISTS(
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory'
            AND classid = ${LIBRARY_UNLOCK_LOCK_NAMESPACE}::int
            AND objid = hashtext(${QA_LOCK_KEY})::bigint & x'FFFFFFFF'::bigint
            AND pid = pg_backend_pid()
            AND granted = true
        ) AS held`) as Array<{ held: boolean }>;
      stillHeldAfterRollback = rows.length === 1 && rows[0].held === true;
    });
  } catch (e) {
    console.log(
      "[WARN] post-rollback pg_locks probe failed — treating as inconclusive",
      e && (e as { message?: unknown }).message
        ? String((e as { message: unknown }).message).slice(0, 200)
        : e
    );
  }
  assert(
    "advisory lock is released after transaction rollback",
    stillHeldAfterRollback === false,
    { stillHeldAfterRollback }
  );

  console.log("");
  if (process.exitCode) {
    console.log("advisory-lock regression check: FAILED");
  } else {
    console.log("advisory-lock regression check: PASSED");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    // Deliberately narrow error surface — no environment values are
    // reflected, only the error message text (which Prisma sanitizes
    // for connection strings by default). If the error object appears
    // to contain a DATABASE_URL-like substring, redact it.
    const msg = e && (e as { message?: unknown }).message
      ? String((e as { message: unknown }).message)
      : String(e);
    const redacted = msg.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]");
    console.error(redacted);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
