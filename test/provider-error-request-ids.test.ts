import { describe, expect, it, vi } from "vitest";
import { createGenerationClient, GenerationProviderError, GenerationTransportError } from "../src/index.js";

const request = { model: "gpt-image-2", content: [{ type: "text" as const, text: "hello" }] };

function clientFor(responses: Array<Response | Error>) {
  const fetchMock = async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  };
  return createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
}

async function rejection(promise: Promise<unknown>): Promise<GenerationProviderError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(GenerationProviderError);
  return error as GenerationProviderError;
}

function routerErrorResponse() {
  // Long provider messages push the ids past any body preview a caller keeps.
  const message = `certificate has expired: ${"https://public.cohub.run/a.png ".repeat(40)}`;
  return new Response(
    JSON.stringify({
      error: { message, type: "upstream_error" },
      new_api: {
        request_id: "router-1",
        request_ids: ["router-1"],
        upstream_request_id: "2026101100000000000000000000000000000001",
        upstream_request_ids: ["2026101100000000000000000000000000000001", "2026101100000000000000000000000000000002"],
      },
    }),
    { status: 500, headers: { "content-type": "application/json", "x-request-id": "router-1" } },
  );
}

describe("provider error request ids", () => {
  it("attaches router and upstream ids from the failed response body", async () => {
    for (const run of [
      (client: ReturnType<typeof clientFor>) => client.generate(request),
      (client: ReturnType<typeof clientFor>) => client.generateResult(request),
    ]) {
      const error = await rejection(run(clientFor([routerErrorResponse()])));
      expect(error.status).toBe(500);
      expect(error.requestId).toBe("router-1");
      expect(error.upstreamRequestIds).toEqual([
        "2026101100000000000000000000000000000001",
        "2026101100000000000000000000000000000002",
      ]);
    }
  });

  it("falls back to response headers for non-JSON error bodies", async () => {
    const error = await rejection(
      clientFor([
        new Response("<html>bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html", "x-request-id": "router-header", "x-oneapi-request-id": "newapi-1" },
        }),
      ]).generate(request),
    );
    expect(error.requestId).toBe("router-header");
    expect(error.upstreamRequestIds).toEqual(["newapi-1"]);
  });

  it("keeps ids of the latest response when the next request fails in transport", async () => {
    vi.useFakeTimers();
    try {
      const client = createGenerationClient({
        apiKey: "key",
        fetch: (async (url: string | URL | Request) => {
          if (String(url).endsWith("/v1/video/generations")) {
            return new Response(JSON.stringify({ task_id: "task-1" }), {
              status: 200,
              headers: { "content-type": "application/json", "x-request-id": "submit-router-id" },
            });
          }
          throw new TypeError("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) });
        }) as typeof fetch,
      });
      const pending = rejection(
        client.generate({
          model: "seedance-2-0-fast",
          content: [{ type: "text", text: "a cat" }],
          parameters: { poll_interval: 1, max_wait: 30 },
        }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      const error = await pending;
      expect(error).toBeInstanceOf(GenerationTransportError);
      expect(error.requestId).toBe("submit-router-id");
      expect(error.upstreamRequestIds).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves ids empty when no response carried any", async () => {
    const error = await rejection(
      clientFor([
        new Response(JSON.stringify({ error: { message: "bad" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ]).generate(request),
    );
    expect(error.requestId).toBeUndefined();
    expect(error.upstreamRequestIds).toEqual([]);
  });
});
