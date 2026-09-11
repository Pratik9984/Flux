"use client";

import React, { useState, useEffect } from "react";

export type LegalTab = "privacy" | "terms";

interface LegalModalProps {
  isOpen: boolean;
  initialTab?: LegalTab;
  onClose: () => void;
}

export default function LegalModal({
  isOpen,
  initialTab = "privacy",
  onClose,
}: LegalModalProps) {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop-sage"
      style={{ zIndex: 10005, padding: "16px" }}
      onClick={onClose}
    >
      <div
        className="cl-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 620,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          background: "#ffffff",
          borderRadius: 24,
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.16)",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
          animation: "fadeSlide 0.2s ease-out",
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 22px 14px",
            borderBottom: "1px solid rgba(0, 0, 0, 0.07)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: "rgba(109, 175, 120, 0.14)",
                color: "#4f9859",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {activeTab === "privacy" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              )}
            </div>
            <div>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#181c1f",
                  margin: 0,
                  lineHeight: 1.25,
                }}
              >
                {activeTab === "privacy" ? "Privacy Policy" : "Terms & Conditions"}
              </h2>
              <div
                style={{
                  fontSize: 11.5,
                  color: "#8a9096",
                  marginTop: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>Pulse Messenger</span>
                <span>•</span>
                <span>Last updated: Sept 2026</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#f4f5f7",
              border: "none",
              color: "#5e646a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              transition: "all 0.15s ease",
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher Pills */}
        <div
          style={{
            padding: "10px 18px",
            background: "#f8f9fa",
            borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
            display: "flex",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("privacy")}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRadius: 12,
              border: "none",
              background: activeTab === "privacy" ? "#6daf78" : "transparent",
              color: activeTab === "privacy" ? "#ffffff" : "#5e646a",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              boxShadow:
                activeTab === "privacy"
                  ? "0 2px 8px rgba(109, 175, 120, 0.35)"
                  : "none",
              transition: "all 0.18s ease",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("terms")}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRadius: 12,
              border: "none",
              background: activeTab === "terms" ? "#6daf78" : "transparent",
              color: activeTab === "terms" ? "#ffffff" : "#5e646a",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              boxShadow:
                activeTab === "terms"
                  ? "0 2px 8px rgba(109, 175, 120, 0.35)"
                  : "none",
              transition: "all 0.18s ease",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Terms & Conditions
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 22px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            color: "#181c1f",
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          {activeTab === "privacy" ? (
            <>
              {/* Privacy Highlight Banner */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: "rgba(109, 175, 120, 0.09)",
                  border: "1px solid rgba(109, 175, 120, 0.25)",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>🔒</div>
                <div>
                  <div style={{ fontWeight: 700, color: "#2e6a37", fontSize: 13.5 }}>
                    Zero-Knowledge & End-to-End Encryption
                  </div>
                  <div style={{ color: "#3f5643", fontSize: 12.5, marginTop: 3 }}>
                    Pulse is engineered so that only you and the recipient can read what is sent. Neither Pulse, your ISP, nor any third party can intercept or decrypt your private communications.
                  </div>
                </div>
              </div>

              {/* Section 1 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    1
                  </span>
                  Information We Process (And What We Don't)
                </h3>
                <p style={{ margin: "0 0 8px", color: "#454b52" }}>
                  We deliberately minimize the data needed to operate a reliable messaging experience:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#454b52", display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>
                    <strong>Account Identifiers:</strong> Your chosen username and email address are used exclusively for authentication, session verification, and cryptographic routing.
                  </li>
                  <li>
                    <strong>Public Identity Keys:</strong> We store your public cryptographic identity keys so other verified participants can encrypt messages destined for your devices. Your private encryption keys never leave your device.
                  </li>
                  <li>
                    <strong>Ephemeral Routing:</strong> Encrypted messages and attachments are held in server transit queues strictly until delivered to the recipient device, after which they are permanently deleted from transit memory.
                  </li>
                  <li>
                    <strong>No Address Book Uploads:</strong> Pulse does not scrape, collect, or upload your physical phone contacts. Contact connections are formed exclusively through explicit user search and interaction.
                  </li>
                </ul>
              </div>

              {/* Section 2 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    2
                  </span>
                  Device Permissions & Storage
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#454b52", display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>
                    <strong>Local Storage:</strong> Your chat messages, cached thumbnails, and decrypted files are stored within your app's sandboxed local database on your device.
                  </li>
                  <li>
                    <strong>Save to Gallery:</strong> When enabled in Settings, downloaded photos and videos are stored in your device's photo gallery using native platform MediaStore APIs for your easy viewing and sharing.
                  </li>
                  <li>
                    <strong>Camera & Microphone:</strong> Accessed strictly when you initiate or answer voice/video calls, or capture photos, videos, and voice memos. Microphones and cameras are never activated in the background.
                  </li>
                  <li>
                    <strong>Push Notifications:</strong> Push tokens (FCM/APNs) are utilized solely to wake your device for incoming calls and new encrypted messages.
                  </li>
                </ul>
              </div>

              {/* Section 3 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    3
                  </span>
                  Zero Third-Party Tracking & Advertising
                </h3>
                <p style={{ margin: 0, color: "#454b52" }}>
                  Pulse does not monetize your attention or personal data. We do not integrate commercial ad networks, third-party analytics trackers, or social tracking SDKs. We do not sell, rent, or trade your personal information to data brokers or third parties under any circumstances.
                </p>
              </div>

              {/* Section 4 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    4
                  </span>
                  Data Retention & Your Rights
                </h3>
                <p style={{ margin: "0 0 8px", color: "#454b52" }}>
                  You maintain complete autonomy over your communications and digital footprint:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#454b52", display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>
                    <strong>Message Deletion:</strong> Deleting a message or clearing a chat removes that content from your local device storage.
                  </li>
                  <li>
                    <strong>Account Erasure:</strong> Logging out or requesting account deletion purges your active authentication sessions, profile records, and registered identity keys.
                  </li>
                  <li>
                    <strong>Security Responsibility:</strong> Because Pulse operates on a zero-knowledge cryptographic model, we cannot recover deleted encryption keys or decrypt chats on your behalf.
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* Terms Highlight Banner */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: "rgba(109, 175, 120, 0.09)",
                  border: "1px solid rgba(109, 175, 120, 0.25)",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>⚖️</div>
                <div>
                  <div style={{ fontWeight: 700, color: "#2e6a37", fontSize: 13.5 }}>
                    User Agreement & Acceptable Use
                  </div>
                  <div style={{ color: "#3f5643", fontSize: 12.5, marginTop: 3 }}>
                    Please review these terms carefully. By using Pulse, you agree to lawful, respectful, and safe communication across our platform.
                  </div>
                </div>
              </div>

              {/* Section 1 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    1
                  </span>
                  Acceptance of Terms
                </h3>
                <p style={{ margin: 0, color: "#454b52" }}>
                  By downloading, creating an account, or using Pulse ("Flux Messenger"), you agree to be bound by these Terms and Conditions and our Privacy Policy. If you do not agree to all terms, you must discontinue using Pulse immediately.
                </p>
              </div>

              {/* Section 2 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    2
                  </span>
                  Acceptable Use Policy
                </h3>
                <p style={{ margin: "0 0 8px", color: "#454b52" }}>
                  You agree to use Pulse strictly for lawful, authentic, and authorized communication. You agree NOT to:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#454b52", display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>Transmit malware, viruses, phishing links, or malicious payloads.</li>
                  <li>Engage in automated bulk messaging, spam, or denial-of-service attempts against service infrastructure.</li>
                  <li>Distribute child sexual abuse material (CSAM), promote terrorism, or incite violent or unlawful harm.</li>
                  <li>Harass, stalk, threaten, extort, impersonate, or abuse other users.</li>
                  <li>Infringe upon copyrights, trademarks, or proprietary intellectual property rights of others.</li>
                </ul>
              </div>

              {/* Section 3 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    3
                  </span>
                  Your Content & Intellectual Property
                </h3>
                <p style={{ margin: 0, color: "#454b52" }}>
                  <strong>Your Ownership:</strong> You retain complete 100% intellectual property ownership of all messages, photos, videos, and media you transmit through Pulse. Pulse claims no ownership, copyright, or commercial rights over user content.
                </p>
              </div>

              {/* Section 4 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    4
                  </span>
                  Disclaimers & Emergency Calling
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#454b52", display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>
                    <strong>No Emergency Services:</strong> Pulse is an internet-based messaging application and does NOT provide access to emergency response services (e.g. 911, 112, 999). You must ensure you have mobile or landline telephone access for emergency situations.
                  </li>
                  <li>
                    <strong>Service "As-Is":</strong> The service is provided on an "as-is" and "as-available" basis without express or implied warranties regarding uninterrupted or error-free network availability.
                  </li>
                </ul>
              </div>

              {/* Section 5 */}
              <div>
                <h3
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "#181c1f",
                    margin: "0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#eef5ef",
                      color: "#4f9859",
                      fontSize: 11,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    5
                  </span>
                  Termination & Modifications
                </h3>
                <p style={{ margin: 0, color: "#454b52" }}>
                  We reserve the right to suspend or terminate accounts that breach these Terms or abuse system infrastructure. We may update these Terms periodically, and continued use of the application indicates agreement with the updated terms.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid rgba(0, 0, 0, 0.07)",
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              color: "#8a9096",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ color: "#6daf78", fontWeight: 700 }}>●</span>
            <span>Pulse Cryptographic Security Standard</span>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: "9px 24px",
              borderRadius: 12,
              background: "#6daf78",
              border: "none",
              color: "#ffffff",
              fontSize: 13.5,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 3px 10px rgba(109, 175, 120, 0.3)",
              transition: "transform 0.15s ease, background 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#5ea069")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#6daf78")}
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
