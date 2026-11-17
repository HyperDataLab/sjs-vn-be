import { describe, test, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pool, {
  poolConfig,
  checkDatabaseHealth,
  closeDatabasePool,
} from "../../../config/database.js";
import prisma, {
  getPrismaDatabaseUrl,
  checkPrismaHealth,
  closePrisma,
} from "../../../config/prisma.js";
import buildApp from "../../../app.js";

describe("Database Connection Pooling & Health Suite", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test("poolConfig has optimal defaults and parses environment variables", () => {
    assert.ok(poolConfig.max > 0, "max pool connections must be positive");
    assert.ok(poolConfig.min >= 0, "min pool connections must be non-negative");
    assert.ok(poolConfig.idleTimeoutMillis >= 1000, "idleTimeoutMillis must be at least 1s");
    assert.ok(poolConfig.connectionTimeoutMillis >= 1000, "connectionTimeoutMillis must be at least 1s");
    assert.ok(poolConfig.maxUses >= 100, "maxUses must be configured for client recycling");
  });

  test("getPrismaDatabaseUrl appends connection_limit and pool_timeout to raw database url", () => {
    const originalUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/mydb";
      process.env.PRISMA_POOL_MAX = "15";
      process.env.PRISMA_POOL_TIMEOUT_SECONDS = "12";

      const resolved = getPrismaDatabaseUrl();
      const parsed = new URL(resolved);

      assert.equal(parsed.searchParams.get("connection_limit"), "15");
      assert.equal(parsed.searchParams.get("pool_timeout"), "12");
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  test("getPrismaDatabaseUrl preserves connection_limit if already configured in URL", () => {
    const originalUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/mydb?connection_limit=25";
      process.env.PRISMA_POOL_MAX = "15";

      const resolved = getPrismaDatabaseUrl();
      const parsed = new URL(resolved);

      assert.equal(parsed.searchParams.get("connection_limit"), "25");
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  test("checkDatabaseHealth returns healthy status with latency and pool statistics", async () => {
    const mockNow = new Date().toISOString();
    mock.method(pool, "query", async () => ({
      rows: [{ ping: 1, server_time: mockNow }],
    }));

    const health = await checkDatabaseHealth();
    assert.equal(health.status, "healthy");
    assert.equal(typeof health.latencyMs, "number");
    assert.equal(health.serverTime, mockNow);
    assert.ok(health.pool);
    assert.equal(typeof health.pool.total, "number");
    assert.equal(typeof health.pool.idle, "number");
    assert.equal(typeof health.pool.waiting, "number");
  });

  test("checkDatabaseHealth returns unhealthy status when pool query fails", async () => {
    mock.method(pool, "query", async () => {
      throw new Error("Connection refused");
    });

    const health = await checkDatabaseHealth();
    assert.equal(health.status, "unhealthy");
    assert.equal(health.error, "Connection refused");
    assert.equal(typeof health.latencyMs, "number");
  });

  test("checkPrismaHealth returns healthy status when prisma ping succeeds", async () => {
    mock.method(prisma, "$queryRawUnsafe", async () => [{ "?column?": 1 }]);

    const health = await checkPrismaHealth();
    assert.equal(health.status, "healthy");
    assert.equal(typeof health.latencyMs, "number");
  });

  test("checkPrismaHealth returns unhealthy status when prisma query fails", async () => {
    mock.method(prisma, "$queryRawUnsafe", async () => {
      throw new Error("Prisma client timeout");
    });

    const health = await checkPrismaHealth();
    assert.equal(health.status, "unhealthy");
    assert.equal(health.error, "Prisma client timeout");
  });

  test("Fastify /health endpoint returns 200 with runtime and database details when healthy", async () => {
    mock.method(pool, "query", async () => ({
      rows: [{ ping: 1, server_time: new Date().toISOString() }],
    }));
    mock.method(prisma, "$queryRawUnsafe", async () => [{ ping: 1 }]);

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.status, "ok");
    assert.ok(body.timestamp);
    assert.equal(typeof body.uptimeSeconds, "number");
    assert.equal(body.database.postgresPool.status, "healthy");
    assert.equal(body.database.prismaClient.status, "healthy");
    assert.ok(body.system.memory.heapUsedMB > 0);
  });

  test("Fastify /api/v1/health endpoint returns 503 degraded when a database component is down", async () => {
    mock.method(pool, "query", async () => {
      throw new Error("PostgreSQL down");
    });
    mock.method(prisma, "$queryRawUnsafe", async () => [{ ping: 1 }]);

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    assert.equal(response.statusCode, 503);
    const body = JSON.parse(response.payload);
    assert.equal(body.status, "degraded");
    assert.equal(body.database.postgresPool.status, "unhealthy");
  });

  test("closeDatabasePool and closePrisma execute idempotently without unhandled rejection", async () => {
    mock.method(pool, "end", async () => {});
    mock.method(prisma, "$disconnect", async () => {});

    await assert.doesNotReject(async () => {
      await closeDatabasePool();
      await closePrisma();
    });
  });
});
