import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { OpenRouter } from "@openrouter/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BadGatewayResponseError,
  BadRequestResponseError,
  type CreateApiAlphaDecisionsRequest,
  createGenerationClient,
  createGenerationClientFromFile,
  type GenerationClientWithResult,
  GenerationConfigError,
  type GenerationDebugEvent,
  noul,
  parseGenerationModelDeclaration,
  RequestAbortedError,
  UnauthorizedResponseError,
} from "../src/index.js";

const LUNA = "openai/gpt-6-luna-decisions";

const request = {
  decisionsRequest: {
    model: LUNA,
    state: { ticket: "I was charged twice.", flags: { z: false, a: null } },
    questions: {
      refund: { type: "noul", instructions: "Does the customer need a refund?" },
      team: { type: "choice", instructions: "Which team?", criteria: { billing: "Charges", technical: null } },
      urgency: { type: "score", instructions: "How urgent?", criteria: ["low", "high"] },
    },
  },
} satisfies CreateApiAlphaDecisionsRequest;

// 网关真实返回的 Decisions 响应：上游字段之外附加 request_id 与结算后的 usage.cost。
const gatewayResponse = {
  answers: {
    refund: { type: "noul", noul: 0.93 },
    team: { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.1 } },
    urgency: { type: "score", score: 0.7, probabilities: { "0": 0.3, "1": 0.7 } },
  },
  id: "gen-dec-1",
  model: "openai/gpt-6-luna-decisions-20261006",
  provider: "OpenAI",
  request_id: "body-request-id",
  usage: { cost: 0.000016, input_tokens: 165, output_tokens: 0 },
};

type Received = { path: string; method: string; headers: IncomingHttpHeaders; body: string };

