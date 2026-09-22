import type { Transition } from "motion/react";

/* Shared motion vocabulary. Every animated component draws its timing from
 * here, so the app moves with one voice: quick, decelerating, never bouncy on
 * content. Springs are kept for things that follow the pointer or slide
 * between positions (the nav pill, a segmented control's thumb).
 *
 * Reduced motion is handled once, by <MotionConfig reducedMotion="user"> in
 * main.tsx: transforms are dropped and only opacity still fades.
 */

/** Same curve as the CSS --animate-scale-in keyframe. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const fade: Transition = { duration: 0.18, ease: EASE_OUT };

export const enter: Transition = { duration: 0.36, ease: EASE_OUT };

/** For an element sliding to a new layout position (layoutId pills). */
export const glide: Transition = { type: "spring", stiffness: 520, damping: 40, mass: 0.7 };

/** Press feedback on anything clickable. */
export const tap = { scale: 0.96 } as const;
