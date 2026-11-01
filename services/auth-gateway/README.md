# OpenFilm 授权网关

Keygen CE 保持上游代码不变，仓库位于 `/home/lvcy/keygen-api`。网关单独部署，负责设备授权、凭证续期、用户 Key 映射和 Responses 流式转发。额度仍由 sub2api 管理。

## 可视化管理

- 中文授权及 Key 映射管理页：`http://127.0.0.1:8790`
- 官方 Keygen Portal：`http://127.0.0.1:8791`
- sub2api 后台：`http://127.0.0.1:8189`

两个授权管理页使用同一个 Keygen 管理员账号。当前本机登录信息保存在被 Git 忽略的 `data/admin-login.txt`（来源为 `.env.keygen`）。这些页面仅限服务电脑本机访问，不通过 SakuraFrp 公网隧道开放。

日常发码：先在 sub2api 创建用户独立 Key 和额度，再进入中文管理页填写用户备注、选择策略、粘贴用户 Key，点击“生成激活码并保存映射”。把生成的激活码发给用户即可。

列表支持查看激活码、替换 Key（留空保留）、查看和解绑设备、停用/恢复授权、移除映射。保存的 sub2api Key 不会返回浏览器。修改映射立即用于后续请求，无需重启网关；限额和用量继续在 sub2api 管理。官方 Portal 提供产品、策略及许可证的更完整管理，映射以中文管理页为准。

中文管理服务独立于公网网关进程，管理员通过 Keygen 账号登录，使用 HttpOnly 会话 Cookie、同源校验及 CSRF Token。只有管理服务拥有映射目录写权限，模型网关仍只读。管理员会话八小时有效；服务重启后需重新登录。

当前 Linux/WSL 启动全部管理页面：

```sh
docker compose -f compose.yaml -f compose.host.yaml -f compose.portal.yaml -f compose.portal-host.yaml up -d --build
```

官方 Portal 仓库位于 `/home/lvcy/keygen-portal`。构建依赖使用其 pnpm 安装，运行 `pnpm run build`。本地 `.env.local` 设置 `VITE_KEYGEN_HOST=127.0.0.1:8791`、`VITE_KEYGEN_PROTOCOL=http`，以及 CE、singleplayer、账户 ID、API 版本 1.8。Portal 两个 API 地址构造点增加了可配置协议（默认仍 HTTPS），补丁保存在 `portal-local-http.patch`；Keygen API 仓库无修改。

网关 `.env` 中的 `PORTAL_DIST` 是宿主机 Portal 构建目录，容器内固定挂载 `/portal`。Windows 部署时设置成实际 Windows 路径，并使用适用的 Docker Desktop 内部网络配置。Portal 的构建主机地址必须与浏览器访问主机一致，当前为 `127.0.0.1:8791`。

Windows Docker Desktop 使用上述独立 Keygen Compose 时，管理端启动文件组合为 `compose.yaml`、`compose.keygen-network.yaml`、`compose.portal.yaml`、`compose.portal-network.yaml`，无需 host 网络。sub2api 的宿主机服务地址通过 `.env` 指向 8189。

Portal 内部代理使用 `Host: api.keygen.localhost` 匹配 Keygen 的账号作用域路由。因此 Keygen 的 `.env.keygen` 配置 `KEYGEN_HOST=api.keygen.localhost`、`KEYGEN_DOMAIN=keygen.localhost`、`KEYGEN_SUBDOMAIN=api`；无需给用户配置这个内部域名或更改公网 DNS。

## 配置

1. 按 Keygen 官方自部署说明初始化 CE（singleplayer）及数据库。创建产品、设备绑定策略、许可证。策略必须启用严格设备匹配、限制设备数量（例如 1），并确保解绑后验证失败。不要使用允许未注册设备通过的策略。
2. 创建仅保存在网关的 Keygen 服务端 Token。`KEYGEN_URL` 指向其 `/v1` API；若使用账号作用域，填 `/v1/accounts/账号ID`。
3. 在 sub2api 为每个用户建立独立 Key 和额度。
4. 复制 `.env.example` 为 `.env`，填入真实配置。生成随机签名密钥可运行 `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`。
5. 创建 `data/mappings.json`，格式为：

```json
{
  "Keygen许可证UUID": { "apiKey": "该用户独立的sub2api Key" }
}
```

映射文件和 `.env` 只能保存在服务端，不能打包进客户端。修改映射立即生效；删除映射或在 Keygen 撤销授权可阻止新请求。正在进行的请求不会被强制中止。

## 启动

可选：在本目录初始化独立 Keygen CE（不修改下载的上游仓库）：

