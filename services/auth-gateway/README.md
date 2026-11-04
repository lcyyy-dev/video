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

OpenFilm 只提供激活码入口，输入 Keygen 许可证 Key 后点击激活。服务地址和模型由主进程配置，默认使用固定公网入口；开发环境也必须激活。首次激活需要联网；之后工作区先读取本机保存的加密激活凭据，离线可直接打开。启动和窗口重新获得焦点时做一次不阻塞工作区的后台核验，不再每 60 秒轮询。普通网络/服务错误不会锁定工作区；网关明确确认许可证停用、过期或设备解绑时，客户端保存失效状态、锁定工作区 IPC 并关闭本地 Agent，会在离线重启后保持锁定，直到成功重新激活。已有激活凭据直接兼容，无需重新激活。设备私钥及续期凭据优先使用 Electron 系统安全存储加密。Linux/WSL 没有可用密钥环时，使用 AES-256-GCM 和应用数据目录内仅当前用户可读写的随机密钥（gateway-storage.key，0600 权限）；不使用 Chromium basic_text。旧的系统加密凭据仍需原密钥环解锁，不会被静默覆盖。模型调用通过本地请求桥签名，sub2api Key 不传入客户端。

## 协议

- `POST /auth/activate`：许可证 Key + Ed25519 公钥 + 签名，注册设备并返回续期凭证。
- `POST /auth/refresh`：续期凭证 + 设备签名，获取五分钟访问凭证。
- `POST /auth/status`：验证当前设备授权，不调用模型、不消耗模型额度。
- `POST /v1/responses`、`GET /v1/models`：访问凭证 + 请求签名，逐次校验 Keygen 设备授权后转发。

签名覆盖方法、原始路径、毫秒时间戳、随机 nonce、请求体 SHA256 和访问凭证 SHA256，以换行分隔。允许一分钟时钟偏差，nonce 在两分钟内不可复用。客户端和服务器必须自动校时。网关采用单进程、单实例；水平扩容前需要共享防重放存储。

当前续期凭据最长一年，届时云端调用需要重新激活，本地工作区仍可打开。设备绑定基于安装生成的密钥，不能保证抵挡控制设备后复制解密密钥的攻击；重装后须解绑旧设备。每个云端请求都校验 Keygen。授权服务暂时不可用时拒绝该次调用但不锁定客户端。只有服务端自己的 403 响应同时包含 x-openfilm-authorization: revoked 及 LICENSE_SUSPENDED / LICENSE_EXPIRED / DEVICE_UNBOUND / LICENSE_REVOKED 代码时，客户端才执行锁定；模型上游 403、Keygen 服务账号错误、超时或 5xx 都不触发永久失效。旧安装包需更新客户端才能执行此逻辑；离线设备在再次联网核验前无法获知新的撤销操作。

## 验证

在 OpenFilm 仓库运行 `node --test services/auth-gateway/server.test.mjs`。集成测试使用协议替身；正式上线仍须对真实 Keygen CE、sub2api 和 Windows DPAPI 做验证。

2026-11-01 已在当前 Linux/WSL 环境完成真实 Keygen CE + Docker 网关 + sub2api 联调：激活、自动续期、OpenFilm 请求桥、非流式回复、SSE、重新读取会话、第二设备拒绝和设备解绑立即生效均通过。Windows DPAPI 尚需在目标 Windows 安装包中验收。

可重复运行真实测试（仅使用专门的测试许可证，它会删除该许可证绑定的设备）：

```sh
# KEYGEN_URL、MAPPING_FILE 使用宿主机可访问的值；GATEWAY_TEST_URL 指向已启动的 Docker 网关
node --env-file=.env verify-live.mjs data/test-activation.json --reset-test-devices
```

## PostgreSQL 日志与独立管理页面

网关日志使用 PostgreSQL，不再以 JSONL 文件作为运行时存储或查询来源。当前服务器复用现有 PostgreSQL 18 实例，使用独立数据库 `openfilm_gateway_logs`，不修改 Keygen/sub2api 业务表。其他服务器可通过连接串接入自己的 PostgreSQL，功能不捆绑任何代理或穿透软件。

### 存储配置

在部署用 `.env` 中配置：

