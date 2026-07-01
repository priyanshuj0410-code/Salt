import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { HeroCounter } from "./HeroCounter";
import { ReceiptChat, type ParseSummary } from "./ReceiptChat";
import { DashboardReveal } from "./DashboardReveal";

/**
 * The single-page invisible-onboarding funnel. Storefront (hero + receipt chat)
 * and the app dashboard are two layers of one page: uploading a bill (demo-)parses
 * it and blooms the dashboard full-screen from a scale/opacity spring (the
 * "expanding universe") while the storefront fades out. prefers-reduced-motion
 * collapses the flight to a quick crossfade. "Skip" and the top-bar login go to
 * the real /login; the dashboard's Enter Salt lands on "/" (real app/onboarding).
 *
 * Mount as a PUBLIC route (outside ProtectedRoute), e.g. /welcome.
 */
export function LandingPage({ videoSrc }: { videoSrc?: string }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [entered, setEntered] = useState(false);
  const [parsed, setParsed] = useState<ParseSummary | null>(null);
  const toLogin = useCallback(() => navigate("/login"), [navigate]);
  const toApp = useCallback(() => navigate("/"), [navigate]);

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-background font-sans text-text-primary">
      {/* Storefront layer — fades out as the app blooms in */}
      <motion.div
        aria-hidden={entered}
        className="absolute inset-0"
        animate={{ opacity: entered ? 0 : 1 }}
        transition={{ duration: reduce ? 0.2 : 0.5 }}
        style={{ pointerEvents: entered ? "none" : "auto" }}
      >
        <HeroCounter
          videoSrc={videoSrc}
          onLogin={toLogin}
          widget={
            <ReceiptChat
              onParsed={(summary) => {
                setParsed(summary);
                setEntered(true);
              }}
              onSkip={toLogin}
            />
          }
        />
      </motion.div>

      {/* Expanding universe — the dashboard grows to 100vw x 100vh */}
      <AnimatePresence>
        {entered && (
          <motion.div
            key="app"
            className="dark fixed inset-0 z-50"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={reduce ? { duration: 0.25 } : { type: "spring", stiffness: 220, damping: 30 }}
          >
            <DashboardReveal onEnter={toApp} parsed={parsed} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
