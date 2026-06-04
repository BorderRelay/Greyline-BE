import Fastify, { type FastifySchemaValidationError, type FastifyServerOptions } from "fastify";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

import { env, type AppConfig } from "./config/env.js";
import { AppError, isAppError } from "./lib/app-error.js";
import { authContextPlugin } from "./plugins/auth-context.js";
import { corsPlugin } from "./plugins/cors.js";
import { dbPlugin } from "./plugins/db.js";
import { openApiPlugin } from "./plugins/openapi.js";
import { sensiblePlugin } from "./plugins/sensible.js";
import { registerRoutes } from "./routes/index.js";

export type BuildAppOptions = {
  config?: AppConfig;
  serverOptions?: FastifyServerOptions;
};

type ValidationError = Error & {
  validation: FastifySchemaValidationError[];
  validationContext?: string;
};

type HttpishError = Error & {
  statusCode?: number;
  code?: string;
};

function isValidationError(error: unknown): error is ValidationError {
  return (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Array.isArray((error as { validation?: unknown }).validation)
  );
}

function formatValidationErrors(errors: FastifySchemaValidationError[]) {
  return errors.reduce<Record<string, string[]>>((accumulator, error) => {
    const params = error.params;
    const missingProperty =
      typeof params.missingProperty === "string" ? params.missingProperty : undefined;
    const key = error.instancePath || missingProperty || "request";
    accumulator[key] ??= [];
    accumulator[key].push(error.message ?? "Invalid value.");
    return accumulator;
  }, {});
}

function buildErrorPayload(error: AppError | Error, fallbackStatusCode = 500) {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          fieldErrors: error.fieldErrors,
        },
      },
    };
  }

  return {
    statusCode: fallbackStatusCode,
    body: {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    },
  };
}

export function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? env;
  const logger =
    options.serverOptions?.logger ??
    (config.NODE_ENV === "test"
      ? false
      : {
          level: config.LOG_LEVEL,
        });

  const app = Fastify({
    ...options.serverOptions,
    logger,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  app.register(corsPlugin, { config });
  app.register(sensiblePlugin);
  app.register(dbPlugin, { config });
  app.register(authContextPlugin);
  app.register(openApiPlugin, { config });
  app.register(registerRoutes);

  app.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found.`,
      },
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (isValidationError(error)) {
      request.log.warn(
        {
          validationContext: error.validationContext,
          validation: error.validation,
        },
        "Request validation failed.",
      );

      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          fieldErrors: formatValidationErrors(error.validation),
        },
      });
    }

    const httpError = error as HttpishError;
    const payload = buildErrorPayload(
      isAppError(error)
        ? error
        : new AppError(
            httpError.statusCode && httpError.statusCode >= 400 ? httpError.statusCode : 500,
            httpError.code ?? "INTERNAL_SERVER_ERROR",
            httpError.statusCode && httpError.statusCode >= 400
              ? httpError.message
              : "An unexpected error occurred.",
          ),
      500,
    );

    if (payload.statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled request error.");
    } else {
      request.log.warn({ err: error }, "Handled request error.");
    }

    return reply.status(payload.statusCode).send(payload.body);
  });

  return app;
}
