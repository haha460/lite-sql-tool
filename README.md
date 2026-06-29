# SQL Redis Visual Tool

一个连接 SQL、Redis 和 AI 助手的小型可视化项目。它包含：

- FastAPI 后端接口
- 原生 HTML/CSS/JS 前端
- SQL 数据表浏览和分页加载
- `SELECT` / `WITH` SQL 查询
- 在可视化表格里直接新增、修改、删除数据
- 前端添加、编辑和保存数据库连接
- Redis 连接检测和 key 查看接口
- 右侧 AI 助手，支持直连模型和 OpenCode 后端 Agent 两种模式
- 保留原来的 CLI 缓存/同步工具

## 安装

```bash
pip install -r requirements.txt
```

`requirements.txt` 已包含 SQLite、MySQL、PostgreSQL 常用依赖。OpenCode 模式还需要本机能执行 `opencode` 命令，例如：

```bash
npm install -g opencode-ai
```

## 数据库配置

Web 前端支持直接添加连接。连接信息保存在后端本机 `.runtime/connections.json`，启动服务后会自动加载；只有点击某个连接时，才会真正连接数据库。该文件可能包含数据库密码，`.runtime/` 已加入 `.gitignore`，不会提交到 git。

旧版本保存在浏览器 `localStorage` 的连接会在首次打开页面时自动迁移到 `.runtime/connections.json`，迁移成功后清理浏览器里的旧连接配置。

默认可以使用当前目录的 SQLite 数据库：

```bash
sqlite:///app.db
redis://localhost:6379/0
```

也可以在前端添加 MySQL：

```text
mysql+pymysql://user:password@localhost:3306/app
```

或 PostgreSQL：

```text
postgresql+psycopg://user:password@localhost:5432/app
```

连接弹窗支持两种方式：

- 连接串模式：支持 `local_user:local_password@(127.0.0.1:3306)/local_db?charset=utf8&loc=Asia%2FShanghai&parseTime=true` 这类 DSN
- IP/Port 模式：填写 Driver、IP/Host、端口、用户名、密码、数据库名后自动生成 SQL URL
- Redis-only 模式：Driver 选择 Redis 时只保存 Redis 连接，不展示 SQL 表
- 只读连接：勾选后仍可浏览和查询 SQL，但后端会拒绝新增、修改、删除操作

## AI 助手配置

AI 助手使用 OpenAI-compatible 接口，模型配置只从环境变量读取。未配置 AI 变量时，Web 项目仍可正常使用，右侧 AI 助手会显示未配置状态。

推荐使用多模型配置：

```bash
export AI_DEFAULT_MODEL="fast-model"
export AI_MODELS='[
  {
    "id": "fast-model",
    "name": "快速模型",
    "model": "provider-fast",
    "api_base": "https://your-provider.example.com/v1",
    "api_key": "your-api-key"
  },
  {
    "id": "reasoning-model",
    "name": "推理模型",
    "model": "provider-reasoning",
    "api_base": "https://your-provider.example.com/v1/chat/completions",
    "api_key": "your-api-key"
  }
]'
```

也可以用逗号分隔的模型列表，共用同一个接口地址和 key：

```bash
export AI_API_BASE="https://your-provider.example.com/v1"
export AI_API_KEY="your-api-key"
export AI_MODEL_LIST="provider-fast,provider-reasoning"
```

兼容旧的单模型配置：

```bash
export AI_API_BASE="https://your-provider.example.com/v1"
export AI_API_KEY="your-api-key"
export AI_MODEL="your-model-name"
```

AI 会话默认保存在后端内存中。配置 `AI_SESSION_DATABASE_URL` 后，会话元数据和关联的 OpenCode session id 会持久化到 `ai_sessions`，每一轮用户问题和 AI 回复会以一行 turn 记录存到 `ai_session_turns`；页面仍在 `sessionStorage` 记录当前会话 ID、连接映射和模型选择，刷新页面或后端重启后会自动尝试恢复历史消息。旧版 `ai_sessions.messages` 中的历史消息会在启动时自动拆分迁移到 turn 表。

本地 PostgreSQL 示例：

