"use client";

import dynamic from "next/dynamic";
import React from "react";

function Skeleton() {
  return (
    <div className="skeleton-wrapper" aria-hidden="true" role="presentation">
      {/* Sidebar Skeleton */}
      <div className="skeleton-sidebar">
        <div className="skeleton-header-bar">
          <div className="skeleton-logo shimmer" />
          <div className="skeleton-circle-btn shimmer" />
        </div>
        <div className="skeleton-search-bar shimmer" />
        <div className="skeleton-list">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton-item">
              <div className="skeleton-avatar shimmer" />
              <div className="skeleton-info">
                <div className={`skeleton-line shimmer ${i % 2 === 0 ? "skeleton-line-short" : "skeleton-line-medium"}`} />
                <div className="skeleton-line skeleton-line-long shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Panel Skeleton */}
      <div className="skeleton-chat-panel">
        <div className="skeleton-chat-header">
          <div className="skeleton-avatar shimmer" />
          <div className="skeleton-chat-title">
            <div className="skeleton-line skeleton-line-medium shimmer" />
            <div className="skeleton-line skeleton-line-short shimmer" />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="skeleton-circle-btn shimmer" />
            <div className="skeleton-circle-btn shimmer" />
          </div>
        </div>

        <div className="skeleton-chat-messages">
          <div className="skeleton-bubble skeleton-bubble-incoming">
            <div className="skeleton-line skeleton-line-medium shimmer" style={{ height: 10 }} />
            <div className="skeleton-line skeleton-line-long shimmer" style={{ height: 10 }} />
          </div>
          <div className="skeleton-bubble skeleton-bubble-outgoing">
            <div className="skeleton-line skeleton-line-short shimmer" style={{ height: 10 }} />
            <div className="skeleton-line skeleton-line-medium shimmer" style={{ height: 10 }} />
          </div>
          <div className="skeleton-bubble skeleton-bubble-incoming" style={{ maxWidth: "45%" }}>
            <div className="skeleton-line skeleton-line-long shimmer" style={{ height: 10 }} />
          </div>
          <div className="skeleton-bubble skeleton-bubble-outgoing" style={{ maxWidth: "50%" }}>
            <div className="skeleton-line skeleton-line-medium shimmer" style={{ height: 10 }} />
            <div className="skeleton-line skeleton-line-short shimmer" style={{ height: 10 }} />
          </div>
        </div>

        <div className="skeleton-chat-input-bar">
          <div className="skeleton-circle-btn shimmer" />
          <div className="skeleton-input-field shimmer" />
          <div className="skeleton-circle-btn shimmer" />
        </div>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { requestAllAppPermissions } from "@/lib/permissions";

const FluxApp = dynamic(() => import("@/components/FluxApp"), {
  ssr: false,
  loading: () => <Skeleton />,
});

export default function Page() {
  useEffect(() => {
    requestAllAppPermissions();
  }, []);

  return <FluxApp />;
}