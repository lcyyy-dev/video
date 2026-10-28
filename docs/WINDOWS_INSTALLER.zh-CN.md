# Windows 安装包构建

目标为 Windows x64。用户安装一次 OpenFilm，即可获得客户端、Codex、FFmpeg／FFprobe 和预览所需的 Chromium；不需要另外安装 Node.js、Codex 或 FFmpeg。模型调用仍需要网络和用户登录，本轮不加入共享账号或计费服务。

## 构建命令

构建机器安装 Node.js 22.18 或以上版本，以及仓库 `packageManager` 指定的 pnpm。Windows 还需系统自带的 curl、tar、PowerShell。构建过程需要联网下载 npm 依赖及各平台运行时。

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @openfilm/desktop test
pnpm release:win
```

如果在 WSL/Linux 环境中开发，也可以直接在仓库根目录重复执行最后一条命令导出 Windows x64 安装包：

```bash
pnpm release:win
```

该命令会重新构建客户端窗口、打包当前源码和内置运行时，并生成：

```text
apps/desktop/.release/win-x64/out/OpenFilm-Setup-x64.exe
```

后续修改代码或内置 skill 后，无需手动清理 `.release/`，再次运行 `pnpm release:win` 即可覆盖生成新包。安装包当前未配置 Windows 代码签名，首次安装可能显示“未知发布者”。

输出目录为 `apps/desktop/.release/win-x64/out/`：

- `OpenFilm-Setup-x64.exe`：给用户的完整 NSIS 安装包，可选择安装位置，默认安装到当前用户目录。
- `build-manifest.json`：客户端、Electron、Codex 版本、Codex 来源和安装包 SHA-256。
- `win-unpacked/`：构建后的完整应用目录，用于校验和本地试运行。

脚本在生成安装包前检查完整 Codex 运行时、适配器、四种视频工作流技能、FFmpeg 和 Windows x64 Chromium。缺少组件、下载校验失败或版本不符时构建失败，不输出可交付成功结论。

在 Windows 上验证解包后的应用，或已经安装的目录：

```powershell
node apps/desktop/scripts/verify-windows.mjs apps/desktop/.release/win-x64/out/win-unpacked
```

Linux/WSL 上可以验证 Windows 文件、架构和内置运行时是否齐全；Codex、FFmpeg、FFprobe 和 Chromium 的实际启动检查需要在 Windows 上执行：

```bash
node apps/desktop/scripts/verify-windows.mjs apps/desktop/.release/win-x64/out/win-unpacked
```

安装包的 SHA-256 可用以下命令记录或提供给 Windows 用户核对：

```bash
sha256sum apps/desktop/.release/win-x64/out/OpenFilm-Setup-x64.exe
```

当前工作区最近一次构建的 SHA-256：

```text
b76ec61f29661df9e3e0c9311d3ab7f11d35b5231c5f3b6e7c4218de4a2467d7
```

本版同时包含 Windows 项目执行权限边界修复、中文输入法组合输入修复、模板原文逐句 TTS 规则，以及 WSL 下临时 502/503/504 的自动重试。

此命令检查文件完整性并运行 Codex、rg、FFmpeg、FFprobe 和浏览器的版本命令，不发送模型请求。Linux/macOS 上只能检查 Windows 文件完整性及架构，不能替代 Windows 真机验收。

## 用户第一次使用

打开软件，在设置 → Codex 中登录。登录会打开 PowerShell 和官方认证流程；登录成功后返回软件。无需手动选择 Codex 程序。

Windows 安装包固定使用 `resources/runtime/codex/bin/codex.exe`，不采用用户全局安装的其他版本。Codex 配置、凭证及会话位于软件用户数据目录下的 `codex/`，与用户原有的 `~/.codex` 分开；首次使用需要重新登录。安装包不包含开发者的凭证。覆盖安装保留用户数据，卸载也不主动清除该数据目录。

所有客户端启动的 Codex 登录、状态检查和后台会话均关闭启动更新检查；Codex 版本由软件发布统一管理，不弹出交互式“是否升级 Codex”。

## 固定版本及后续升级

`apps/desktop/scripts/codex-build.json` 是 Windows 内置 Codex 的版本清单，当前采用依赖锁文件已有的 `0.156.1`，同时固定官方 npm 平台包 URL 和 SHA-512。Codex 原生目录完整复制，包含命令执行、Windows 沙箱、Code Mode、rg 等辅助组件和相关声明；不可只复制 `codex.exe`。

升级步骤：

1. 确定要使用的 Codex 版本，并检查 ACP 适配器兼容性；需要升级适配器时同步更新 `pnpm-lock.yaml`。
2. 更新 `codex-build.json` 的版本、下载地址和官方包完整性值，更新 `build/licenses/codex/` 中对应版本的 LICENSE、NOTICE。
3. 更新客户端发布版本，执行上述检查和构建命令。
4. 在干净的 Windows 环境完成安装、登录、中文和含空格路径、四种模板生成、取消／重试、预览、视频导出和剪映草稿导出的验收。
5. 记录 `build-manifest.json`，再向用户交付安装包。

下载缓存位于 `apps/desktop/.release/cache/`，每次使用仍检查 Codex 压缩包完整性；失败时不会采用未经校验的副本。构建的 npm 运行时依赖采用当前锁定版本，避免打包时自动升级适配器。

脚本也支持在 Linux x64 上交叉构建：自动取得固定版本、经过 SHA-256 校验的 Wine 11.0 WoW64 工具集（Kron4ek/Wine-Builds），用于 NSIS 生成卸载程序，Windows 用户无需安装 Wine。浏览器和下载压缩包缓存可在再次构建时复用；校验失败可清理 `.release/cache/` 后重新下载。

## 自动构建与发布

仓库提供手动触发的 `Windows installer` GitHub Actions 工作流，使用 Windows 构建机器执行同样的命令，随后静默安装并验证安装后的运行时，最后生成可下载的构建附件。工作流不自动发布给用户。

默认使用仓库自身的 `product.json`，不连接上游软件更新地址。此阶段给用户新版安装包进行覆盖安装；启用自己的自动更新服务需要另行配置发布源。当前流程没有 Windows 代码签名证书，安装时系统可能提示未知发布者，商业交付前可接入自己的签名证书。