```bash
brew services start postgresql@16
createuser --login opencode_sessions
createdb -O opencode_sessions opencode_sessions
export AI_SESSION_DATABASE_URL="postgresql+psycopg://opencode_sessions:opencode_sessions_local@127.0.0.1:5432/opencode_sessions"
```

如果角色需要密码，可以用：

```bash
psql -d postgres -c "alter role opencode_sessions password 'opencode_sessions_local';"
```

## AI 后端模式

AI 助手默认使用后端直连模型：

```bash
export AI_AGENT_BACKEND=direct
```

直连模式由 FastAPI 后端读取当前数据库 schema，让模型生成只读 SQL，再由后端执行 `SELECT` / `WITH` 查询并让模型总结结果。

也可以切换为 OpenCode 后端 Agent 模式：

```bash
export AI_AGENT_BACKEND=opencode
export OPENCODE_SERVER_URL="http://127.0.0.1:4096"
export OPENCODE_AGENT="db-analyst"
export OPENCODE_PROVIDER="huayan"
```

OpenCode 模式下，FastAPI 会把用户问题转交给 OpenCode Server。OpenCode 使用项目里的 `db-analyst` agent，并通过数据库工具回调本项目后端：

- `opencode.json`：OpenCode provider 和模型配置
- `.opencode/agents/db-analyst.md`：数据库分析 agent 规则
- `.opencode/tools/db_schema.ts`：读取当前 AI session 的数据库 schema
- `.opencode/tools/db_select.ts`：执行当前 AI session 下的只读 SQL

OpenCode 工具只接收后端生成的 AI session id，并回调 `/api/ai/tool/schema` 和 `/api/ai/tool/select`；它不会直接接触前端保存的数据库连接密码。

后端等待 OpenCode 回复时默认使用 OpenCode Server 的 `/event` SSE 事件流：先建立 SSE 订阅，再发送用户消息，收到当前 OpenCode session 的消息更新或空闲事件后再拉取最终消息。若当前 OpenCode Server 不支持 SSE 或连接中断，会自动回退到原来的消息轮询。需要临时禁用 SSE 时可设置：

```bash
export OPENCODE_RESPONSE_TRANSPORT=poll
```

## 启动 Web 项目

一键启动：

```bash
chmod +x start.sh
./start.sh
```

脚本会缓存 `requirements.txt` 的指纹，依赖没变化时会跳过安装，所以第二次启动会快很多。需要强制重装依赖时：

```bash
FORCE_INSTALL=1 ./start.sh
```

也可以手动创建演示 SQLite 数据库并启动服务：

```bash
python scripts/create_demo_db.py
uvicorn app.main:app --reload
```

打开：

```text
http://127.0.0.1:8000
```

## 启动 OpenCode Server

先启动本项目的 Web 服务，再另开一个终端启动 OpenCode Server。推荐用项目脚本启动，因为它会先加载根目录 `.env`，并且不会把密钥打印到终端：

```bash
export APP_API_BASE="http://127.0.0.1:8000"
export HUAYAN_API_BASE="https://your-provider.example.com/v1"
export HUAYAN_API_KEY="your-api-key"
python3 scripts/start_opencode.py
```

如果使用 `.env`，可以把 OpenCode 和 AI 配置放在根目录 `.env` 中：

```bash
AI_AGENT_BACKEND=opencode
AI_DEFAULT_MODEL=reasoning-model
AI_MODELS=[{"id":"reasoning-model","name":"推理模型","model":"gpt-5.5-pro","api_base":"https://your-provider.example.com/v1","api_key":"your-api-key"}]
AI_SESSION_DATABASE_URL=postgresql+psycopg://opencode_sessions:opencode_sessions_local@127.0.0.1:5432/opencode_sessions
APP_API_BASE=http://127.0.0.1:8000
HUAYAN_API_BASE=https://your-provider.example.com/v1
HUAYAN_API_KEY=your-api-key
OPENCODE_AGENT=db-analyst
OPENCODE_PROVIDER=huayan
```

不要直接运行 `opencode serve`，除非已经在同一个终端里导出了 `HUAYAN_API_BASE` 和 `HUAYAN_API_KEY`。OpenCode 不会自动读取本项目的 `.env`。

