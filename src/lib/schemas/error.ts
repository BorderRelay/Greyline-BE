import { Type } from "@fastify/type-provider-typebox";

export const FieldErrorsSchema = Type.Record(Type.String(), Type.Array(Type.String()));

export const ErrorBodySchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  fieldErrors: Type.Optional(FieldErrorsSchema),
});

export const ErrorEnvelopeSchema = Type.Object({
  error: ErrorBodySchema,
});
