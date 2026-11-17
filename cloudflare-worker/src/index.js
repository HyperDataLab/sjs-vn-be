/**
 * Cloudflare Worker: ResearchPulse Media CDN & Edge Cache
 *
 * Nhiệm vụ:
 * 1. Đóng vai trò Reverse Proxy & Edge Cache Shield phía trước Firebase Storage.
 * 2. Caching tệp tĩnh (PDF bài báo, Avatar, Báo cáo) tại Edge Server của Cloudflare.
 * 3. Triệt tiêu 100% chi phí Egress Bandwidth của Firebase Storage khi người dùng đọc tài liệu.
 * 4. Hỗ trợ Range Requests (HTTP 206) để streaming và xem trước PDF mượt mà trên browser.
 */

// Bảng tra cứu MIME type dựa trên phần mở rộng file
const MIME_MAP = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  json: 'application/json',
};

const getContentType = (filePath, originContentType) => {
  if (originContentType && originContentType !== 'application/octet-stream') {
    return originContentType;
  }
  const ext = filePath.split('.').pop()?.toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
};

const buildCorsHeaders = (origin = '*') => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range, Authorization',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, ETag, Accept-Ranges, X-Edge-Cache',
  'Access-Control-Max-Age': '86400',
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHeader = request.headers.get('Origin') || '*';
    const corsHeaders = buildCorsHeaders(env.ALLOWED_ORIGINS === '*' ? '*' : originHeader);

    // 1. Xử lý CORS Preflight (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 2. Chỉ cho phép phương thức GET và HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(JSON.stringify({
        error: 'Method Not Allowed',
        message: 'Cloudflare Worker Media CDN chỉ phục vụ các yêu cầu GET và HEAD',
      }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // 3. Endpoint kiểm tra sức khỏe (Health Check)
    if (url.pathname === '/health' || url.pathname === '/_health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'researchpulse-media-cdn',
        bucket: env.FIREBASE_STORAGE_BUCKET || 'default',
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // 4. Chuẩn hóa đường dẫn tệp tin
    const rawPath = url.pathname.replace(/^\/+/, '');
    if (!rawPath) {
      return new Response(JSON.stringify({
        service: 'ResearchPulse Media CDN',
        description: 'Cloudflare Worker Edge Cache Shield for Firebase Storage',
        usage: 'Truy cập theo đường dẫn /articles/<file>, /avatars/<file>, /reports/<file>',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders,
        },
      });
    }

    // Kiểm tra an toàn: ngăn chặn Path Traversal
    const rawUrlString = request.url;
    if (rawUrlString.includes('..') || rawUrlString.toLowerCase().includes('%2e%2e') || rawPath.includes('..') || rawPath.includes('//')) {
      return new Response(JSON.stringify({
        error: 'Bad Request',
        message: 'Đường dẫn tệp tin không hợp lệ',
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    const objectPath = decodeURIComponent(rawPath);
    const ALLOWED_PREFIXES = env.ALLOWED_FOLDERS
      ? env.ALLOWED_FOLDERS.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean)
      : ['articles', 'avatars', 'reports'];
    const rootFolder = objectPath.split('/')[0];
    if (!ALLOWED_PREFIXES.includes(rootFolder)) {
      return new Response(JSON.stringify({
        error: 'Bad Request',
        message: `Thư mục truy cập không hợp lệ. Chỉ chấp nhận: ${ALLOWED_PREFIXES.join(', ')}`,
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }
    const bucket = env.FIREBASE_STORAGE_BUCKET || 'scientificjournalsystem.appspot.com';
    const cacheTtl = parseInt(env.CACHE_TTL_SECONDS, 10) || 2592000; // 30 ngày

    // 5. Kiểm tra Edge Cache của Cloudflare
    const hasRangeHeader = Boolean(request.headers.get('Range'));
    // Lưu ý: Cloudflare Cache API không tự động lưu Range Requests, chỉ cache full response
    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const cacheKey = new Request(url.toString(), request);

    if (cache && !hasRangeHeader && request.method === 'GET') {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const responseWithHit = new Response(cachedResponse.body, cachedResponse);
        responseWithHit.headers.set('X-Edge-Cache', 'HIT');
        responseWithHit.headers.set('CF-Cache-Status', 'HIT');
        Object.entries(corsHeaders).forEach(([k, v]) => responseWithHit.headers.set(k, v));
        return responseWithHit;
      }
    }

    // 6. Cache MISS -> Fetch tệp gốc từ Firebase Storage
    // URL REST API chuẩn của Firebase Storage:
    const firebaseOriginUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;

    const originHeaders = new Headers();
    // Chuyển tiếp các header quan trọng như Range, If-None-Match
    const forwardHeaders = ['range', 'if-none-match', 'if-modified-since'];
    forwardHeaders.forEach((headerName) => {
      const val = request.headers.get(headerName);
      if (val) originHeaders.set(headerName, val);
    });

    let originResponse;
    try {
      originResponse = await fetch(firebaseOriginUrl, {
        method: request.method,
        headers: originHeaders,
      });
    } catch (fetchError) {
      return new Response(JSON.stringify({
        error: 'Bad Gateway',
        message: 'Không thể kết nối tới kho lưu trữ gốc Firebase: ' + fetchError.message,
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // 7. Xử lý trường hợp không tìm thấy tệp (404)
    if (originResponse.status === 404) {
      return new Response(JSON.stringify({
        error: 'Not Found',
        message: `Tệp tin không tồn tại: ${objectPath}`,
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60', // Cache 404 ngắn để tránh DDOS
          ...corsHeaders,
        },
      });
    }

    // Nếu origin trả lỗi khác (403, 500...)
    if (!originResponse.ok && originResponse.status !== 304 && originResponse.status !== 206) {
      return new Response(originResponse.body, {
        status: originResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': originResponse.headers.get('Content-Type') || 'application/json',
        },
      });
    }

    // 8. Chuẩn bị Response trả về cho Client với Header tối ưu
    const contentType = getContentType(objectPath, originResponse.headers.get('Content-Type'));
    const responseHeaders = new Headers(originResponse.headers);

    // Gán CORS
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

    // Gán Content-Type chuẩn
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('X-Edge-Cache', 'MISS');

    // Thiết lập Content-Disposition: inline để trình duyệt mở trực tiếp file PDF
    if (contentType === 'application/pdf') {
      const fileName = objectPath.split('/').pop() || 'document.pdf';
      responseHeaders.set('Content-Disposition', `inline; filename="${fileName}"`);
    }

    // Thiết lập bộ nhớ đệm biên lâu dài (Immutable)
    responseHeaders.set('Cache-Control', `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}, immutable`);

    const clientResponse = new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders,
    });

    // 9. Lưu vào Edge Cache nếu là full GET request (HTTP 200) và không có Range header
    if (cache && originResponse.status === 200 && request.method === 'GET' && !hasRangeHeader) {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(cache.put(cacheKey, clientResponse.clone()));
      }
    }

    return clientResponse;
  },
};
