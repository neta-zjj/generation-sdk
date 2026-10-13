import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createGenerationClient } from "../../src/index.js";

const model = process.env.LUNA_MODEL ?? "openai/gpt-6-luna-decisions";

function createLiveClient() {
  const apiKey = process.env.LUNA_API_KEY;
  const serverURL = process.env.LUNA_SERVER_URL;
  if (!apiKey || !serverURL) throw new Error("LUNA_API_KEY and LUNA_SERVER_URL are required");
  return createGenerationClient({
    apiKey,
    decisions: { serverURL, timeoutMs: 120_000, retryConfig: { strategy: "none" } },
  });
}

it("evaluates text questions with typed answers and billing metadata", async () => {
  const { result, cost, requestId } = await createLiveClient().decisionsResult({
    decisionsRequest: {
      model,
      state: {
        ticket: "I was charged twice for my subscription. Please refund the duplicate charge.",
        enabled: false,
        optional: null,
      },
      questions: {
        refund: { type: "noul", instructions: "Is the customer asking for a refund?" },
        team: { type: "choice", instructions: "Which team?", criteria: { billing: "Charges", technical: "Bugs" } },
        urgency: { type: "score", instructions: "How urgent?", criteria: ["Can wait", "Needs attention"] },
      },
    },
  });
  expect(result.model).toBeTruthy();
  const { refund, team, urgency } = result.answers;
  expect(refund?.type === "noul" && refund.noul).toBeGreaterThanOrEqual(0.5);
  expect(team?.type === "choice" && team.choice).toBe("billing");
  expect(urgency?.type === "score" && urgency.score).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(result.usage.inputTokens)).toBe(true);
  expect(result.usage.inputTokens).toBeGreaterThan(0);
  expect(cost).toBe(result.usage.cost);
  expect(requestId).toBeTruthy();
}, 130_000);

it("evaluates a PNG image in state", async () => {
  const png = await readFile(new URL("./fixtures/red-square.png", import.meta.url));
  const result = await createLiveClient().decisions({
    decisionsRequest: {
      model,
      state: [
        "Inspect this image.",
        { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
      ],
      questions: { red: { type: "noul", instructions: "Does this image show a red square on a white background?" } },
    },
  });
  const red = result.answers.red;
  expect(red?.type === "noul" && red.noul).toBeGreaterThan(0.8);
}, 130_000);
