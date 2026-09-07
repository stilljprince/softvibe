// lib/ads/google-ad-manager-rewarded.ts
//
// F-003 Slice 1 — Minimal Google Publisher Tag (GPT) client helper for
// the Rewarded Web ad format. Curated Library Sponsored Unlocks only.
//
// Scope, deliberately narrow:
//   * load the GPT script when live mode is used
//   * define exactly one rewarded out-of-page slot
//   * surface rewardedSlotReady / rewardedSlotGranted / rewardedSlotClosed
//     to the caller
//   * clean up its own slot + listeners on destroy()
//
// This is NOT a mediation layer, NOT a general ad-provider abstraction,
// and is not wired to any other ad surface in the app. No real Ad Unit
// ID is configured or invented in this slice — `getConfiguredRewardedAdUnit`
// simply reads whatever is (or isn't) present so live mode is
// provider-ready without inventing a placeholder identifier.
//
// Reward trust boundary: `rewardedSlotGranted` is a browser-local GPT
// event. It is NOT proof SoftVibe's server can verify — the server
// still independently validates event ownership, provider, expiry and
// the daily/active-unlock rules before granting anything (see
// lib/entitlement/sponsored-gam-web.ts). This helper only reports the
// browser-local signal; it never talks to SoftVibe's API itself.

export type SponsoredGamWebClientMode = "disabled" | "test" | "live";

/** Fails closed: any missing/unrecognised value resolves to "disabled". */
export function getClientSponsoredGamWebMode(): SponsoredGamWebClientMode {
  const raw = process.env.NEXT_PUBLIC_SPONSORED_GAM_WEB_MODE;
  if (typeof raw !== "string") return "disabled";
  const v = raw.trim().toLowerCase();
  if (v === "test") return "test";
  if (v === "live") return "live";
  return "disabled";
}

/** Returns null when no Ad Unit is configured — never a placeholder. */
export function getConfiguredRewardedAdUnit(): string | null {
  const raw = process.env.NEXT_PUBLIC_GAM_REWARDED_AD_UNIT;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

type GptRewardedEvent = {
  slot: unknown;
  makeRewardedVisible?: () => void;
};

export type RewardedLifecycleHandlers = {
  onReady?: (event: GptRewardedEvent) => void;
  onGranted?: (event: GptRewardedEvent) => void;
  onClosed?: () => void;
};

export type RewardedSlotHandle = {
  destroy: () => void;
};

const GPT_SCRIPT_SRC = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Googletag = any;

declare global {
  interface Window {
    googletag?: Googletag;
  }
}

let gptScriptPromise: Promise<void> | null = null;

function loadGptScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("GPT_BROWSER_ONLY"));
  }
  if (window.googletag?.apiReady) {
    return Promise.resolve();
  }
  if (gptScriptPromise) return gptScriptPromise;

  gptScriptPromise = new Promise<void>((resolve, reject) => {
    window.googletag = window.googletag || { cmd: [] };
    const existing = document.querySelector(`script[src="${GPT_SCRIPT_SRC}"]`);
    if (existing) {
      window.googletag.cmd.push(() => resolve());
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = GPT_SCRIPT_SRC;
    script.onload = () => window.googletag!.cmd.push(() => resolve());
    script.onerror = () => reject(new Error("GPT_SCRIPT_LOAD_FAILED"));
    document.head.appendChild(script);
  });
  return gptScriptPromise;
}

// GPT guarantees rewardedSlotReady/Granted/Closed only for a slot that
// actually gets a fill. On no-fill, a blocked script, or a script tag
// that "loads" without ever running (some ad-blocker stub responses),
// none of those three events ever fires — with no bound, the caller
// would sit in its waiting phase forever. This timeout is the backstop:
// if neither a grant nor a close happens in time, it synthesises the
// same "closed without reward" signal the caller already treats as
// calm "no unlock" — never a grant.
const DEFAULT_REWARD_TIMEOUT_MS = 20_000;

/**
 * Initialise a single rewarded out-of-page slot for the given Ad Unit
 * path and wire the three lifecycle events the caller needs. Rejects
 * (never hangs) if the script fails to load or the slot cannot be
 * defined — the caller must treat that as "no unlock", not retry
 * silently. If the slot is defined but no grant/close ever arrives
 * (no fill, stalled script), `onClosed` fires once timeoutMs elapses.
 */
export async function initRewardedSlot(
  adUnitPath: string,
  handlers: RewardedLifecycleHandlers,
  timeoutMs: number = DEFAULT_REWARD_TIMEOUT_MS
): Promise<RewardedSlotHandle> {
  let settled = false;
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    handlers.onClosed?.();
  }, timeoutMs);
  const markSettled = () => {
    settled = true;
    clearTimeout(timeoutId);
  };

  try {
    await loadGptScript();

    const googletag = window.googletag;
    if (!googletag) throw new Error("GPT_UNAVAILABLE");

    let slot: Googletag = null;
    let onReady: ((e: GptRewardedEvent) => void) | null = null;
    let onGranted: ((e: GptRewardedEvent) => void) | null = null;
    let onClosed: ((e: { slot: unknown }) => void) | null = null;

    await new Promise<void>((resolve, reject) => {
      googletag.cmd.push(() => {
        try {
          slot = googletag.defineOutOfPageSlot(
            adUnitPath,
            googletag.enums.OutOfPageFormat.REWARDED
          );
          if (!slot) {
            reject(new Error("REWARDED_SLOT_UNAVAILABLE"));
            return;
          }
          slot.addService(googletag.pubads());

          onReady = (event: GptRewardedEvent) => {
            if (event.slot === slot) handlers.onReady?.(event);
          };
          onGranted = (event: GptRewardedEvent) => {
            if (event.slot !== slot) return;
            markSettled();
            handlers.onGranted?.(event);
          };
          onClosed = (event: { slot: unknown }) => {
            if (event.slot !== slot) return;
            markSettled();
            handlers.onClosed?.();
          };
          googletag.pubads().addEventListener("rewardedSlotReady", onReady);
          googletag.pubads().addEventListener("rewardedSlotGranted", onGranted);
          googletag.pubads().addEventListener("rewardedSlotClosed", onClosed);

          googletag.enableServices();
          googletag.display(slot);
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error("REWARDED_SLOT_INIT_FAILED"));
        }
      });
    });

    return {
      destroy: () => {
        clearTimeout(timeoutId);
        if (!slot || !googletag) return;
        try {
          if (onReady) googletag.pubads().removeEventListener("rewardedSlotReady", onReady);
          if (onGranted) googletag.pubads().removeEventListener("rewardedSlotGranted", onGranted);
          if (onClosed) googletag.pubads().removeEventListener("rewardedSlotClosed", onClosed);
          googletag.destroySlots([slot]);
        } catch {
          // Best-effort cleanup only — never throw from teardown.
        }
      },
    };
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
