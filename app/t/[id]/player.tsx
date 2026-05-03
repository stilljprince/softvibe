"use client";

import SVPlayer from "@/app/components/SVPlayer";
import type { ThemeConfig } from "@/app/components/sv-kit";

export default function ClientPlayer({
  url,
  themeCfg,
  onPlayingChange,
}: {
  url: string;
  themeCfg: ThemeConfig;
  onPlayingChange?: (isPlaying: boolean) => void;
}) {
  return <SVPlayer src={url} themeCfg={themeCfg} onPlayingChange={onPlayingChange} />;
}