import React, { useEffect, useMemo, useState } from 'react';
import { resolveImageCandidates } from '../lib/imageUrl.ts';

interface SafeImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}

/**
 * Renders an <img> strictly with referrerPolicy="no-referrer", automatic Google Drive
 * direct-image conversion + secondary thumbnail fallback, and a resilient UI fallback
 * so broken image frames never appear.
 */
export function SafeImage({ src, alt, className, fallback }: SafeImageProps) {
  const candidates = useMemo(() => resolveImageCandidates(src), [src]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [src]);

  const activeSrc = candidates[candidateIndex];
  if (!activeSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={activeSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => {
        setCandidateIndex((idx) => idx + 1);
      }}
      className={className}
    />
  );
}
