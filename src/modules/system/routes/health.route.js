import { checkDatabaseHealth } from "../../../config/database.js";
import { checkPrismaHealth } from "../../../config/prisma.js";

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
      },
    },
    async (request, reply) => reply.status(200).send({ pong: true, time: Date.now() })
  );
};

export default healthRoutes;
