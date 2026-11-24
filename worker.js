import dotenv from "dotenv";
import logger from "./src/utils/logger.js";
import {
  startOrcidScanWorker,
  closeOrcidScanWorker,
} from "./src/modules/author/services/orcidScanWorker.service.js";
import { closeOrcidScanQueue } from "./src/modules/author/services/orcidScanQueue.service.js";

dotenv.config();

const startWorkerProcess = async () => {
  logger.info("⚡ [Worker Process] Khởi động Background Workers...");

  try {
    const worker = await startOrcidScanWorker();
    if (worker) {
      logger.info("🚀 [Worker Process] ORCID Scan Worker đã sẵn sàng nhận jobs.");
    } else {
      logger.warn("⚠️ [Worker Process] ORCID Scan Worker chạy ở chế độ fallback hoặc Redis chưa sẵn sàng.");
    }
  } catch (err) {
    logger.error("❌ [Worker Process] Không thể khởi động ORCID Scan Worker:", err);
    process.exit(1);
  }

  const shutdown = async (signal) => {
    logger.info(`\n🛑 [Worker Process] Nhận tín hiệu ${signal || "SHUTDOWN"}, đang dừng Worker an toàn...`);

    const forceTimer = setTimeout(() => {
      logger.error("⚠️ [Worker Process] Quá thời gian chờ shutdown (10s), buộc dừng tiến trình.");
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    try {
      await Promise.allSettled([
        closeOrcidScanWorker(),
        closeOrcidScanQueue(),
      ]);
      logger.info("✅ [Worker Process] Workers và Queues đã được đóng an toàn.");
    } catch (err) {
      logger.error("❌ [Worker Process] Lỗi khi đóng Workers:", err);
    }

    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
};

startWorkerProcess();
