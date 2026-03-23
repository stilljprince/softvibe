// app/components/player-context.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Chapter = {
  id: string;
  url: string;
  title: string;
  partIndex: number;
  durationSeconds?: number;
};

export type PlayerState = {
  trackUrl: string | null;
  trackTitle: string | null;
  trackId: string | null;

  // Forward-compatible — story/chapter fields unused in Phase 1
  storyId: string | null;
  chapters: Chapter[];
  chapterIndex: number;

  isPlaying: boolean;
  currentTime: number; // seconds
  duration: number;    // seconds

  isFullscreen: boolean;
};

type PlayerAction =
  | { type: "LOAD_TRACK"; trackUrl: string; trackTitle: string; trackId: string }
  | { type: "LOAD_STORY"; storyId: string; chapters: Chapter[]; startIndex?: number }
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
  loadStory: (storyId: string, chapters: Chapter[], startIndex?: number) => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  goToChapter: (index: number) => void;
  openFullscreen: () => void;
  closeFullscreen: () => void;
  clear: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedUrlRef = useRef<string | null>(null);

  // Create the single Audio element on client mount.
  // It is never rendered in the DOM — it lives only in this ref.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const onTimeUpdate = () => {
      dispatch({
        type: "TIME_UPDATE",
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    };

    const onEnded = () => dispatch({ type: "TRACK_ENDED" });

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
      loadedUrlRef.current = null;
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

  // ── Action helpers ──

  const loadTrack = useCallback(
    (trackUrl: string, trackTitle: string, trackId: string) => {
      dispatch({ type: "LOAD_TRACK", trackUrl, trackTitle, trackId });
    },
    [],
  );

  const loadStory = useCallback(
    (storyId: string, chapters: Chapter[], startIndex?: number) => {
      dispatch({ type: "LOAD_STORY", storyId, chapters, startIndex });
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
