/**
 * PostHog product analytics — typed event catalogue.
 * Safe to call on server or client; no-ops when POSTHOG_KEY is absent.
 */

type AnalyticsEvent =
  | { event: "beta_signup"; properties: { email: string; country: string; firm_name?: string } }
  | { event: "fec_upload"; properties: { client_id: string; rows_count?: number } }
  | { event: "classification_started"; properties: { import_id: string } }
  | { event: "classification_complete"; properties: { import_id: string; entries_classified: number; duration_ms: number } }
  | { event: "ca3_computed"; properties: { declaration_id: string; period: string; net_tva: number } }
  | { event: "xml_downloaded"; properties: { declaration_id: string; file_size_bytes?: number } }
  | { event: "audit_bundle_exported"; properties: { declaration_id: string } }
  | { event: "chat_message_sent"; properties: { client_id: string; session_id: string } };

let _posthog: typeof import("posthog-js").default | null = null;

async function getPostHog() {
  if (typeof window === "undefined") return null;
  if (_posthog) return _posthog;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.posthog.com",
      capture_pageview: false, // handled manually in layout
      persistence: "localStorage",
    });
    _posthog = posthog;
    return posthog;
  } catch {
    return null;
  }
}

export async function track({ event, properties }: AnalyticsEvent) {
  const ph = await getPostHog();
  ph?.capture(event, properties);
}

export async function identify(userId: string, traits?: Record<string, unknown>) {
  const ph = await getPostHog();
  ph?.identify(userId, traits);
}
