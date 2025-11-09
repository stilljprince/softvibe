"use client";

type Props = {
  src: string;
  className?: string;
};

export default function CustomPlayer({ src, className }: Props) {
  return (
    <audio
      controls
      preload="none"
      src={src}
      controlsList="nodownload noplaybackrate noremoteplayback"
      className={className}
      style={{ width: "100%" }}
    />
  );
}