```dotenv
LOG_DATABASE_URL=postgresql://log_writer:YOUR_PASSWORD@host.docker.internal:5432/openfilm_gateway_logs
# 可选：管理页使用独立只读账号；省略时沿用上面的连接串。
LOG_DATABASE_READ_URL=postgresql://log_reader:YOUR_PASSWORD@host.docker.internal:5432/openfilm_gateway_logs
MONITOR_PUBLIC_URL=https://your-gateway.example:12345/healthz
MONITOR_INTERVAL_MS=30000
```

数据库和登录角色由该服务器管理员预先创建，写入账号需要在**独立日志库**中创建 schema/table 的权限；不要使用 Keygen/sub2api 业务库。`log-init` 是一次性初始化进程，创建 `gateway_logs.events`、`gateway_logs.collector_state` 和时间、来源、许可证、请求 ID、Key 指纹、异常记录索引。三个应用进程等待初始化成功后再启动，初始化失败不会静默回退到文件日志。

使用只读账号时，在日志表初始化之后由数据库管理员执行相应授权（替换角色名）：

```sql
GRANT CONNECT ON DATABASE openfilm_gateway_logs TO log_reader;
GRANT USAGE ON SCHEMA gateway_logs TO log_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA gateway_logs TO log_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE log_writer IN SCHEMA gateway_logs
  GRANT SELECT ON TABLES TO log_reader;
```

独立运行开发命令：

```sh
npm ci --ignore-scripts
node --env-file=.env log-db.mjs init
node --env-file=.env log-db.mjs status
```

`events` 保存时间、来源、级别、事件、许可证 ID、请求 ID 和经过字段白名单处理的 JSONB 数据。日志同时输出标准输出供运维查看，但后台查询只使用 PostgreSQL；默认数据库保留 30 天。SQL 使用参数化查询、稳定游标分页和每页最多 200 条，不再受旧文件扫描大小限制。

写入采用短批次异步队列，不阻塞用户的模型流。数据库暂时不可用时保留待写事件并重试，恢复后按事件 ID 去重；进程正常停止会等待写入。每个写入进程最多暂存 5000 条，队列满或写入失败会输出明确运维错误。数据库故障期间强制杀进程仍可能丢失尚未入库的内存队列；标准输出可用于故障对照。管理页在数据库不可用时报告读取失败，不伪装成空历史。

### 迁移旧文件日志

旧文件仅作为一次性导入源。初始化数据库后执行：

```sh
node --env-file=.env log-db.mjs migrate ./logs
```

迁移保留原时间和事件 ID，以主键去重，可以重复执行；旧文件不删除。旧的 `external-cursor.json` 也会迁入 `collector_state`，后续采集进度仅写数据库。切换时先迁移，再短暂停止旧写入进程，补迁最后一批记录，再启动新版本，可避免漏掉停止前的日志。当前服务器的 305 条旧记录已按 ID 逐条核对入库。

### 三个独立页面

- `http://127.0.0.1:8790/licenses`：授权管理、发码、Key 映射和设备。
- `http://127.0.0.1:8790/logs`：激活、续期、模型/配音调用记录，支持用户、时间、搜索、异常筛选和分页。
- `http://127.0.0.1:8790/diagnostics`：当前连接状态、数据库状态、探测历史及外部代理/穿透日志。

根地址进入授权管理。每页有独立 URL，刷新和浏览器返回保留页面，三个页面共用原管理员登录。只有当前页面自动刷新，不把授权表、调用历史和连接诊断堆在一起。数据库读取复用管理员会话，后台与只读查询端口仍限本机访问。

每次网关请求返回 `x-request-id`，串联请求开始、Keygen 校验、上游响应、错误和请求结束。记录 UTC 时间、许可证 ID、设备指纹、用户 Key/激活码哈希指纹、状态码、耗时、字节数和失败阶段；不记录完整 Key、Token、签名、公私钥、提示词、配音文本或回复正文。

SSE 的 HTTP 200 不一定代表成功：没有 `[DONE]` 或 `response.completed` 标记记为 `incomplete`；`response.failed`/`response.incomplete`/`error` 事件记为失败。下游提前断开记为 `disconnected`，不能单凭该项判断是用户取消还是穿透断链。历史上未记录的激活行为无法凭空补回。

### 链路监测与自行安装的软件

`GET /healthz` 是无凭据的网关存活接口，不调用模型或 Keygen。监测器约每 30 秒并行探测本机和管理员配置的公网入口，每次超时 8 秒，核对返回的网关标识。超过两分钟没有探测数据时页面提示过期。

