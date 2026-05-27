# MCP Claw

MCP Claw 是一个桌面端 MCP 聚合网关，用来统一管理多个 MCP Server，并通过一个本地 Streamable HTTP Endpoint 暴露给 Claude Code、Codex 等 MCP Client。

它本身也是一个 MCP Server：客户端只需要接入 MCP Claw 的统一地址，就可以获取 MCP Claw 聚合后的工具列表，并调用下游 MCP 服务提供的 tools。

> 当前版本主要支持 MCP tools 聚合与调用。resources、prompts 尚未作为聚合能力开放。

## 功能特性

- 统一管理多个 MCP Server
- 支持 `stdio` 和 `streamable-http` 两种 MCP 传输方式
- 提供本地统一 Endpoint：`http://localhost:18721/mcp`
- 为不同 Agent 维护独立 token
- 控制每个 MCP 服务对不同 Agent 的可见性
- 自动聚合下游 MCP tools，并按 `服务名__工具名` 命名暴露
- 内置 MCP Claw 网关工具，用于查询已维护的 MCP 服务和工具
- 支持测试 MCP 服务的 tools 是否可用
- 提供接入日志，方便排查客户端调用情况
- 支持 Claude Code、Codex 和通用 Streamable HTTP MCP Client 接入配置复制

## 工作方式

MCP Claw 启动后会在本机监听：

```text
http://localhost:18721/mcp
```

客户端通过 Bearer Token 接入 MCP Claw。MCP Claw 根据 token 识别当前 Agent，然后只暴露该 Agent 有权限访问的 MCP 服务工具。

工具命名规则：

```text
服务名__工具名
```

例如，维护了一个名为 `github` 的 MCP 服务，它提供 `search_repositories` 工具，则聚合后工具名会是：

```text
github__search_repositories
```

MCP Claw 还会额外暴露一组网关工具：

```text
mcp_claw__list_servers
mcp_claw__list_tools
mcp_claw__get_server_status
mcp_claw__search
```

这些工具用于让 Claude Code、Codex 等客户端查询 MCP Claw 当前维护了哪些服务、哪些工具可用，以及服务状态。

## 安装与运行

### 环境要求

- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 启动构建后的应用

```bash
npm start
```

### 打包桌面应用

```bash
npm run package
```

打包目标来自 `package.json` 中的 electron-builder 配置：

- Windows: `exe`
- macOS: `dmg`
- Linux: `AppImage`

## 添加 MCP 服务

在 MCP Claw 的「服务列表」中点击「添加服务」。

### stdio 服务

适用于通过命令行启动的 MCP Server，例如：

```json
{
  "name": "filesystem",
  "transport": "stdio",
  "config": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/workspace"],
    "env": {},
    "cwd": null
  }
}
```

### Streamable HTTP 服务

适用于已经提供 HTTP MCP Endpoint 的服务：

```json
{
  "name": "remote-mcp",
  "transport": "streamable-http",
  "config": {
    "url": "http://localhost:3000/mcp"
  }
}
```

添加后可以在服务详情页点击「测试」，MCP Claw 会尝试连接该服务并执行 `tools/list`，用于确认该服务的 tools 是否可用。

## Claude Code 接入

打开 MCP Claw 的「Endpoint 信息」，找到 Claude Code 对应的 Agent，复制配置。

示例：

```json
{
  "mcpServers": {
    "mcp-claw": {
      "type": "http",
      "url": "http://localhost:18721/mcp",
      "headers": {
        "Authorization": "Bearer <你的 Agent Token>"
      }
    }
  }
}
```

可放入：

- 全局配置：`~/.claude.json`
- 项目配置：项目根目录 `.mcp.json`

## Codex 接入

打开 MCP Claw 的「Endpoint 信息」，找到 Codex 对应的 Agent，复制 Codex 配置。

### TOML

```toml
[mcp_servers.mcp_servers]
type = "http"
url = "http://localhost:18721/mcp"
headers = { Authorization = "Bearer <你的 Agent Token>" }
```

### JSON

```json
{
  "type": "http",
  "url": "http://localhost:18721/mcp",
  "headers": {
    "Authorization": "Bearer <你的 Agent Token>"
  }
}
```

### CLI 命令

Endpoint 信息页也会提供 Codex CLI 命令。实际使用时建议优先复制应用内生成的配置，因为 token 会随 Agent 更新而变化。

## Agent 与权限

MCP Claw 默认会创建 Claude Code 和 Codex 两个 Agent。每个 Agent 都有独立 token。

你可以：

- 新增 Agent
- 修改 Agent 名称
- 更新或重新生成 token
- 删除 Agent
- 为每个 MCP 服务配置可访问的 Agent

当客户端请求 MCP Claw Endpoint 时，MCP Claw 会根据 `Authorization: Bearer <token>` 判断请求来自哪个 Agent。

如果 token 不正确，请求会被拒绝。

## 接入日志

「接入日志」页面会记录 MCP Client 对 MCP Claw 的访问情况，包括：

- 访问时间
- Agent
- 操作类型
- 调用详情

这可以用于排查 Claude Code、Codex 是否真正连接到了 MCP Claw，以及是否执行了 `tools/list` 或 `tools/call`。

## 数据存储

MCP Claw 的 MCP 服务配置文件默认保存在：

```text
~/.mcp-gateway/servers.json
```

其中包含：

- Agent 配置
- MCP 服务配置
- 服务授权关系

可以在应用内「配置」页面修改 MCP 服务配置文件路径和日志目录路径。

路径设置本身保存在固定位置：

```text
~/.mcp-gateway/settings.json
```

这个文件只保存当前使用的 `servers.json` 路径和 logs 目录路径。

## 开发脚本

```bash
npm run dev          # 同时启动 Vite renderer 和 Electron main
npm run build        # 构建 main 和 renderer
npm start            # 构建后启动 Electron
npm test             # 运行 Vitest 单元测试
npm run test:watch   # 监听模式运行测试
npm run test:e2e     # 运行 Playwright E2E 测试
npm run package      # 构建并打包桌面应用
```

## 当前限制

- 当前聚合能力主要覆盖 MCP tools
- resources 和 prompts 暂未作为聚合能力开放
- Endpoint 默认仅监听本机 localhost
- token 会展示在应用配置面板中，请不要把真实 token 提交到公开仓库

## License

当前仓库尚未声明 License。发布到 GitHub 前建议根据你的发布策略补充 `LICENSE` 文件。
