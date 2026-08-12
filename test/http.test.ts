import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/http.js";
import { createGenerationClient, GenerationTimeoutError, GenerationTransportError } from "../src/index.js";

describe("generation HTTP transport errors", () => {
  it("preserves connect timeout diagnostics in the thrown message and details", async () => {
    const cause = Object.assign(new Error("Connect Timeout Error"), {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
      address: "47.77.179.20",
      port: 443,
    });
    const fetchMock = async () => {
      throw new TypeError("fetch failed", { cause });
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const error = await client
      .generate({
        model: "seedance-2-0-fast",
        content: [{ type: "text", text: "hello" }],
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GenerationTransportError);
    expect(error).toMatchObject({
      name: "GenerationTransportError",
      details: {
        method: "POST",
        host: "router.neta.art",
        path: "/v1/video/generations",
        causeName: "ConnectTimeoutError",
        causeCode: "UND_ERR_CONNECT_TIMEOUT",
        causeAddress: "47.77.179.20",
        causePort: 443,
      },
      cause: expect.any(TypeError),
    });
    expect((error as Error).message).toContain("Generation transport failed method=POST");
    expect((error as Error).message).toContain("cause_code=UND_ERR_CONNECT_TIMEOUT");
  });

  it("keeps SDK-owned aborts classified as timeouts", async () => {
    vi.useFakeTimers();
    const fetchMock = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });

    try {
      const request = expect(
        fetchWithTimeout(
          fetchMock as typeof fetch,
          "https://router.neta.art/v1/video/generations",
          { method: "POST" },
          100,
        ),
      ).rejects.toBeInstanceOf(GenerationTimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await request;
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves relative request targets when transport diagnostics are built", async () => {
    const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const fetchMock = async () => {
      throw new TypeError("fetch failed", { cause });
    };
    const error = await fetchWithTimeout(
      fetchMock as typeof fetch,
      "/router/v1/video/generations?token=secret#diagnostic",
      { method: "POST" },
      1_000,
    ).catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "GenerationTransportError",
      details: {
        method: "POST",
        path: "/router/v1/video/generations",
        causeCode: "ECONNRESET",
      },
      cause: expect.any(TypeError),
    });
    expect((error as GenerationTransportError).details).not.toHaveProperty("host");
    expect((error as Error).message).not.toContain("secret");
  });

  it("removes query credentials from absolute transport error targets", async () => {
    const cause = Object.assign(
      new Error("socket hang up https://router.neta.art/v1/video/generations?token=secret&signature=private"),
      { code: "ECONNRESET" },
    );
    const fetchMock = async () => {
      throw new TypeError("fetch failed", { cause });
    };
    const error = await fetchWithTimeout(
      fetchMock as typeof fetch,
      "https://router.neta.art/v1/video/generations?token=secret&signature=private#diagnostic",
      { method: "POST" },
      1_000,
    ).catch((value: unknown) => value);

    expect(error).toMatchObject({
      details: {
        host: "router.neta.art",
        path: "/v1/video/generations",
      },
    });
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain("private");
    expect((error as GenerationTransportError).details).not.toHaveProperty("causeMessage");
  });

  it("keeps response debug failures out of transport error classification", async () => {
    const loggerError = new Error("logger failed");
    const fetchMock = async () => new Response("upstream unavailable", { status: 502 });
    const client = createGenerationClient({
      apiKey: "key",
      debug: {
        enabled: true,
        logger: (event) => {
          if (event.type === "response") throw loggerError;
        },
      },
      fetch: fetchMock as typeof fetch,
    });

    const error = await client
      .generate({
        model: "seedance-2-0-fast",
        content: [{ type: "text", text: "hello" }],
      })
      .catch((value: unknown) => value);

    expect(error).toBe(loggerError);
    expect(error).not.toBeInstanceOf(GenerationTransportError);
  });
});
