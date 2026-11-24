import { checkDatabaseHealth } from "../../../config/database.js";
import { checkPrismaHealth } from "../../../config/prisma.js";
import { Type } from "../../../utils/schema.js";

const PostgresPoolHealthSchema = Type.Object({
  status: Type.String(),
  latencyMs: Type.Optional(Type.Number()),
  serverTime: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  pool: Type.Optional(Type.Any()),
  message: Type.Optional(Type.String()),
});

const PrismaClientHealthSchema = Type.Object({
  status: Type.String(),
  latencyMs: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
});

const HealthResponseSchema = Type.Object({
  status: Type.String(),
  timestamp: Type.String(),
  uptimeSeconds: Type.Number(),
  database: Type.Object({
    postgresPool: PostgresPoolHealthSchema,
    prismaClient: PrismaClientHealthSchema,
  }),
  system: Type.Object({
    memory: Type.Object({
      rssMB: Type.Number(),
      heapUsedMB: Type.Number(),
      heapTotalMB: Type.Number(),
    }),
    nodeVersion: Type.String(),
  }),
});

const PingResponseSchema = Type.Object({
  pong: Type.Boolean(),
  time: Type.Number(),
});

/**
 * Route kiểm tra sức khỏe hệ thống, kết nối cơ sở dữ liệu và tài nguyên runtime
 * Hỗ trợ các công cụ giám sát (Kubernetes probes, Docker healthcheck, uptime monitors)
 */
const healthRoutes = async (fastify) => {
  const handleHealthCheck = async (request, reply) => {
    const [pgResult, prismaResult] = await Promise.all([
      checkDatabaseHealth(),
      checkPrismaHealth(),
    ]);

    const isHealthy = pgResult.status === "healthy" && prismaResult.status === "healthy";
    const statusCode = isHealthy ? 200 : 503;

    const mem = process.memoryUsage();

    return reply.status(statusCode).send({
      status: isHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        postgresPool: pgResult,
        prismaClient: prismaResult,
      },
      system: {
        memory: {
          rssMB: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
          heapUsedMB: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
          heapTotalMB: Math.round((mem.heapTotal / (1024 * 1024)) * 10) / 10,
        },
        nodeVersion: process.version,
      },
    });
  };

  fastify.get(
    "/",
    {
      schema: {
        description: "Kiểm tra tình trạng hoạt động và kết nối Database/Prisma",
        summary: "Database & System Health Check",
        response: {
          200: HealthResponseSchema,
          503: HealthResponseSchema,
        },
      },
    },
    handleHealthCheck
  );

  fastify.get(
    "/ping",
    {
      schema: {
        description: "Kiểm tra nhanh phản hồi liveness của server",
        summary: "Liveness Ping",
        response: {
          200: PingResponseSchema,
        },
      },
    },
    async (request, reply) => reply.status(200).send({ pong: true, time: Date.now() })
  );
};

export default healthRoutes;
