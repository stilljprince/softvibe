// app/components/player-context.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Chapter = {
  id: string;
  url: string;
  title: string;
  partIndex: number;
  durationSeconds?: number;
};

export type QueueItem = {
  queueId: string;
  trackId: string;
  trackUrl: string;
  title: string;
  storyId?: string | null;
  chapters?: Chapter[];
};

// Module-level counter — client-only component, so no SSR conflict.
let _queueIdCounter = 0;
function newQueueId() { return `q-${++_queueIdCounter}`; }

export type PlayerState = {
  trackUrl: string | null;
  trackTitle: string | null;
  trackId: string | null;

  // Forward-compatible — story/chapter fields unused in Phase 1
  storyId: string | null;
  storyTitle: string | null;
  chapters: Chapter[];
  chapterIndex: number;

  isPlaying: boolean;
  currentTime: number; // seconds
  duration: number;    // seconds

  isFullscreen: boolean;
};

type PlayerAction =
  | { type: "LOAD_TRACK"; trackUrl: string; trackTitle: string; trackId: string }
  | { type: "LOAD_STORY"; storyId: string; storyTitle?: string; chapters: Chapter[]; startIndex?: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK" } // handled imperatively; no state change
  | { type: "TIME_UPDATE"; currentTime: number; duration: number }
  | { type: "TRACK_ENDED" }
  | { type: "NEXT_CHAPTER" }
  | { type: "PREV_CHAPTER" }
  | { type: "OPEN_FULLSCREEN" }
  | { type: "CLOSE_FULLSCREEN" }
  | { type: "GO_TO_CHAPTER"; index: number }
  | { type: "CLEAR" };

// ─── Initial state ────────────────────────────────────────────────────────────

const initial: PlayerState = {
  trackUrl: null,
  trackTitle: null,
  trackId: null,
  storyId: null,
  storyTitle: null,
  chapters: [],
  chapterIndex: 0,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  isFullscreen: false,
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "LOAD_TRACK":
      return {
        ...initial,
        trackUrl: action.trackUrl,
        trackTitle: action.trackTitle,
        trackId: action.trackId,
        isPlaying: true,
        isFullscreen: state.isFullscreen,
      };

    case "LOAD_STORY": {
      const sorted = [...action.chapters].sort((a, b) => a.partIndex - b.partIndex);
      const idx = action.startIndex ?? 0;
      return {
        ...initial,
        storyId: action.storyId,
        storyTitle: action.storyTitle ?? null,
        chapters: sorted,
        chapterIndex: idx,
        trackUrl: sorted[idx]?.url ?? null,
        trackTitle: sorted[idx]?.title ?? null,
        trackId: sorted[idx]?.id ?? null,
        isPlaying: true,
        isFullscreen: state.isFullscreen,
      };
    }

    case "PLAY":
      return { ...state, isPlaying: true };

    case "PAUSE":
      return { ...state, isPlaying: false };

    case "SEEK":
      // Handled imperatively against the audio element in the provider.
      return state;

    case "TIME_UPDATE":
      return { ...state, currentTime: action.currentTime, duration: action.duration };

    case "TRACK_ENDED":
      // Auto-advance to next chapter when a story is loaded.
      if (state.storyId && state.chapterIndex < state.chapters.length - 1) {
        const next = state.chapterIndex + 1;
        const ch = state.chapters[next];
        return {
          ...state,
          chapterIndex: next,
          trackUrl: ch.url,
          trackTitle: ch.title,
          trackId: ch.id,
          currentTime: 0,
          isPlaying: true,
        };
      }
      return { ...state, isPlaying: false };

    case "NEXT_CHAPTER": {
      const next = state.chapterIndex + 1;
      if (next >= state.chapters.length) return { ...state, isPlaying: false };
      const ch = state.chapters[next];
      return {
        ...state,
        chapterIndex: next,
        trackUrl: ch.url,
        trackTitle: ch.title,
        trackId: ch.id,
        currentTime: 0,
        isPlaying: true,
      };
    }

    case "PREV_CHAPTER": {
      const prev = state.chapterIndex - 1;
      if (prev < 0) return state;
      const ch = state.chapters[prev];
      return {
        ...state,
        chapterIndex: prev,
        trackUrl: ch.url,
        trackTitle: ch.title,
        trackId: ch.id,
        currentTime: 0,
        isPlaying: true,
      };
    }

    case "OPEN_FULLSCREEN":
      return { ...state, isFullscreen: true };

    case "CLOSE_FULLSCREEN":
      return { ...state, isFullscreen: false };

    case "GO_TO_CHAPTER": {
      const idx = Math.max(0, Math.min(action.index, state.chapters.length - 1));
      const ch = state.chapters[idx];
      if (!ch) return state;
      return {
        ...state,
        chapterIndex: idx,
        trackUrl: ch.url,
        trackTitle: ch.title,
        trackId: ch.id,
        currentTime: 0,
        isPlaying: true,
      };
    }

    case "CLEAR":
      return { ...initial };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

type PlayerContextValue = {
  state: PlayerState;
  audioEl: React.RefObject<HTMLAudioElement | null>;
  loadTrack: (trackUrl: string, trackTitle: string, trackId: string) => void;
  loadStory: (storyId: string, chapters: Chapter[], startIndex?: number, storyTitle?: string) => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  goToChapter: (index: number) => void;
  openFullscreen: () => void;
  closeFullscreen: () => void;
  clear: () => void;
  // ── Queue ────────────────────────────────────────────────────────────────
  queue: QueueItem[];
  currentQueueId: string | null;
  enqueue: (item: Omit<QueueItem, "queueId">) => void;
  enqueueBatch: (items: Omit<QueueItem, "queueId">[]) => void;
  dequeueItem: (queueId: string) => void;
  clearQueue: () => void;
  nextInQueue: () => void;
  prevInQueue: () => void;
  playFromQueue: (queueId: string) => void;
  playBatch: (items: Omit<QueueItem, "queueId">[], startIndex: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedUrlRef = useRef<string | null>(null);
  // Timer and RAF handles for the end-of-chapter volume ramp.
  const rampTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rampRafRef = useRef<number | null>(null);

  // ── Queue state ──────────────────────────────────────────────────────────
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [currentQueueId, setCurrentQueueId] = useState<string | null>(null);
  // Refs kept synchronously current so audio event handlers can read them without
  // stale-closure issues (no useEffect delay needed).
  const queueItemsRef = useRef<QueueItem[]>([]);
  const currentQueueIdRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  queueItemsRef.current = queueItems;
  currentQueueIdRef.current = currentQueueId;

  // Create the single Audio element on client mount.
  // It is never rendered in the DOM — it lives only in this ref.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const preload = new Audio();
    preload.preload = "auto";
    preloadAudioRef.current = preload;

    // Cancel any in-flight ramp timer or RAF loop.
    const cancelFade = () => {
      if (rampTimerRef.current !== null) { clearTimeout(rampTimerRef.current); rampTimerRef.current = null; }
      if (rampRafRef.current !== null) { cancelAnimationFrame(rampRafRef.current); rampRafRef.current = null; }
    };

    // Schedule a smooth RAF-based volume fade starting 1s before chapter end.
    // Uses durationSeconds from chapter metadata (server-computed) for reliability
    // on first play, before audio.duration is available.
    const scheduleFade = (durationSec: number, isLastChapter: boolean) => {
      cancelFade();
      if (isLastChapter || durationSec <= 1.5) return;
      // Conservative: 0.5s fade (was 1.0s) to reduce the window where durationSeconds
      // undershooting real playback duration causes dead air.
      // Floor at 0.08 (not 0) — audio stays nearly inaudible until onEnded fires,
      // preventing multi-second silence if the fade completes before the audio ends.
      const RAMP_SEC = 0.5;
      const RAMP_FLOOR = 0.08;
      const delayMs = Math.max(0, (durationSec - RAMP_SEC) * 1000);
      rampTimerRef.current = setTimeout(() => {
        rampTimerRef.current = null;
        const s = stateRef.current;
        if (!s.storyId || s.chapterIndex >= s.chapters.length - 1) return;
        const rampStart = performance.now();
        const rampMs = RAMP_SEC * 1000;
        const tick = () => {
          const t = Math.min(1, (performance.now() - rampStart) / rampMs);
          audio.volume = Math.max(RAMP_FLOOR, 1 - t);
          if (t < 1) { rampRafRef.current = requestAnimationFrame(tick); }
          else { rampRafRef.current = null; }
        };
        rampRafRef.current = requestAnimationFrame(tick);
      }, delayMs);
    };

    const onTimeUpdate = () => {
      dispatch({
        type: "TIME_UPDATE",
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
      // Backup ramp only — fires when timer-based fade couldn't schedule
      // (durationSeconds was missing). Uses audio.duration once available.
      const s = stateRef.current;
      if (
        s.storyId &&
        s.chapterIndex < s.chapters.length - 1 &&
        audio.duration > 0 &&
        rampTimerRef.current === null &&
        rampRafRef.current === null &&
        audio.volume > 0.05
      ) {
        const remaining = audio.duration - audio.currentTime;
        if (remaining < 0.8 && remaining >= 0) {
          // Math.min ensures we only ever decrease volume here, never increase it.
          audio.volume = Math.min(audio.volume, Math.max(0, remaining / 0.8));
        }
      }
    };

    const onEnded = () => {
      cancelFade();
      const s = stateRef.current;
      // Story with more chapters: start the next chapter's audio immediately on
      // the same tick as the ended event, before any React re-render.
      // Setting loadedUrlRef prevents the sync effect from calling .load() again
      // when the state update propagates through React.
      if (s.storyId && s.chapterIndex < s.chapters.length - 1) {
        const next = s.chapterIndex + 1;
        const ch = s.chapters[next];
        audio.volume = 1; // Reset ramp before next chapter
        audio.src = ch.url;
        audio.load();
        loadedUrlRef.current = ch.url;
        void audio.play().catch(() => {});
        dispatch({ type: "TRACK_ENDED" });
        return;
      }
      // Advance to next queued item if one exists.
      const items = queueItemsRef.current;
      const curId = currentQueueIdRef.current;
      const curIdx = curId ? items.findIndex((x) => x.queueId === curId) : -1;
      const nextIdx = curIdx + 1;
      if (nextIdx < items.length) {
        const next = items[nextIdx];
        setCurrentQueueId(next.queueId);
        if (next.storyId && next.chapters && next.chapters.length > 0) {
          dispatch({ type: "LOAD_STORY", storyId: next.storyId, chapters: next.chapters, storyTitle: next.title });
        } else {
          dispatch({ type: "LOAD_TRACK", trackUrl: next.trackUrl, trackTitle: next.title, trackId: next.trackId });
        }
        return;
      }
      // Nothing more — stop.
      dispatch({ type: "TRACK_ENDED" });
    };

    const onPlay = () => {
      const s = stateRef.current;
      if (s.storyId) {
        const ch = s.chapters[s.chapterIndex];
        const isLast = s.chapterIndex >= s.chapters.length - 1;
        scheduleFade(ch?.durationSeconds ?? 0, isLast);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      cancelFade();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
      loadedUrlRef.current = null;
      preloadAudioRef.current = null;
      preloadedUrlRef.current = null;
    };
  }, []);

  // Sync trackUrl and isPlaying to the audio element.
  // A single effect handles both to avoid ordering ambiguity between two effects.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!state.trackUrl) {
      audio.pause();
      audio.src = "";
      loadedUrlRef.current = null;
      return;
    }

    if (loadedUrlRef.current !== state.trackUrl) {
      loadedUrlRef.current = state.trackUrl;
      audio.src = state.trackUrl;
      audio.load();
    }

    if (state.isPlaying) {
      audio.play().catch(() => {
        // Autoplay may be blocked by the browser.
        // isPlaying remains true in state; the user can press play to resume.
      });
    } else {
      audio.pause();
    }
  }, [state.trackUrl, state.isPlaying]);

  // Preload the next chapter whenever chapter index advances, so transitions
  // are instant rather than waiting on a cold network load.
  useEffect(() => {
    const pre = preloadAudioRef.current;
    if (!pre || !state.storyId) return;
    const next = state.chapters[state.chapterIndex + 1];
    if (!next?.url) return;
    if (preloadedUrlRef.current !== next.url) {
      preloadedUrlRef.current = next.url;
      pre.src = next.url;
      pre.load();
    }
  }, [state.storyId, state.chapterIndex, state.chapters]);

  // ── Action helpers ──

  const loadTrack = useCallback(
    (trackUrl: string, trackTitle: string, trackId: string) => {
      dispatch({ type: "LOAD_TRACK", trackUrl, trackTitle, trackId });
    },
    [],
  );

  const loadStory = useCallback(
    (storyId: string, chapters: Chapter[], startIndex?: number, storyTitle?: string) => {
      dispatch({ type: "LOAD_STORY", storyId, chapters, startIndex, storyTitle });
    },
    [],
  );

  const play = useCallback(() => dispatch({ type: "PLAY" }), []);
  const pause = useCallback(() => dispatch({ type: "PAUSE" }), []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration));
  }, []);

  const nextChapter = useCallback(() => dispatch({ type: "NEXT_CHAPTER" }), []);
  const prevChapter = useCallback(() => dispatch({ type: "PREV_CHAPTER" }), []);
  const goToChapter = useCallback((index: number) => dispatch({ type: "GO_TO_CHAPTER", index }), []);
  const openFullscreen = useCallback(() => dispatch({ type: "OPEN_FULLSCREEN" }), []);
  const closeFullscreen = useCallback(() => dispatch({ type: "CLOSE_FULLSCREEN" }), []);
  const clear = useCallback(() => dispatch({ type: "CLEAR" }), []);

  // ── Queue callbacks ──────────────────────────────────────────────────────

  const enqueue = useCallback((item: Omit<QueueItem, "queueId">) => {
    setQueueItems((prev) => [...prev, { ...item, queueId: newQueueId() }]);
  }, []);

  const enqueueBatch = useCallback((items: Omit<QueueItem, "queueId">[]) => {
    setQueueItems((prev) => [
      ...prev,
      ...items.map((it) => ({ ...it, queueId: newQueueId() })),
    ]);
  }, []);

  const dequeueItem = useCallback((queueId: string) => {
    setQueueItems((prev) => prev.filter((it) => it.queueId !== queueId));
    setCurrentQueueId((prev) => (prev === queueId ? null : prev));
  }, []);

  const clearQueue = useCallback(() => {
    setQueueItems([]);
    setCurrentQueueId(null);
  }, []);

  const nextInQueue = useCallback(() => {
    const items = queueItemsRef.current;
    const curId = currentQueueIdRef.current;
    const curIdx = curId ? items.findIndex((x) => x.queueId === curId) : -1;
    const nextIdx = curIdx + 1;
    if (nextIdx >= items.length) { dispatch({ type: "CLEAR" }); return; }
    const next = items[nextIdx];
    setCurrentQueueId(next.queueId);
    if (next.storyId && next.chapters && next.chapters.length > 0) {
      dispatch({ type: "LOAD_STORY", storyId: next.storyId, chapters: next.chapters, storyTitle: next.title });
    } else {
      dispatch({ type: "LOAD_TRACK", trackUrl: next.trackUrl, trackTitle: next.title, trackId: next.trackId });
    }
  }, []);

  const prevInQueue = useCallback(() => {
    const items = queueItemsRef.current;
    const curId = currentQueueIdRef.current;
    const curIdx = curId ? items.findIndex((x) => x.queueId === curId) : -1;
    if (curIdx <= 0) return;
    const prevIdx = curIdx - 1;
    const prev = items[prevIdx];
    setCurrentQueueId(prev.queueId);
    if (prev.storyId && prev.chapters && prev.chapters.length > 0) {
      dispatch({ type: "LOAD_STORY", storyId: prev.storyId, chapters: prev.chapters, storyTitle: prev.title });
    } else {
      dispatch({ type: "LOAD_TRACK", trackUrl: prev.trackUrl, trackTitle: prev.title, trackId: prev.trackId });
    }
  }, []);

  const playFromQueue = useCallback((queueId: string) => {
    const items = queueItemsRef.current;
    const item = items.find((x) => x.queueId === queueId);
    if (!item) return;
    setCurrentQueueId(queueId);
    if (item.storyId && item.chapters && item.chapters.length > 0) {
      dispatch({ type: "LOAD_STORY", storyId: item.storyId, chapters: item.chapters, storyTitle: item.title });
    } else {
      dispatch({ type: "LOAD_TRACK", trackUrl: item.trackUrl, trackTitle: item.title, trackId: item.trackId });
    }
  }, []);

  // Replaces the entire queue with `items`, sets currentQueueId to items[startIndex],
  // and starts playback from that position. Items before startIndex appear as history.
  const playBatch = useCallback((items: Omit<QueueItem, "queueId">[], startIndex: number) => {
    if (items.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, items.length - 1));
    const withIds: QueueItem[] = items.map((it) => ({ ...it, queueId: newQueueId() }));
    setQueueItems(withIds);
    const target = withIds[idx];
    setCurrentQueueId(target.queueId);
    if (target.storyId && target.chapters && target.chapters.length > 0) {
      dispatch({ type: "LOAD_STORY", storyId: target.storyId, chapters: target.chapters, storyTitle: target.title });
    } else {
      dispatch({ type: "LOAD_TRACK", trackUrl: target.trackUrl, trackTitle: target.title, trackId: target.trackId });
    }
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueueItems((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 ||
          fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const arr = [...prev];
      const [item] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, item);
      return arr;
    });
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        state,
        audioEl: audioRef,
        loadTrack,
        loadStory,
        play,
        pause,
        seek,
        nextChapter,
        prevChapter,
        goToChapter,
        openFullscreen,
        closeFullscreen,
        clear,
        queue: queueItems,
        currentQueueId,
        enqueue,
        enqueueBatch,
        dequeueItem,
        clearQueue,
        nextInQueue,
        prevInQueue,
        playFromQueue,
        playBatch,
        reorderQueue,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}
