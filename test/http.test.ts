import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/http.js";
import {
  createGenerationClient,
  type GenerationDebugEvent,
  GenerationTimeoutError,
  GenerationTransportError,
} from "../src/index.js";

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
        stage: "submit",
        method: "POST",
        host: "router.neta.art",
        path: "/v1/video/generations",
        responseReceived: false,
        causeName: "ConnectTimeoutError",
        causeCode: "UND_ERR_CONNECT_TIMEOUT",
        causeMessage: "Connect Timeout Error",
        causeAddress: "47.77.179.20",
        causePort: 443,
      },
      cause: expect.any(TypeError),
    });
    expect((error as Error).message).toContain("Generation transport failed stage=submit method=POST");
    expect((error as Error).message).toContain("cause_code=UND_ERR_CONNECT_TIMEOUT");
    expect((error as Error).message).toContain('cause_message="Connect Timeout Error"');
  });

  it("labels task fetch failures as poll transport errors", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = async () => {
      callCount += 1;
      if (callCount === 1) return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
      const cause = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
        syscall: "read",
      });
      throw new TypeError("fetch failed", { cause });
    };

    try {
      const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
      const result = expect(
        client.generate({
          model: "seedance-2-0-fast",
          content: [{ type: "text", text: "hello" }],
          parameters: { poll_interval: 1, max_wait: 30 },
        }),
      ).rejects.toMatchObject({
        name: "GenerationTransportError",
        details: {
          stage: "poll",
          method: "GET",
          path: "/v1/video/generations/task-1",
          causeCode: "ECONNRESET",
          causeSyscall: "read",
        },
      });
      await vi.advanceTimersByTimeAsync(1000);
      await result;
    } finally {
      vi.useRealTimers();
    }
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
          { stage: "submit" },
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
      "/router/v1/video/generations",
      { method: "POST" },
      1_000,
      { stage: "submit" },
    ).catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "GenerationTransportError",
      details: {
        stage: "submit",
        method: "POST",
        path: "/router/v1/video/generations",
        causeCode: "ECONNRESET",
      },
      cause: expect.any(TypeError),
    });
    expect((error as GenerationTransportError).details).not.toHaveProperty("host");
  });

  it("does not classify response debug failures as transport failures", async () => {
    const events: GenerationDebugEvent["type"][] = [];
    const fetchMock = async () => new Response("upstream unavailable", { status: 502 });
    const client = createGenerationClient({
      apiKey: "key",
      debug: {
        enabled: true,
        logger: (event) => {
          events.push(event.type);
          if (event.type === "response") throw new Error("logger failed");
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

    expect(error).toMatchObject({
      name: "GenerationProviderError",
      status: 502,
      body: "upstream unavailable",
    });
    expect(error).not.toBeInstanceOf(GenerationTransportError);
    expect(events).toEqual(["request", "response"]);
  });

  it("does not replace a transport failure when its debug event fails", async () => {
    const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const fetchError = new TypeError("fetch failed", { cause });
    const fetchMock = async () => {
      throw fetchError;
    };
    const client = createGenerationClient({
      apiKey: "key",
      debug: {
        enabled: true,
        logger: (event) => {
          if (event.type === "transport_error") throw new Error("logger failed");
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

    expect(error).toMatchObject({
      name: "GenerationTransportError",
      details: { causeCode: "ECONNRESET", causeMessage: "socket hang up" },
      cause: fetchError,
    });
  });

  it("emits a redacted transport_error debug event", async () => {
    const events: GenerationDebugEvent[] = [];
    const cause = Object.assign(new Error("getaddrinfo EAI_AGAIN router.neta.art"), {
      code: "EAI_AGAIN",
      syscall: "getaddrinfo",
    });
    const fetchMock = async () => {
      throw new TypeError("fetch failed", { cause });
    };
    const client = createGenerationClient({
      apiKey: "secret-key",
      debug: { enabled: true, logger: (event) => events.push(event) },
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      client.generate({
        model: "seedance-2-0-fast",
        content: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toBeInstanceOf(GenerationTransportError);

    expect(events).toContainEqual({
      type: "transport_error",
      url: "https://router.neta.art/v1/video/generations",
      method: "POST",
      elapsedMs: expect.any(Number),
      error: {
        name: "TypeError",
        message: "fetch failed",
        causeName: "Error",
        causeCode: "EAI_AGAIN",
        causeMessage: "getaddrinfo EAI_AGAIN router.neta.art",
        causeSyscall: "getaddrinfo",
      },
    });
    expect(JSON.stringify(events)).not.toContain("secret-key");
  });
});
