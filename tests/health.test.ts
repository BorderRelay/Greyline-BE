import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp({ logger: false });

describe("GET /api/health", () => {
  afterAll(async () => {
    await app.close();
  });

  it("returns a healthy service response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "greyline-be",
    });
  });
});
