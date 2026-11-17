import buildApp from "./src/app.js";
import dotenv from "dotenv";

// Hỗ trợ serialize BigInt (được trả về bởi Prisma COUNT/AVG) sang String khi gửi qua API
BigInt.prototype.toJSON = function () {
  return this.toString();
};

import {
  closeOrcidScanWorker,
  startOrcidScanWorker,
} from "./src/modules/author/services/orcidScanWorker.service.js";
import { closeOrcidScanQueue } from "./src/modules/author/services/orcidScanQueue.service.js";
import { closeDatabasePool } from "./src/config/database.js";
import { closePrisma } from "./src/config/prisma.js";

import { warmArticleDiscoveryCache } from "./src/modules/article/services/articleDiscoveryCache.service.js";

dotenv.config();
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Server đang chạy trên: http://localhost:${PORT}`);
    // Warmup in-memory cache in background
    warmArticleDiscoveryCache()
      .then((res) => {
        if (!res.skipped) {
          console.log(`⚡ Discovery cache warmed up in ${res.durationMs}ms`);
        }
      })
      .catch((err) => console.error("Cache warmup error:", err));

    // Start background ORCID Scan Worker (BullMQ)
    try {
      startOrcidScanWorker();
      console.log("⚡ ORCID Scan Worker started");
    } catch (workerErr) {
      console.error("Failed to start ORCID Scan Worker:", workerErr);
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal) => {
    console.log(`\n🛑 Nhận tín hiệu ${signal || 'SHUTDOWN'}, đang giải phóng tài nguyên an toàn...`);
    const forceTimer = setTimeout(() => {
      console.error('⚠️ Quá thời gian chờ shutdown (10s), buộc dừng ứng dụng.');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    try {
      await Promise.allSettled([
        closeOrcidScanWorker(),
        closeOrcidScanQueue(),
      ]);
      console.log('✅ Background Workers và Queues đã đóng an toàn.');
    } catch (workerErr) {
      console.error('Lỗi khi đóng Workers:', workerErr);
    }

    try {
      await app.close();
      console.log('✅ Fastify server đã đóng.');
    } catch (closeErr) {
      console.error('Lỗi khi đóng Fastify server:', closeErr);
    }

    await Promise.allSettled([
      closeDatabasePool(),
      closePrisma(),
    ]);
    console.log('✅ Đã đóng toàn bộ Database Pool và tài nguyên hoàn tất.');
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
};

startServer();

