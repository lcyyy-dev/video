# Sub2API 域名接入

OpenFilm 的视频规划器可以不读取本机 ChatGPT 登录态，改为由主进程把请求转发到 Sub2API。Codex 子进程只访问本机临时安全边界，Sub2API 域名和 Key 不会写进 Codex 配置，也不会传给模型。

客户端默认先连接本机 Sub2API：`http://127.0.0.1:8188/v1`。也可以在聊天区底部的连接设置中改成公网固定域名。首次使用仍需填写 Sub2API 用户 Key。

也可以启动客户端前配置以下环境变量：

```text
OPENFILM_SUB2API_BASE_URL=https://你的固定域名/v1
OPENFILM_SUB2API_API_KEY=用户专用的 Sub2API Key
OPENFILM_SUB2API_MODEL=gpt-6.1-sol
```

生产环境必须使用 HTTPS，地址必须以 `/v1` 结尾。开发时如果 Sub2API 在本机 `8188` 端口，可额外设置 `OPENFILM_ALLOW_INSECURE_SUB2API=1`，例如 `http://127.0.0.1:8188/v1`。Key 只放在客户端运行环境或安装器生成的本地配置中，不提交到 Git。

Sub2API 前面需要一个固定入口。免费方案可使用 ngrok 账号分配的固定 `*.ngrok-free.dev` 开发域名，并以 `ngrok http 8188 --url https://你的域名` 启动；隧道重启后域名保持不变。免费计划有流量和请求数限制，适合小规模试用。Cloudflare Quick Tunnel 每次会生成随机域名，不适合这个场景；Cloudflare 固定 Tunnel 需要自己拥有域名。
