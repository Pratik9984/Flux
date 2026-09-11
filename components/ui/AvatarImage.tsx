"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAvatar } from "@/hooks/useAvatar";

interface AvatarImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  fallbackText?: string;
  fallbackClassName?: string;
  showSilhouetteFallback?: boolean;
}

export const AvatarImage: React.FC<AvatarImageProps> = ({
  src,
  alt = "avatar",
  className = "img-cover rounded-circle",
  fallbackText,
  fallbackClassName,
  showSilhouetteFallback = true,
  style,
  ...props
}) => {
  const resolvedSrc = useAvatar(src);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Reset error state when the source URL changes
  useEffect(() => {
    setHasError(false);
    setRetryCount(0);
  }, [src]);

  // Compute image URL with cache-busting on retries if needed
  const effectiveSrc = useMemo(() => {
    if (!resolvedSrc) return "";
    if (retryCount === 0) return resolvedSrc;
    // Only append cache-busting timestamp to HTTP/HTTPS URLs (not blob or data URLs)
    if (resolvedSrc.startsWith("http://") || resolvedSrc.startsWith("https://")) {
      const sep = resolvedSrc.includes("?") ? "&" : "?";
      return `${resolvedSrc}${sep}_retry=${retryCount}_${Date.now()}`;
    }
    return resolvedSrc;
  }, [resolvedSrc, retryCount]);

  const handleImageError = () => {
    if (retryCount < 2) {
      setTimeout(() => {
        setRetryCount((prev) => prev + 1);
      }, 400);
    } else {
      setHasError(true);
    }
  };

  const handleImageLoad = () => {
    setHasError(false);
  };

  // Render polished fallback initial or silhouette icon
  const renderFallback = () => {
    const trimmed = (fallbackText || "").trim();
    const initial = trimmed ? trimmed[0]?.toUpperCase() : null;

    return (
      <div
        className={fallbackClassName || className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-2, #202c33)",
          color: "var(--text-1, #e9edef)",
          fontWeight: 700,
          userSelect: "none",
          fontSize: "0.95rem",
          width: "100%",
          height: "100%",
          ...style,
        }}
        title={trimmed || alt || "avatar"}
      >
        {initial ? (
          initial
        ) : showSilhouetteFallback ? (
          <svg
            width="55%"
            height="55%"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ opacity: 0.65, display: "block" }}
          >
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        ) : (
          "?"
        )}
      </div>
    );
  };

  // If no source resolved, or image failed to load after retries, show fallback
  if (!resolvedSrc || hasError) {
    return renderFallback();
  }

  return (
    <img
      key={`${resolvedSrc}_${retryCount}`}
      src={effectiveSrc}
      alt={alt}
      className={className}
      style={{
        ...style,
      }}
      onError={handleImageError}
      onLoad={handleImageLoad}
      {...props}
    />
  );
};
