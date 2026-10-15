import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  buildPostmortemPrompt,
  generateWithClaude,
  MODEL,
  PostmortemRefusedError,
  PostmortemSchema,
  templatePostmortem,
} from "../src/ai/postmortem.js";
import { docToText } from "../src/realtime/yjs.js";
import type { EventKind, Incident, TimelineEvent } from "../src/types.js";

const incident: Incident = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Checkout returning 500s",
  severity: "SEV1",
  status: "resolved",
  created_at: "2026-10-15T02:03:00.000Z",
  resolved_at: "2026-10-15T02:40:00.000Z",
  postmortem: null,
};

const ev = (kind: EventKind, at: string, title: string): TimelineEvent => ({
  id: title,
  incident_id: incident.id,
  source: "github",
  kind,
  title,
  detail: {},
  author: null,
  external_id: null,
  occurred_at: at,
  received_at: at,
});

const events = [
  ev("change", "2026-10-15T01:50:00.000Z", "3 commits pushed to main"),
  ev("deploy", "2026-10-15T01:58:00.000Z", "Deployed a1b2c3d to production"),
  ev("error", "2026-10-15T02:01:00.000Z", "TypeError: cart.items is undefined"),
  ev("deploy", "2026-10-15T02:30:00.000Z", "Deployed 9f8e7d6 to production"),
  ev("recovery", "2026-10-15T02:35:00.000Z", "Error rate back to normal"),
];

describe("buildPostmortemPrompt", () => {
  it("includes metadata, a UTC timeline and the notes inside tags", () => {
    const prompt = buildPostmortemPrompt(incident, events, "Rolled back to v1.4.2");
    expect(prompt).toContain("Severity: SEV1");
    expect(prompt).toContain("02:01 UTC [github/error] TypeError: cart.items is undefined");
    expect(prompt).toMatch(/<responder_notes>\nRolled back to v1.4.2\n<\/responder_notes>/);
  });

  it("says so when there are no notes", () => {
    expect(buildPostmortemPrompt(incident, [], "  ")).toContain("(no notes were written)");
  });
});

describe("templatePostmortem", () => {
  it("points at the last change before the first error, not later deploys", () => {
    const draft = templatePostmortem(incident, events, "");
    expect(draft.rootCause).toContain("Deployed a1b2c3d to production");
    expect(draft.resolution).toContain("02:35 UTC");
    expect(() => PostmortemSchema.parse(draft)).not.toThrow();
  });
});

describe("generateWithClaude", () => {
  const fakeClient = (reply: { stop_reason: string; text: string }) => {
    const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: MODEL,
          content: [{ type: "text", text: reply.text }],
          stop_reason: reply.stop_reason,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    return { client: new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 }), requests };
  };

  it("asks for schema-constrained JSON with refusal fallbacks and parses the result", async () => {
    const draft = templatePostmortem(incident, events, "");
    const { client, requests } = fakeClient({ stop_reason: "end_turn", text: JSON.stringify(draft) });

    const result = await generateWithClaude(client, incident, events, "Rolled back");

    expect(result.rootCause).toBe(draft.rootCause);
    const { body, headers } = requests[0];
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(JSON.stringify(body.messages)).toContain("Rolled back");
  });

  it("surfaces refusals as a typed error", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", text: "" });
    await expect(generateWithClaude(client, incident, events, "")).rejects.toBeInstanceOf(PostmortemRefusedError);
  });
});

describe("docToText", () => {
  it("flattens TipTap-style paragraphs and bullet lists", () => {
    const doc = new Y.Doc();
    const root = doc.getXmlFragment("default");
    // Yjs types must be attached to the doc before they're filled in.
    const addParagraph = (parent: Y.XmlFragment | Y.XmlElement, text: string) => {
      const p = new Y.XmlElement("paragraph");
      parent.push([p]);
      p.push([new Y.XmlText(text)]);
    };
    addParagraph(root, "Hypothesis: bad cache key");
    const list = new Y.XmlElement("bulletList");
    root.push([list]);
    for (const text of ["DB CPU at 98%", "Rolled back"]) {
      const item = new Y.XmlElement("listItem");
      list.push([item]);
      addParagraph(item, text);
    }

    expect(docToText(doc)).toBe("Hypothesis: bad cache key\n- DB CPU at 98%\n- Rolled back");
  });
});
