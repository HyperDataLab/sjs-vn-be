import pkg from "pg";
import dotenv from "dotenv";
import logger from "../utils/logger.js";

dotenv.config();

const { Pool } = pkg;

const url = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
const isLocalOrPrivate =
  url.includes("localhost") ||
  url.includes("127.0.0.1") ||
  url.includes("100.") ||
  url.includes("192.168.") ||
  url.includes("10.") ||
  url.includes("172.");

// Cấu hình Connection Pool linh hoạt qua biến môi trường
export const poolConfig = {
  connectionString: url,
  ssl: (!isLocalOrPrivate && url.includes("supabase.com")) ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT_MS, 10) || 5000,
  maxUses: parseInt(process.env.DB_POOL_MAX_USES, 10) || 7500,
};

const pool = new Pool(poolConfig);

// Bắt lỗi rớt kết nối đột ngột của client rảnh rỗi (idle client) trong pool để tránh unhandled error
pool.on("error", (err) => {
  logger.error("Lỗi bất ngờ xảy ra trên client trong pg.Pool:", err);
});

// Chỉ thực hiện ping kiểm tra khi khởi động ở môi trường runtime thực (tránh gây timeout trong unit tests)
if (process.env.NODE_ENV !== "test" && url) {
  pool.query("SELECT NOW()", (err, res) => {
    if (err) {
      logger.error("Ket noi toi PostgreSQL that bai!", err);
    } else {
      logger.db(`Ket noi toi PostgreSQL thanh cong luc: ${res.rows[0].now}`);
    }
  });
}

/**
 * Đóng an toàn toàn bộ kết nối trong pg.Pool khi tắt ứng dụng (Graceful Shutdown)
 */
export const closeDatabasePool = async () => {
  if (pool.ended) return;
  try {
    await pool.end();
    logger.info("pg.Pool đã được đóng an toàn.");
  } catch (err) {
    logger.error("Lỗi khi đóng pg.Pool:", err);
  }
};

/**
 * Kiểm tra trạng thái sức khỏe và độ trễ của kết nối PostgreSQL
 * @returns {Promise<{ status: 'healthy'|'unhealthy'|'down', latencyMs?: number, pool?: object, error?: string }>}
 */
export const checkDatabaseHealth = async () => {
  if (pool.ended) {
    return {
      status: "down",
      message: "Database connection pool is closed",
    };
  }

  const start = Date.now();
  try {
    const res = await pool.query("SELECT 1 as ping, NOW() as server_time");
    return {
      status: "healthy",
      latencyMs: Date.now() - start,
      serverTime: res.rows[0].server_time,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: poolConfig.max,
        min: poolConfig.min,
      },
    };
  } catch (error) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: error.message,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  }
};

export default pool;