可选环境变量：

- `OPENCODE_HOST` / `OPENCODE_PORT`：控制 `scripts/start_opencode.py` 启动地址，默认 `127.0.0.1:4096`
- `OPENCODE_BIN`：指定 OpenCode 可执行文件路径，默认查找 `opencode`
- `OPENCODE_TIMEOUT`：后端等待 OpenCode 响应的超时时间，默认 120 秒
- `OPENCODE_RESPONSE_TRANSPORT`：OpenCode 回复等待方式，默认 `sse`；设置为 `poll` / `polling` / `http` 可强制使用轮询
- `OPENCODE_DIRECTORY`：传给 OpenCode Server 的项目目录，默认当前项目根目录
- `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`：如果 OpenCode Server 开了基础认证，可以在后端请求时使用
- `AI_SESSION_DATABASE_URL`：AI 会话记录存储数据库；未设置时使用后端内存

## 前端功能

- 添加连接：填写连接名称、SQL URL、Redis URL 后保存
- 添加连接：点击“新建连接”后在弹窗里填写
- 本地保存：刷新或重新打开页面后显示已保存连接
- 手动连接：点击连接名称后才真正连接数据库
- 编辑连接：已保存连接旁边有编辑按钮，鼠标悬停会显示 SQL / Redis 连接信息
- 支持同时打开不同数据库连接下的多个数据表 tab
- 左侧每个数据库连接下拉展示自己的数据表，便于同时浏览多个数据库
- 每个数据表可展开查看字段、外键、索引信息，并展示行数、估算标记和表大小
- 点击表名后可视化展示数据，默认先加载前 100 行，滚动到底部后继续加载下一批 100 行
- 点击表名后会在右侧工作区打开浏览数据 tab，标题包含当前表名和连接地址
- 只读连接会禁用新增、修改、删除操作，并由后端再次校验
- Redis-only 连接只连接 Redis，不参与 SQL 表浏览和 AI SQL 分析
- 有主键的表可以编辑非主键单元格，点击“提交更新”后才会写入数据库
- 可以勾选数据行并标记删除，点击“提交更新”后才会删除数据库里的行
- 可以点击“新增行”创建虚拟行，填写后点击“提交更新”写入数据库
- 上方 SQL 编辑器支持 `SELECT` / `WITH` 查询
- SQL 查询默认限制 100 行，查询结果只读，并支持滚动继续加载更多结果
- 右侧 AI 助手支持选择模型和已保存 SQL 连接，通过自然语言读取表结构、生成只读 SQL、执行查询并总结结果
- AI 助手按连接记录当前会话，连接和会话的对应关系保存在后端本地 `.runtime/ai_session_links.json`，支持恢复历史消息；助手回复支持标题、列表、代码块、表格、链接等 Markdown 渲染
- AI 助手面板支持拖动调宽、收起和重新打开，并显示当前是直连模式还是 OpenCode 模式

## API

```text
GET    /api/health
GET    /api/connections
PUT    /api/connections
POST   /api/connections/test
POST   /api/tables
POST   /api/tables/{table_name}/rows
PATCH  /api/tables/{table_name}/cell
POST   /api/tables/{table_name}/rows/insert
POST   /api/tables/{table_name}/rows/delete
POST   /api/query
POST   /api/redis/keys
POST   /api/redis/value
GET    /api/ai/config
GET    /api/ai/session-links
PUT    /api/ai/session-links
POST   /api/ai/sessions
POST   /api/ai/sessions/lookup
GET    /api/ai/sessions/{session_id}/messages
POST   /api/ai/chat
POST   /api/ai/tool/schema
POST   /api/ai/tool/select
```

## CLI 用法

检查连接：

```bash
python sql_redis_tool.py health
```

查询 SQL，并缓存 300 秒：

```bash
python sql_redis_tool.py query-cache \
  --sql "select id, name from users where id = :id" \
  --params '{"id": 1}' \
  --ttl 300
```

同步表到 Redis hash：

```bash
python sql_redis_tool.py sync-table \
  --table users \
  --id-column id \
  --prefix user \
  --ttl 3600
```
