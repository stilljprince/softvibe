// lib/s3-track.ts
export function s3KeyForTrack(trackId: string) {
  return `tracks/${trackId}.mp3`;
}

export function localRelForTrack(trackId: string) {
  return `/generated/tracks/${trackId}.mp3`;
}

export function localAbsForTrack(trackId: string) {
  return `${process.cwd()}/public/generated/tracks/${trackId}.mp3`;
}