/**
 * Tiện ích chuẩn hóa phân trang và bảo vệ hệ thống khỏi các truy vấn quá tải (DoS protection)
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_PAGE_LIMIT = 100;

/**
 * Chuẩn hóa các tham số phân trang từ request query
 * @param {object} query - Request query object (page, limit, offset, defaultLimit, maxLimit)
 * @param {object} [options]
 * @param {number} [options.defaultLimit=10] - Số lượng bản ghi mặc định trên 1 trang
 * @param {number} [options.maxLimit=100] - Số lượng bản ghi tối đa cho phép trên 1 trang
 * @returns {{ page: number, limit: number, offset: number }}
 */
export const normalizePagination = (query = {}, options = {}) => {
  const defaultLimit = options.defaultLimit || query.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = options.maxLimit || query.maxLimit || MAX_PAGE_LIMIT;

  const rawPage = parseInt(query.page, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : DEFAULT_PAGE;

  const rawLimit = parseInt(query.limit, 10);
  const parsedLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit;
  const limit = Math.min(parsedLimit, maxLimit);

  // Nếu client truyền offset hợp lệ thì ưu tiên, nếu không thì tính từ page
  let offset;
  if (query.offset !== undefined && query.offset !== null && query.offset !== "") {
    const rawOffset = parseInt(query.offset, 10);
    offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : (page - 1) * limit;
  } else {
    offset = (page - 1) * limit;
  }

  return { page, limit, offset };
};

/**
 * Định dạng cấu trúc metadata phân trang chuẩn cho API response
 * @param {number|string} total - Tổng số bản ghi
 * @param {number} page - Trang hiện tại
 * @param {number} limit - Số bản ghi trên trang
 * @returns {{ total: number, page: number, limit: number, total_pages: number }}
 */
export const formatPaginationResponse = (total, page, limit) => {
  const numericTotal = Math.max(0, parseInt(total, 10) || 0);
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(numericTotal / safeLimit));

  return {
    total: numericTotal,
    page: Math.max(1, page),
    limit: safeLimit,
    total_pages: totalPages,
  };
};