async function withServer(
  respond: (received: Received, response: ServerResponse) => void,
  run: (origin: string, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = [];
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const entry = {
        path: incoming.url ?? "",
        method: incoming.method ?? "",
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(entry);
      respond(entry, response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP listener has no address");
  try {
    await run(`http://127.0.0.1:${address.port}`, received);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

describe("Luna Decisions", () => {
  it("discovers and roundtrips the Luna declaration without credentials", async () => {
    const client = createGenerationClient();
    const declaration = client.getModel(LUNA);
    expect(declaration?.category).toBe("decision");
    expect(declaration?.adapter.type).toBe("openrouter.decisions");
    expect(declaration?.decisionsExamples?.[0]?.request.model).toBe(LUNA);
    expect(parseGenerationModelDeclaration(client.stringifyModelConfig(LUNA))).toEqual(declaration);
    const fromFile = await createGenerationClientFromFile("models/openai-gpt-6-luna-decisions.yaml");
    expect(fromFile.getModel(LUNA)).toEqual(declaration);
    expectTypeOf(fromFile.decisions).toEqualTypeOf<OpenRouter["alpha"]["decisions"]["create"]>();
    expectTypeOf(fromFile.decisionsResult).toEqualTypeOf<GenerationClientWithResult["decisionsResult"]>();
  });

  it("rejects mismatched entry points and invalid examples before transport", async () => {
    const client = createGenerationClient();
    await expect(client.decisions(request)).rejects.toThrow("apiKey is required");
    await expect(client.decisionsResult(request)).rejects.toThrow("apiKey is required");
    const keyed = createGenerationClient({ apiKey: "local" });
    const jev = { decisionsRequest: { ...request.decisionsRequest, model: "jev-latest" } };
    await expect(keyed.decisions(jev)).rejects.toThrow("Model does not support decisions(): jev-latest");
    await expect(keyed.decisionsResult(jev)).rejects.toThrow("Model does not support decisions(): jev-latest");
    expect(() => keyed.systemOne({ model: LUNA, state: null, questions: { check: noul("Valid?") } })).toThrow(
      "Model does not support systemOne()",
    );
    expect(() => keyed.validate({ model: LUNA, content: [] })).toThrow(`Model ${LUNA} requires decisions()`);
    await expect(keyed.generate({ model: LUNA, content: [] })).rejects.toBeInstanceOf(GenerationConfigError);
    await expect(
      createGenerationClient({ apiKey: "local", includeBuiltinModels: false }).decisions(request),
    ).rejects.toThrow(`Generation model is unavailable: ${LUNA}`);
    const declaration = keyed.getModel(LUNA);
    for (const examples of [null, {}, [null], [{ request: { state: "x", questions: {} } }]]) {
      expect(() =>
        parseGenerationModelDeclaration(JSON.stringify({ ...declaration, decisionsExamples: examples }), "luna.json"),
      ).toThrow("Invalid model declaration");
    }
  });

  it.each([
    "decisions",
    "decisionsResult",
  ] as const)("%s sends the official request body to the gateway's OpenRouter route and returns typed answers", async (method) => {
    await withServer(
      (_received, response) => sendJson(response, 200, gatewayResponse, { "x-oneapi-request-id": "header-request-id" }),
      async (origin, received) => {
        const events: GenerationDebugEvent[] = [];
        const client = createGenerationClient({
          apiKey: "local-http-credential",
          baseUrl: `${origin}/prefix/`,
          debug: { enabled: true, logger: (event) => events.push(event) },
        });
        const callOptions = { headers: { "X-Request-Test": "ordered" } };
        const result =
          method === "decisions"
            ? await client.decisions(request, callOptions)
            : await client.decisionsResult(request, callOptions).then((output) => {
                expect(output).toMatchObject({ requestId: "body-request-id", cost: 0.000016 });
                return output.result;
              });
        expect(result.answers.team).toEqual({ ...gatewayResponse.answers.team });
        expect(result.usage).toEqual({ cost: 0.000016, inputTokens: 165, outputTokens: 0 });
        expect(received).toHaveLength(1);
        const [actual] = received;
        expect(actual?.path).toBe("/prefix/openrouter/api/alpha/decisions");
        expect(actual?.method).toBe("POST");
        expect(actual?.headers.authorization).toBe("Bearer local-http-credential");
        expect(actual?.headers["x-request-test"]).toBe("ordered");
        const body = JSON.parse(actual?.body ?? "");
        expect(body).toEqual(request.decisionsRequest);
        expect(JSON.stringify(body.state)).toBe(JSON.stringify(request.decisionsRequest.state));
        expect(JSON.stringify(events)).not.toContain("local-http-credential");
        expect(events[0]).toMatchObject({ type: "request", body: request.decisionsRequest });
      },
    );
  });

  it("returns header request IDs and omits unavailable metadata", async () => {
    const { request_id: _requestId, ...withoutRequestId } = gatewayResponse;
    const replies: Array<[unknown, Record<string, string>]> = [
      [withoutRequestId, { "x-oneapi-request-id": "header-id" }],
      [{ ...withoutRequestId, usage: { input_tokens: 3, output_tokens: 0 } }, {}],
    ];
    await withServer(
      (_received, response) => {
        const [body, headers] = replies.shift() ?? [];
        sendJson(response, 200, body, headers);
      },
      async (origin) => {
        const client = createGenerationClient({ apiKey: "local", baseUrl: origin });
        expect(await client.decisionsResult(request)).toMatchObject({ requestId: "header-id", cost: 0.000016 });
        const bare = await client.decisionsResult(request);
        expect(bare).not.toHaveProperty("requestId");
        expect(bare).not.toHaveProperty("cost");
      },
    );
  });

  it.each([
    [401, UnauthorizedResponseError],
    [400, BadRequestResponseError],
    [502, BadGatewayResponseError],
  ] as const)("maps gateway status %i to the official error class without retrying", async (status, ErrorClass) => {
    await withServer(
      (_received, response) =>
        sendJson(response, status, {
          error: { code: status, message: `gateway status ${status}`, metadata: { request_id: "error-request-id" } },
        }),
      async (origin, received) => {
        const client = createGenerationClient({ apiKey: "local", baseUrl: origin });
        const error = await client.decisions(request).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ErrorClass);
        expect(error).toMatchObject({
          statusCode: status,
          message: `gateway status ${status}`,
          error: { metadata: { request_id: "error-request-id" } },
        });
        expect(received).toHaveLength(1);
      },
    );
  });

  it("treats an empty server URL as unset and keeps the gateway", async () => {
    await withServer(
      (_received, response) => sendJson(response, 200, gatewayResponse),
      async (origin, received) => {
        const client = createGenerationClient({ apiKey: "local", baseUrl: origin, decisions: { serverURL: "" } });
        await client.decisions(request, { serverURL: "" });
        await client.decisionsResult(request);
        expect(received.map((entry) => entry.path)).toEqual([
          "/openrouter/api/alpha/decisions",
          "/openrouter/api/alpha/decisions",
        ]);
      },
    );
  });

  it("uses a configured OpenRouter server URL and honors cancellation", async () => {
    await withServer(
      () => {},
      async (origin, received) => {
        const client = createGenerationClient({ apiKey: "local", decisions: { serverURL: `${origin}/direct` } });
        const controller = new AbortController();
        const call = client.decisions(request, { signal: controller.signal }).catch((caught: unknown) => caught);
        await expect.poll(() => received.length).toBe(1);
        expect(received[0]?.path).toBe("/direct/api/alpha/decisions");
        controller.abort();
        expect(await call).toBeInstanceOf(RequestAbortedError);
      },
    );
  });
});
