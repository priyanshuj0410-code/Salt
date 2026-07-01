import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { HeroCounter } from "./HeroCounter";
import { AuthChatWidget } from "./AuthChatWidget";
import { DashboardReveal } from "./DashboardReveal";

/**
 * The single-page invisible-auth funnel. The storefront (hero + chat widget)
 * and the app dashboard are two layers of one page: on OTP success the
 * dashboard blooms full-screen from a scale/opacity spring (the "expanding
 * universe") while the storefront fades out together. prefers-reduced-motion
 * collapses the flight to a quick crossfade. The terminal CTA (and the top-bar
 * login) navigate to the REAL /login — the chat itself is a simulation.
 *
 * Mount as a PUBLIC route (outside ProtectedRoute), e.g. /welcome.
 */
export function LandingPage({ videoSrc }: { videoSrc?: string }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [entered, setEntered] = useState(false);
  const goToApp = useCallback(() => navigate("/login"), [navigate]);

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
          onLogin={goToApp}
          widget={<AuthChatWidget onAuthenticated={() => setEntered(true)} />}
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
            <DashboardReveal onEnter={goToApp} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
