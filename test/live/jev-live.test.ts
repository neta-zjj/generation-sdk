import { expect, it } from "vitest";
import { choice, createGenerationClient, noul, score } from "../../src/index.js";
import { extractGenerationResultFields } from "../../src/response-fields.js";

it("evaluates typed questions through the configured System One endpoint", async () => {
  const apiKey = process.env.JEV_API_KEY;
  const baseURL = process.env.JEV_BASE_URL;
  if (!apiKey || !baseURL) throw new Error("JEV_API_KEY and JEV_BASE_URL are required");
  const client = createGenerationClient({
    apiKey,
    systemOne: { baseURL, timeout: 60_000, retry: { maxRetries: 0 } },
  });
  const call = client.systemOne({
    model: process.env.JEV_MODEL ?? "jev-latest",
    state: { ticket: "I was charged twice for my subscription.", enabled: false, optional: null },
    questions: {
      refund: noul("Does the customer need a refund?"),
      team: choice("Which team?", { billing: "Charges and refunds", technical: "Bugs and outages" }),
      urgency: score("How urgent?", ["Can wait", "Needs attention"]),
    },
  });
  const { data, response } = await call.withResponse();
  expect(response.status).toBe(200);
  expect(data.model).toBeTruthy();
  expect(data.answers.refund.noul).toBeGreaterThanOrEqual(0);
  expect(data.answers.refund.noul).toBeLessThanOrEqual(1);
  expect(["billing", "technical"]).toContain(data.answers.team.choice);
  expect(data.answers.urgency.score).toBeGreaterThanOrEqual(0);
  expect(data.answers.urgency.score).toBeLessThanOrEqual(1);
  expect(Number.isInteger(data.usage.input_tokens)).toBe(true);
  expect(data.usage.input_tokens).toBeGreaterThan(0);
  expect(data.usage.output_tokens).toBeGreaterThanOrEqual(0);
}, 70_000);

it("returns each concurrent call's observed billing metadata", async () => {
  const apiKey = process.env.JEV_API_KEY;
  const baseURL = process.env.JEV_BASE_URL;
  if (!apiKey || !baseURL) throw new Error("JEV_API_KEY and JEV_BASE_URL are required");
  const responses = new Map<string, { body: unknown; headers: Headers }>();
  const client = createGenerationClient({
    apiKey,
    systemOne: { baseURL, timeout: 60_000, retry: { maxRetries: 0 } },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const callId = new Headers(init?.headers).get("X-Generation-Test-Call");
      if (!callId) throw new Error("The per-call header is missing");
      responses.set(callId, { body: await response.clone().json(), headers: response.headers });
      return response;
    },
  });
  const results = await Promise.all(
    ["billing", "technical"].map(async (team) => {
      const output = await client.systemOneResult(
        {
          model: process.env.JEV_MODEL ?? "jev-latest",
          state: { team },
          questions: { team: choice("Which team is named in the state?", { billing: null, technical: null }) },
        },
        { headers: { "X-Generation-Test-Call": team } },
      );
      const observed = responses.get(team);
      if (!observed) throw new Error(`No response was observed for ${team}`);
      const fields = extractGenerationResultFields(observed.body);
      const requestId =
        fields?.requestId ??
        (observed.headers.get("x-request-id")?.trim() || undefined) ??
        (observed.headers.get("x-oneapi-request-id")?.trim() || undefined);
      expect(output.result).toEqual(observed.body);
      expect(output.result.answers.team.choice).toBe(team);
      expect(output.cost).toBe(fields?.cost);
      expect(output.requestId).toBe(requestId);
      if (fields?.cost === undefined) expect(output).not.toHaveProperty("cost");
      if (requestId === undefined) expect(output).not.toHaveProperty("requestId");
      return output;
    }),
  );
  expect(responses.size).toBe(2);
  const requestIds = results.flatMap((output) => (output.requestId ? [output.requestId] : []));
  expect(new Set(requestIds).size).toBe(requestIds.length);
}, 70_000);
