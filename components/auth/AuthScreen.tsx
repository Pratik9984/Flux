"use client";

import React, { useState } from "react";
import type { AuthState, AuthAction } from "@/types";

export interface AuthScreenProps {
  auth: AuthState;
  dispatchAuth: React.Dispatch<AuthAction>;
  handleSignIn: () => void;
  handleSignUp: () => void;
  handleRegister: () => void;
  handleForgotPassword: () => void;
  handleResetPassword: () => void;
  checkUsernameAvailability: (value: string) => void;
}

export default function AuthScreen({
  auth,
  dispatchAuth,
  handleSignIn,
  handleSignUp,
  handleRegister,
  handleForgotPassword,
  handleResetPassword,
  checkUsernameAvailability,
}: AuthScreenProps) {
  const [welcomeSlide, setWelcomeSlide] = useState(0);

  const slides = [
    {
      title: "Hello, Lets Chat",
      subtitle: "Having lots of friends will make your life more colorful",
    },
    {
      title: "Fast & Secure",
      subtitle: "Instant messaging and crystal clear voice & video calling",
    },
    {
      title: "Share Everything",
      subtitle: "Effortlessly share photos, videos, files and moments",
    },
  ];

  // ── ONBOARDING / WELCOME SCREEN (Screen 1 from Reference) ──
  if (auth.step === "welcome") {
    return (
      <div className="onboarding-container">
        {/* Top Green Hero Container with Speech Bubble Doodles */}
        <div className="onboarding-top">
          <div className="onboarding-doodles">
            <svg className="doodle doodle-1" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <svg className="doodle doodle-2" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12h.01M12 12h.01M16 12h.01" />
            </svg>
            <svg className="doodle doodle-3" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <svg className="doodle doodle-4" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>

          <div className="onboarding-hero-image-wrap">
            <img
              src="/onboarding-hero.jpg"
              alt="Welcome to Flux"
              className="onboarding-hero-img"
            />
          </div>
        </div>

        {/* Curved White Bottom Sheet */}
        <div className="onboarding-bottom-card">
          {/* 3-Step Carousel Indicators */}
          <div className="onboarding-dots">
            {slides.map((_, idx) => (
              <span
                key={idx}
                className={`onboarding-dot ${idx === welcomeSlide ? "active" : ""}`}
                onClick={() => setWelcomeSlide(idx)}
              />
            ))}
          </div>

          <div className="onboarding-text-content">
            <h1 className="onboarding-title">{slides[welcomeSlide].title}</h1>
            <p className="onboarding-subtitle">{slides[welcomeSlide].subtitle}</p>
          </div>

          <div className="onboarding-actions">
            <button
              onClick={() => dispatchAuth({ type: "SET_STEP", step: "signin" })}
              className="onboarding-btn-primary"
            >
              Get Started
            </button>
            <button
              onClick={() => dispatchAuth({ type: "SET_STEP", step: "signup" })}
              className="onboarding-btn-secondary"
            >
              Create New Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── AUTH FORMS (Sign In, Sign Up, Forgot Password, Reset, Pick Username) ──
  return (
    <div className="auth-modern-page">
      <div className="auth-modern-header">
        <button
          onClick={() => dispatchAuth({ type: "SET_STEP", step: "welcome" })}
          className="auth-back-circle-btn"
          aria-label="Back to welcome"
        >
          ←
        </button>
        <div className="auth-brand-chip">
          <div className="auth-brand-logo">
            <img src="/icon.png" alt="Flux" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <span>Flux</span>
        </div>
      </div>

      <div className="auth-modern-card">
        {auth.step === "verify-email" && (
          <div className="auth-step-content">
            <div style={{ fontSize: 48, textAlign: "center", marginBottom: 12 }}>📬</div>
            <h2 className="ac-title">Check your inbox</h2>
            <p className="ac-sub">We sent a verification link to <strong>{auth.email}</strong>.<br />Please click the link, then return here to sign in.</p>
            <button className="onboarding-btn-primary" onClick={() => dispatchAuth({ type: "SET_STEP", step: "signin" })}>
              Back to Sign In
            </button>
          </div>
        )}

        {auth.step === "signin" && (
          <div className="auth-step-content">
            <h2 className="ac-title">Welcome Back</h2>
            <p className="ac-sub">Sign in to continue chatting with your friends</p>

            <div className="ac-field">
              <label>Email Address</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 7L2 7" />
                </svg>
                <input
                  value={auth.email}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "email", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleSignIn()}
                  type="email"
                  placeholder="you@example.com"
                  className="ac-input"
                  autoFocus
                />
              </div>
            </div>

            <div className="ac-field">
              <label>Password</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  value={auth.pass}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "pass", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleSignIn()}
                  type="password"
                  placeholder="••••••••"
                  className="ac-input"
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => dispatchAuth({ type: "SET_STEP", step: "forgot-password" })}
                style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 13, cursor: "pointer", fontWeight: 500 }}
              >
                Forgot password?
              </button>
            </div>

            <button disabled={auth.loading} onClick={handleSignIn} className="onboarding-btn-primary">
              {auth.loading ? "Signing in…" : "Sign In"}
            </button>

            <p className="ac-sub" style={{ marginTop: 20, textAlign: "center" }}>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => dispatchAuth({ type: "SET_STEP", step: "signup" })}
                style={{ background: "none", border: "none", color: "var(--green)", cursor: "pointer", fontWeight: 700 }}
              >
                Sign Up
              </button>
            </p>
          </div>
        )}

        {auth.step === "signup" && (
          <div className="auth-step-content">
            <h2 className="ac-title">Create Account</h2>
            <p className="ac-sub">Join Flux to connect with friends</p>

            <div className="ac-field">
              <label>Email Address</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 7L2 7" />
                </svg>
                <input
                  value={auth.email}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "email", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleSignUp()}
                  type="email"
                  placeholder="you@example.com"
                  className="ac-input"
                  autoFocus
                />
              </div>
            </div>

            <div className="ac-field">
              <label>Password</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  value={auth.pass}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "pass", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleSignUp()}
                  type="password"
                  placeholder="At least 6 characters"
                  className="ac-input"
                />
              </div>
            </div>

            <div className="ac-field">
              <label>Confirm Password</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  value={auth.pass2}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "pass2", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleSignUp()}
                  type="password"
                  placeholder="••••••••"
                  className="ac-input"
                />
              </div>
            </div>

            <button disabled={auth.loading} onClick={handleSignUp} className="onboarding-btn-primary" style={{ marginTop: 8 }}>
              {auth.loading ? "Creating account…" : "Continue"}
            </button>

            <p className="ac-sub" style={{ marginTop: 20, textAlign: "center" }}>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => dispatchAuth({ type: "SET_STEP", step: "signin" })}
                style={{ background: "none", border: "none", color: "var(--green)", cursor: "pointer", fontWeight: 700 }}
              >
                Sign In
              </button>
            </p>
          </div>
        )}

        {auth.step === "pick-username" && (
          <div className="auth-step-content">
            <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8 }}>🏷️</div>
            <h2 className="ac-title">Pick a Username</h2>
            <p className="ac-sub">Your unique handle on Flux (lowercase, numbers, underscores).</p>

            <div className="ac-field">
              <label>Username</label>
              <div className="ac-input-wrap">
                <span className="ac-icon" style={{ fontWeight: 700, color: "var(--text-3)", fontSize: 16 }}>@</span>
                <input
                  value={auth.user}
                  onChange={e => {
                    const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                    dispatchAuth({ type: "SET_FIELD", field: "user", value: v });
                    dispatchAuth({ type: "SET_ERROR", value: "" });
                    checkUsernameAvailability(v);
                  }}
                  onKeyDown={e => e.key === "Enter" && handleRegister()}
                  type="text"
                  placeholder="e.g. john_doe"
                  className="ac-input"
                  maxLength={30}
                  autoFocus
                />
              </div>
              {auth.user.length >= 3 && !auth.error && (
                <p style={{ fontSize: 12, color: "var(--green)", marginTop: 6, fontWeight: 600 }}>✓ Username is available</p>
              )}
            </div>

            <button disabled={auth.loading || !!auth.error || auth.user.length < 3} onClick={handleRegister} className="onboarding-btn-primary" style={{ marginTop: 12 }}>
              {auth.loading ? "Setting up…" : "Finish Setup"}
            </button>
          </div>
        )}

        {auth.step === "forgot-password" && (
          <div className="auth-step-content">
            <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8 }}>🔑</div>
            <h2 className="ac-title">Reset Password</h2>
            <p className="ac-sub">Enter your email and we'll send you a password reset link.</p>

            <div className="ac-field">
              <label>Email Address</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 7L2 7" />
                </svg>
                <input
                  value={auth.email}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "email", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleForgotPassword()}
                  type="email"
                  placeholder="you@example.com"
                  className="ac-input"
                  autoFocus
                />
              </div>
            </div>

            <button disabled={auth.loading} onClick={handleForgotPassword} className="onboarding-btn-primary" style={{ marginTop: 8 }}>
              {auth.loading ? "Sending link…" : "Send Reset Link"}
            </button>

            <p style={{ textAlign: "center", marginTop: 16 }}>
              <button
                type="button"
                onClick={() => dispatchAuth({ type: "SET_STEP", step: "signin" })}
                style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
              >
                Back to Sign In
              </button>
            </p>
          </div>
        )}

        {auth.step === "reset-password" && (
          <div className="auth-step-content">
            <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8 }}>🔒</div>
            <h2 className="ac-title">Set New Password</h2>
            <p className="ac-sub">Choose a secure password for your Flux account.</p>

            <div className="ac-field">
              <label>New Password</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  value={auth.pass}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "pass", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                  type="password"
                  placeholder="At least 6 characters"
                  className="ac-input"
                  autoFocus
                />
              </div>
            </div>

            <div className="ac-field">
              <label>Confirm New Password</label>
              <div className="ac-input-wrap">
                <svg className="ac-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  value={auth.pass2}
                  onChange={e => dispatchAuth({ type: "SET_FIELD", field: "pass2", value: e.target.value })}
                  onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                  type="password"
                  placeholder="••••••••"
                  className="ac-input"
                />
              </div>
            </div>

            <button disabled={auth.loading} onClick={handleResetPassword} className="onboarding-btn-primary" style={{ marginTop: 8 }}>
              {auth.loading ? "Updating password…" : "Save New Password"}
            </button>
          </div>
        )}

        {auth.error && (
          <div className="ac-error" style={{ marginTop: 16 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {auth.error}
          </div>
        )}
      </div>
    </div>
  );
}