```sh
node init-keygen.mjs
docker compose --env-file .env.keygen -f compose.keygen.yaml -p openfilm-keygen up -d postgres redis
docker compose --env-file .env.keygen -f compose.keygen.yaml -p openfilm-keygen run --rm keygen bundle exec rails keygen:setup
docker compose --env-file .env.keygen -f compose.keygen.yaml -p openfilm-keygen up -d
```

初始化任务仅对全新数据库执行一次，它会加载 schema。管理员凭据在 `.env.keygen`，Keygen 管理 API 仅监听宿主机 `127.0.0.1:3300`。对应网关的 `KEYGEN_URL` 填 `http://host.docker.internal:3300/v1`。

管理员 Token 配置后，可通过服务端脚本创建策略并发放授权：

```sh
node --env-file=.env provision.mjs policy
# 将输出的 KEYGEN_POLICY_ID 设置到环境，再执行：
node --env-file=.env provision.mjs issue 用户sub2api密钥文件 激活信息.json
```

请在宿主机执行脚本时把 `MAPPING_FILE` 改为本地路径 `./data/mappings.json`，`KEYGEN_URL` 改为宿主机可访问地址。激活信息文件包含可发给用户的激活码，不包含 sub2api Key。撤销可通过 Keygen API suspend 许可证或删除映射；换机需通过 Keygen API 删除旧 machine 后重新激活。

本机新建 Keygen 后，可运行 `node --env-file=.env.keygen bootstrap-gateway.mjs` 自动创建服务端 Token 和网关 `.env`（已存在时拒绝覆盖）。此 Token 具有管理员权限，应仅供本服务使用。

```sh
docker compose up -d --build
docker compose logs -f gateway
```

若 Keygen 由上述独立 Compose 启动，Windows Docker Desktop 推荐执行 `docker compose -f compose.yaml -f compose.keygen-network.yaml up -d --build`，通过内部网络连接 Keygen，避免回环地址访问差异。sub2api 的地址继续在 `.env` 中配置。

本机 Linux/WSL 的 sub2api 使用 host 网络且仅监听回环地址，已验证的启动命令是 `docker compose -f compose.yaml -f compose.host.yaml up -d --build`。该配置使用 host 网络，但网关显式只监听 `127.0.0.1:8188`；不要把它当成所有 Windows Docker Desktop 环境的默认配置。

Windows 上的 SakuraFrp 继续映射本机 `127.0.0.1:8188`，此端口由网关接管；sub2api 改为仅本机访问的 8189。sub2api 和 Keygen 管理端不得公开暴露。Compose 默认只把网关端口发布到宿主机回环地址。

OpenFilm 只提供激活码入口，输入 Keygen 许可证 Key 后点击激活。服务地址和模型由主进程配置，默认使用固定公网入口；开发环境也必须激活。设备私钥及续期凭据使用 Electron 系统安全存储加密；系统安全存储不可用时拒绝激活。模型调用通过本地请求桥签名，sub2api Key 不传入客户端。

## 协议

- `POST /auth/activate`：许可证 Key + Ed25519 公钥 + 签名，注册设备并返回续期凭证。
- `POST /auth/refresh`：续期凭证 + 设备签名，获取五分钟访问凭证。
- `POST /auth/status`：验证当前设备授权，不调用模型、不消耗模型额度。
- `POST /v1/responses`、`GET /v1/models`：访问凭证 + 请求签名，逐次校验 Keygen 设备授权后转发。

签名覆盖方法、原始路径、毫秒时间戳、随机 nonce、请求体 SHA256 和访问凭证 SHA256，以换行分隔。允许一分钟时钟偏差，nonce 在两分钟内不可复用。客户端和服务器必须自动校时。网关采用单进程、单实例；水平扩容前需要共享防重放存储。

当前续期凭据最长一年，届时需要重新激活。设备绑定基于安装生成的密钥，不能保证抵挡控制设备后复制解密密钥的攻击；重装后须解绑旧设备。每个请求都校验 Keygen，授权服务不可用时拒绝调用。

## 验证

在 OpenFilm 仓库运行 `node --test services/auth-gateway/server.test.mjs`。集成测试使用协议替身；正式上线仍须对真实 Keygen CE、sub2api 和 Windows DPAPI 做验证。

2026-11-01 已在当前 Linux/WSL 环境完成真实 Keygen CE + Docker 网关 + sub2api 联调：激活、自动续期、OpenFilm 请求桥、非流式回复、SSE、重新读取会话、第二设备拒绝和设备解绑立即生效均通过。Windows DPAPI 尚需在目标 Windows 安装包中验收。

可重复运行真实测试（仅使用专门的测试许可证，它会删除该许可证绑定的设备）：

```sh
# KEYGEN_URL、MAPPING_FILE 使用宿主机可访问的值；GATEWAY_TEST_URL 指向已启动的 Docker 网关
node --env-file=.env verify-live.mjs data/test-activation.json --reset-test-devices
```
