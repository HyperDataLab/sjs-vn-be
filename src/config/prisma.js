import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import logger from "../utils/logger.js";

dotenv.config();

/**
 * Chuẩn hóa Database URL cho Prisma, tự động bổ sung connection_limit và pool_timeout
 * nhằm đồng bộ giới hạn pool kết nối với hạ tầng PostgreSQL.
 */
export const getPrismaDatabaseUrl = () => {
  const rawUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!rawUrl) return rawUrl;

  const poolMax = parseInt(process.env.PRISMA_POOL_MAX || process.env.DB_POOL_MAX || "10", 10);
  const poolTimeout = parseInt(process.env.PRISMA_POOL_TIMEOUT_SECONDS || "10", 10);

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", String(poolMax));
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", String(poolTimeout));
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const resolvedDatasourceUrl = getPrismaDatabaseUrl();

const prisma = new PrismaClient({
  datasources: resolvedDatasourceUrl ? { db: { url: resolvedDatasourceUrl } } : undefined,
  log:
    process.env.NODE_ENV === "development" && process.env.DEBUG_PRISMA === "true"
      ? ["query", "info", "warn", "error"]
      : ["error"],
});

/**
 * Ngắt kết nối Prisma Client an toàn khi ứng dụng shutdown (Graceful Shutdown)
 */
export const closePrisma = async () => {
  try {
    await prisma.$disconnect();
    logger.info("Prisma Client đã ngắt kết nối an toàn.");
  } catch (err) {
    logger.error("Lỗi khi ngắt kết nối Prisma Client:", err);
  }
};

/**
 * Kiểm tra trạng thái kết nối và phản hồi của Prisma Client
 * @returns {Promise<{ status: 'healthy'|'unhealthy', latencyMs?: number, error?: string }>}
 */
export const checkPrismaHealth = async () => {
  const start = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return {
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
};

export default prisma;
