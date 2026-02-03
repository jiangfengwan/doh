export default {
    async fetch(request, env, ctx) {
        // 1. 定义目标域名
        const TARGET_DOMAIN = 'b.gitflare.net';
        
        // 2. 解析当前请求的 URL
        const url = new URL(request.url);
        
        // 3. 修改 URL 的 hostname 为目标域名
        // 这样 /path?query 都会被自动保留，只是域名变了
        url.hostname = TARGET_DOMAIN;
        url.protocol = 'https:'; // 强制使用 HTTPS

        // 4. 构建新的 Request 对象
        // 必须创建一个新对象，因为原始 request 的某些属性是只读的
        const newRequest = new Request(url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            redirect: 'follow' // 跟随目标网站的重定向
        });

        // 5. 关键步骤：伪装头部 (Header Rewriting)
        // Cloudflare 的很多站点会检查 Host 和 Referer，如果不对会拒绝访问
        newRequest.headers.set('Host', TARGET_DOMAIN);
        newRequest.headers.set('Referer', `https://${TARGET_DOMAIN}/`);
        // 可选：设置 User-Agent 防止被某些反爬规则拦截（通常保留原始 UA 即可，如有问题可取消注释）
        // newRequest.headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 6. 发起请求并返回响应
        try {
            const response = await fetch(newRequest);

            // 7. 处理返回的响应
            // 我们需要重新构建响应，以便处理跨域(CORS)或修改某些头部（如果需要）
            // 这里直接透传大部分内容
            const newResponseHeaders = new Headers(response.headers);
            
            // 可选：如果你需要允许跨域访问，可以取消下面这行的注释
            // newResponseHeaders.set('Access-Control-Allow-Origin', '*');

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newResponseHeaders
            });
            
        } catch (e) {
            // 出错处理
            return new Response('Proxy Error: ' + e.message, { status: 500 });
        }
    }
};
