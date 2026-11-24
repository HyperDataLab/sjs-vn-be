import { Type } from '@sinclair/typebox';

/**
 * Standard Envelope Response Schema Helper
 * @template T
 * @param {T} dataSchema
 * @param {any} [metaSchema]
 */
export const createSuccessResponseSchema = (dataSchema, metaSchema) => {
  const properties = {
    success: Type.Literal(true),
    data: dataSchema,
  };

  if (metaSchema) {
    properties.meta = metaSchema;
  }

  return Type.Object(properties);
};

/**
 * Standard RFC 7807 Error Response Schema
 */
export const ProblemDetailsSchema = Type.Object({
  type: Type.Optional(Type.String()),
  title: Type.String(),
  status: Type.Integer(),
  detail: Type.Optional(Type.String()),
  instance: Type.Optional(Type.String()),
  errors: Type.Optional(Type.Array(Type.Object({
    field: Type.String(),
    message: Type.String(),
  }))),
});

/**
 * Standard Pagination Query Schema
 */
export const PaginationQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10 })),
});

/**
 * Standard Pagination Metadata Schema
 */
export const PaginationMetaSchema = Type.Object({
  page: Type.Integer({ minimum: 1 }),
  limit: Type.Integer({ minimum: 1 }),
  total: Type.Integer({ minimum: 0 }),
  total_pages: Type.Integer({ minimum: 1 }),
});

export { Type };
