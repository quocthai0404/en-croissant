import { getVersion } from "@tauri-apps/api/app";
import posthog from "posthog-js";

const PROJECT_KEY = "phc_kgEBtifs0EgWlrl4ROYEbnsQ1b7BS2W5BKLNyXe7f8z";
let initialized = false;

/** Analytics stays dormant until the user explicitly opts in. */
export async function enableTelemetry(): Promise<void> {
  if (!initialized) {
    posthog.init(PROJECT_KEY, {
      api_host: "https://app.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
    });
    initialized = true;
  }
  posthog.opt_in_capturing();
  posthog.capture("app_started", { version: await getVersion() });
}

export function disableTelemetry(): void {
  if (initialized) posthog.opt_out_capturing();
}
