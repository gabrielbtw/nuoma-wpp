import { motion, useReducedMotion, type HTMLMotionProps, type Transition } from "framer-motion";
import type { ReactNode } from "react";

import { cn } from "./cn.js";

export type AnimatePreset =
  | "fade-in"
  | "rise-in"
  | "slide-in-right"
  | "slide-in-left"
  | "stagger-item";

const SOFT_SPRING: Transition = { type: "spring", stiffness: 220, damping: 26 };

const PRESETS: Record<
  AnimatePreset,
  {
    initial: Record<string, number>;
    animate: Record<string, number>;
    transition?: Transition;
  }
> = {
  "fade-in": {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
  "rise-in": {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: SOFT_SPRING,
  },
  "slide-in-right": {
    initial: { opacity: 0, x: 32 },
    animate: { opacity: 1, x: 0 },
    transition: SOFT_SPRING,
  },
  "slide-in-left": {
    initial: { opacity: 0, x: -32 },
    animate: { opacity: 1, x: 0 },
    transition: SOFT_SPRING,
  },
  "stagger-item": {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: SOFT_SPRING,
  },
};

export interface AnimateProps extends Omit<HTMLMotionProps<"div">, "children"> {
  preset?: AnimatePreset;
  delaySeconds?: number;
  children?: ReactNode;
}

export function Animate({
  preset = "rise-in",
  delaySeconds,
  className,
  children,
  ...props
}: AnimateProps) {
  const shouldReduceMotion = useReducedMotion();
  const config = PRESETS[preset];
  const transition = delaySeconds
    ? { ...(config.transition ?? {}), delay: delaySeconds }
    : config.transition;
  if (shouldReduceMotion) {
    return (
      <motion.div initial={false} className={cn(className)} {...props}>
        {children}
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={config.initial}
      animate={config.animate}
      transition={transition}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerContainer({
  className,
  children,
  delayChildren = 0,
  staggerChildren = 0.05,
  ...props
}: HTMLMotionProps<"div"> & { delayChildren?: number; staggerChildren?: number }) {
  const shouldReduceMotion = useReducedMotion();
  if (shouldReduceMotion) {
    return (
      <motion.div initial={false} className={cn(className)} {...props}>
        {children}
      </motion.div>
    );
  }
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { delayChildren, staggerChildren },
        },
      }}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export const staggerItemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: SOFT_SPRING },
};
