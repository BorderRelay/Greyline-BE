import { Type, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { env, type AppConfig } from "../src/config/env.js";

const apps = new Set<ReturnType<typeof buildApp>>();

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...env,
    NODE_ENV: "test",
    SWAGGER_ENABLED: false,
    ...overrides,
  };
}

function createApp(overrides: Partial<AppConfig> = {}) {
  const app = buildApp({
    config: createConfig(overrides),
  });
  apps.add(app);
  return app;
}

afterEach(async () => {
  await Promise.allSettled(
    [...apps].map(async (app) => {
      await app.close();
    }),
  );
  apps.clear();
});

describe("server baseline", () => {
  it("returns a healthy service response", async () => {
    const app = createApp();

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

  it("returns the standard not found error shape", async () => {
    const app = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/missing-route",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route GET /missing-route not found.",
      },
    });
  });

  it("normalizes validation failures into the common error envelope", async () => {
    const app = createApp();

    app.withTypeProvider<TypeBoxTypeProvider>().post(
      "/api/test/validate",
      {
        schema: {
          body: Type.Object({
            name: Type.String(),
          }),
          response: {
            200: Type.Object({
              ok: Type.Boolean(),
            }),
          },
        },
      },
      () => {
        return { ok: true };
      },
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/test/validate",
      payload: {},
    });

    const payload: {
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    } = response.json();

    expect(response.statusCode).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.message).toBe("Request validation failed.");
    expect(payload.error.fieldErrors).toBeDefined();
  });

  it("exposes swagger ui in development mode", async () => {
    const app = createApp({
      NODE_ENV: "development",
      SWAGGER_ENABLED: true,
    });

    const response = await app.inject({
      method: "GET",
      url: "/documentation",
    });

    expect([200, 302]).toContain(response.statusCode);
  });

  it("does not expose swagger ui when disabled", async () => {
    const app = createApp({
      SWAGGER_ENABLED: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/documentation",
    });

    expect(response.statusCode).toBe(404);
    const payload: { error: { code: string } } = response.json();
    expect(payload.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("fails app bootstrap when the database is unreachable", async () => {
    const app = createApp({
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/greyline?connect_timeout=1",
    });

    await expect(app.ready()).rejects.toThrow();
  });

  it("boots successfully against the reachable database", async () => {
    const app = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
  });
});