- 本机正常、公网失败：检查服务器出口、穿透/代理、DNS 和证书。
- 本机失败：检查网关、容器和宿主机网络。
- 两端正常：只说明该探测时刻服务器所在网络可达，不能排除个别用户路径或长连接问题。
- 网关可达但业务出错：用请求 ID 对照 Keygen/sub2api 阶段的耗时及错误。

代理和穿透软件由你自行安装。可选地设置 `EXTERNAL_LOG_HOST_DIR` 为该软件的 UTF-8 文本日志目录，在原 Compose 文件组合后追加 `-f compose.external-logs.yaml`，以只读目录接入；不挂载则不采集。采集器支持 `.log`/`.txt` 和常见重命名轮转、半行等待、增量读取，读取进度存 PostgreSQL，只有事件入库成功后才推进游标。每个来源每次最多读取 20 个文件、每个文件 1 MiB；重试通过稳定事件 ID 避免重复。

导入记录按采集时间筛选，并展示能识别的原始时间。未标时区的外部时间不擅自换算。常见凭据字段会脱敏，但第三方软件仍应关闭凭据和业务正文输出。本程序无法读取未提供的远程第三方穿透节点内部日志。

### 使用现有镜像运行源码，不构建镜像

在本目录完成 `npm ci --ignore-scripts` 后，可用 `compose.source.yaml` 只读挂载源码和依赖。`GATEWAY_IMAGE` 必须指向已存在的兼容 Node 镜像。当前 Linux/WSL 本机部署执行：

```sh
docker compose -f compose.yaml -f compose.host.yaml -f compose.source.yaml -f compose.external-logs.yaml up -d --no-build --pull never gateway admin monitor
```

`compose.host.yaml` 用于本机回环地址部署；其他服务器按网络配置选择覆盖文件。不采集外部日志时省略最后一个覆盖文件。该操作保留独立 Portal、Keygen、sub2api 和穿透软件，不构建新镜像。

### 测试

数据库测试仅使用指定日志数据库内随机命名的临时 schema，结束后删除；不读写正式事件表。无数据库环境时相应集成测试明确跳过。

```sh
node --env-file=.env --test server.test.mjs admin.test.mjs observability.test.mjs gateway-logging.test.mjs log-store.test.mjs tts.test.mjs
AUTH_UI_BROWSER=/path/to/chromium node --env-file=.env --test admin-ui.browser.test.mjs
```

### 个人 Key 额度

`GET /account/quota` 使用设备签名与 access token，并实时校验 Keygen 许可证及设备关联。网关按许可证映射的用户 Key 查询 Sub2API `/v1/usage`，只返回 `limit`、`used`、`remaining`、`percent`（0–100）和 `unit`（USD），不返回上游 Key 或原始用量响应。没有 Key 总限额时数值为 null，不使用钱包余额计算百分比。上游失败返回 502，不表示额度耗尽。桌面端在打开个人卡片时查询；部署时需更新网关并重新构建桌面端。

### 授权用户资料

用户资料保存在 PostgreSQL 的 `gateway_accounts.license_profiles` 表，通过 `license_id` 关联 Keygen 授权，不改动 Keygen 上游业务表。字段为 `username`（默认“用户”加六位随机数字，用户可修改，最长 8 个 Unicode 字符）与 `user_id`（固定前缀 `0406 2003`，后四位从未使用的 0001–9999 随机分配，用户不可修改）。事务锁和唯一约束保证并发分配不重复，删除模型 Key 映射不会删除资料或回收 ID；四位空间用尽后明确报错。

中文管理页和 `provision.mjs issue` 创建授权时自动创建资料；网关启动为已有映射补齐资料，其他已授权许可证按需补齐。后台列表展示用户名和用户 ID，管理备注独立保留。用户名变更不改变激活码、用户 ID 或模型 Key。

`GET /account/profile` 返回当前设备绑定许可证的 `{username,userId}`。`PATCH /account/profile` 只接受 `{username}`，拒绝 ID 等额外字段；均校验设备签名、凭证、Keygen 设备授权和映射。个人卡片点击用户名旁的编辑按钮修改并保存，ID 只读。

默认连接使用 `LOG_DATABASE_URL`，可用 `PROFILE_DATABASE_URL` 指向独立 PostgreSQL。即使管理页日志使用只读的 `LOG_DATABASE_READ_URL`，资料连接也需要写权限及首次建表权限。`gateway_accounts` 不受日志保留期清理影响。源码挂载部署需更新 `compose.source.yaml` 后重新创建 gateway、admin 容器以挂载 `profiles.mjs`。
