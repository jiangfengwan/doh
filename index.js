/**
 * Cloudflare Worker: Wildcard subdomain proxy to a fixed US-West origin.
 *
 * Use case:
 * - Route: *.gitflare.net/*
 * - All global traffic goes to a fixed backend in US West (single origin).
 *
 * Notes:
 * - This controls Cloudflare -> Origin routing (回源)，不能控制用户进入哪个CF边缘节点。
 * - Keep your backend protected (e.g. only allow CF IPs, or require a secret header).
 */

export default {
  async fetch(request, env, ctx) {
    // 1) Set your fixed US-West origin base URL here
    // Example: "https://us-west-2-entrance.gitflare.net"
    // Must include scheme (https://)
    const BACKEND_BASE = env.BACKEND_BASE || "https://us-west.example.com";

    // Optional: hard timeout (ms) for origin fetch
    const ORIGIN_TIMEOUT_MS = Number(env.ORIGIN_TIMEOUT_MS || 8000);

    const incomingUrl = new URL(request.url);
    const backendBaseUrl = new URL(BACKEND_BASE);

    // 2) Build the backend URL: keep path + query exactly
    const backendUrl = new URL(incomingUrl.pathname + incomingUrl.search, backendBaseUrl);

    // 3) Clone headers and add forwarding headers
    // Important: "Host" is a forbidden header in many fetch environments; don't rely on setting it.
    const headers = new Headers(request.headers);

    // Remove hop-by-hop headers (safer for proxies)
    // (Not exhaustive, but covers common ones)
    headers.delete("connection");
    headers.delete("keep-alive");
    headers.delete("proxy-connection");
    headers.delete("transfer-encoding");
    headers.delete("upgrade");

    // Forward original host info to origin (so one origin can serve many subdomains)
    headers.set("X-Forwarded-Host", incomingUrl.hostname);
    headers.set("X-Forwarded-Proto", incomingUrl.protocol.replace(":", ""));
    headers.set("X-Forwarded-Uri", incomingUrl.pathname + incomingUrl.search);

    // CF provides these already, but keeping explicit is fine
    // (If missing, it won't hurt)
    const cfConnectingIp = request.headers.get("CF-Connecting-IP");
    if (cfConnectingIp) headers.set("X-Real-IP", cfConnectingIp);

    // Optional: add a secret header so your origin can reject direct public requests
    // (RECOMMENDED for security; set env.ORIGIN_SECRET on Worker + check it on your origin)
    if (env.ORIGIN_SECRET) {
      headers.set("X-Worker-Proxy-Secret", env.ORIGIN_SECRET);
    }

    // 4) Prepare request init
    // IMPORTANT: do not manually read/clone body; pass the original request to keep streaming.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("Origin timeout"), ORIGIN_TIMEOUT_MS);

    let res;
    try {
      // Create a new Request to change only the URL, keeping method/body.
      const proxyReq = new Request(backendUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        signal: controller.signal,
      });

      // cf options (optional): you can tune caching behavior here if needed
      res = await fetch(proxyReq, {
        cf: {
          // cacheEverything: false,
          // cacheTtl: 0,
        },
      });
    } catch (err) {
      return new Response(
        `Bad Gateway: failed to reach origin (US-West). ${String(err)}`,
        { status: 502 }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // 5) Return response to client (preserve status/headers/body)
    // Remove hop-by-hop headers from response too
    const outHeaders = new Headers(res.headers);
    outHeaders.delete("connection");
    outHeaders.delete("keep-alive");
    outHeaders.delete("proxy-connection");
    outHeaders.delete("transfer-encoding");
    outHeaders.delete("upgrade");

    // Optional: expose where it was routed to (debug)
    outHeaders.set("X-Proxy-Origin", backendBaseUrl.host);
    outHeaders.set("X-Proxy-Worker", "wildcard-to-usw");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  },
};