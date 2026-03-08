"use client";

import { track } from "@vercel/analytics";

export function trackEvent(name, props = {}) {
  try {
    track(name, props);
  } catch (_) {
    // fail silently in local/dev if analytics is unavailable
  }
}