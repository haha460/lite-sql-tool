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
- 基于 sqlite-vec 的知识库（RAG 语义检索），把文档/笔记接入 AI 助手
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
- 所属分组：弹窗里可以直接选择连接归属的分组，默认放入「默认分组」

## 连接分组

左侧连接列表支持按分组组织，方便管理多个数据库连接。

- 分组信息和连接一起保存在后端本机 `.runtime/connections.json`（结构为 `{version, groups, connections}`），每个连接带一个 `groupId`。
- 始终存在一个「默认分组」，不能删除但可以重命名；所有未归组的连接都会落在默认分组下。
- 点击连接区右上角的「新建分组」创建分组；分组标题旁的按钮可以重命名或删除分组。
- 一键连接：非空分组标题上有「全部连接」按钮，点击后会依次连接该分组内的所有数据库（逐个做连接检测并加载数据表，Redis-only 连接则激活 Redis），完成后提示成功和失败数量；单个连接失败不影响其余连接。
- 归组方式有两种：把连接直接拖拽到目标分组，或在新建/编辑连接的弹窗里用「所属分组」下拉框选择。
- 删除一个分组时，只删除分组本身，组内连接会自动移动到默认分组，连接不会丢失。
- 分组的展开 / 收起状态保存在浏览器 `localStorage`，刷新或重新打开页面后保持不变。
- 旧版本的 `.runtime/connections.json`（没有 `groups` 字段的连接列表）会自动兼容：读取时给每个连接补上默认分组，首次保存后升级为新格式。

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

## 数据库 Skill

AI 助手支持从前端上传数据库业务文档，由模型转换为 Skill Markdown 后一键导入本地 `.skill/` 目录，并绑定到当前数据库会话和数据库名。再次上传会为该数据库生成新的 Skill，并替换后续会话使用的绑定。

绑定后的 Skill 会优先使用；如果当前会话没有上传绑定，后端会从 SQL 连接串解析数据库名，并优先查找 `数据库/<数据库名>.md`，再查找 `docs/<数据库名>.md`；例如连接到 `charge` 数据库时，会自动加载 `.skill/charge.skill.md`、`数据库/charge.md` 或 `docs/charge.md`。

数据库 Skill 会随 `/api/ai/tool/schema` 返回，并在直连模式的系统提示词中注入。OpenCode 模式下，`db-analyst` 会读取 `db_schema` 返回的 `database_skill` 字段，用它补充表含义、业务流程、指标口径和查询注意事项。

使用约定：

- 前端上传支持 `.md`、`.txt`、`.sql`、`.json`、`.yaml`、`.yml`、`.csv` 文本文件。
- 上传生成的 Skill 保存在 `.skill/<数据库名>.skill.md`，绑定关系保存在 `.runtime/ai_skill_bindings.json`。
- 手工兜底 Markdown 文件可放在 `数据库/` 或 `docs/` 目录，文件名与数据库名一致。
- 文档用于描述业务口径、表关系、典型查询和产出规则。
- SQL 生成仍以实时 schema 的表字段为准；如果 Markdown 与真实 schema 冲突，AI 应说明差异。
- 当前单个数据库 Skill 最多注入约 30000 字符，超出会截断。

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
- `.opencode/tools/knowledge_search.ts`：对知识库做语义检索，返回最相关的文档片段

OpenCode 工具只接收后端生成的 AI session id，并回调 `/api/ai/tool/schema`、`/api/ai/tool/select` 和 `/api/ai/tool/knowledge_search`；它不会直接接触前端保存的数据库连接密码。

后端等待 OpenCode 回复时默认使用 OpenCode Server 的 `/event` SSE 事件流：先建立 SSE 订阅，再发送用户消息，收到当前 OpenCode session 的消息更新或空闲事件后再拉取最终消息。若当前 OpenCode Server 不支持 SSE 或连接中断，会自动回退到原来的消息轮询。需要临时禁用 SSE 时可设置：

```bash
export OPENCODE_RESPONSE_TRANSPORT=poll
```

## 知识库（RAG 语义检索）

除了按数据库名整段注入的「数据库 Skill」，项目还内置了一个基于向量检索的知识库，适合文档、笔记多、需要按语义命中片段的场景。它把 `knowledge_base/` 目录下的 Markdown / 文本切块、向量化后存入 `data/kb.db`（sqlite-vec 向量库），AI 助手通过 `knowledge_search` 工具按问题语义检索最相关的片段作答。

与「数据库 Skill」的区别：数据库 Skill 是「按库名精确匹配一个文件、整段塞入提示词」，适合一个数据库对应一份业务说明；知识库是「语义检索 top-k 片段」，文档规模大时更省 token、更精准。两者互补，可以同时使用。

### 存储与依赖

- 向量存储使用 [sqlite-vec](https://github.com/asg017/sqlite-vec)，已加入 `requirements.txt`，无需额外服务。
- 知识库独立存放在 `data/kb.db`，与业务库 `app.db` 解耦；它是可重建的构建产物，已加入 `.gitignore`。
- 源文档放在 `knowledge_base/` 目录（`.md` / `.txt`）。这些是你的私有数据，**已在 `.gitignore` 中排除，不会提交到 git**；目录靠 `knowledge_base/.gitkeep` 占位保留。克隆项目后自行把笔记放进该目录再灌库即可。

### 环境变量

灌库和查询必须使用同一个 embedding 模型，维度也要与建表一致。默认值适配华彦 `text-embedding-3-small`（1536 维），复用已有的 `HUAYAN_API_BASE` / `HUAYAN_API_KEY`：

```bash
HUAYAN_API_BASE=https://your-provider.example.com/v1
HUAYAN_API_KEY=your-api-key
KB_EMBED_MODEL=text-embedding-3-small   # 默认值，可省略
KB_EMBED_DIM=1536                        # 默认值，需与模型输出维度一致
```

其他可选调参：`KB_EMBED_BATCH`（分批大小，默认 32）、`KB_CHUNK_TARGET`（每块目标字数，默认 400）、`KB_CHUNK_OVERLAP`（块间重叠字数，默认 60）。

### 构建与更新

```bash
set -a; source .env; set +a
.venv/bin/pip install sqlite-vec

.venv/bin/python scripts/build_kb.py            # 增量灌库(按文件修改时间,只重建改过的)
.venv/bin/python scripts/build_kb.py --rebuild  # 全量重建(换 embedding 模型或维度后必用)
```

日常维护：把新笔记放进 `knowledge_base/`，重跑 `build_kb.py` 即可。脚本按文件修改时间增量处理，源目录里删掉的文件对应的向量也会被自动清理。更换 embedding 模型导致维度变化时，必须用 `--rebuild` 全量重建。

### 工作原理

```
db-analyst
  → knowledge_search.ts                     .opencode/tools/knowledge_search.ts
    → POST /api/ai/tool/knowledge_search     app/route/ai_routes.py
      → knowledge_service.search_knowledge   app/service/knowledge_service.py
        → embedding_service 取查询向量        app/service/embedding_service.py
        → sqlite-vec KNN 检索 top-k 片段      data/kb.db
```

`db-analyst` 在回答业务概念、口径、规则类问题前会先调用 `knowledge_search`，基于命中的片段作答并标注来源 `doc_path`；数据类问题仍走 `db_schema` / `db_select`，两者可组合。检索过程会以「检索知识库」步骤事件展示在前端。

### 验证

先用 curl 直接测端点（`session_id` 需为一个已存在的 AI 会话）：

```bash
curl -s http://127.0.0.1:8000/api/ai/tool/knowledge_search \
  -H "Content-Type: application/json" \
  -d '{"session_id":"<已存在的会话id>","query":"套餐怎么退费","top_k":3}' | python3 -m json.tool
```

也可以绕过会话校验，直接验证检索本身：

```bash
.venv/bin/python -c "
import asyncio
from app.service.knowledge_service import search_knowledge
print(asyncio.run(search_knowledge('套餐怎么退费', 3)))
"
```

返回结果按 `distance` 升序排列，值越小越相关。

## 启动 Web 项目

`start.sh` 是后台服务管理脚本，支持启动、停止、重启和查看状态：

```bash
chmod +x start.sh
./start.sh          # 等价于 ./start.sh start，后台启动
./start.sh status   # 查看运行状态、PID、端口
./start.sh stop     # 停止（先发 TERM，最多等 10 秒，再 KILL 兜底）
./start.sh restart  # 重启
```

后台启动后：

- PID 写入 `log/app/app.pid`，实际端口写入 `log/app/app.port`；启动后会等待约 1.5 秒确认进程存活才报成功，失败时自动打印 `log/app/startup.log` 末尾并退出。
- 脚本会缓存 `requirements.txt` 的指纹，依赖没变化时跳过安装，第二次启动更快。需要强制重装依赖时：`FORCE_INSTALL=1 ./start.sh`。
- 演示 SQLite 数据库 `app.db` 不存在时会自动创建，端口被占用时默认在 `PORT` 基础上自动顺延查找空闲端口。

需要前台运行（例如本地调试）：

```bash
FOREGROUND=1 ./start.sh
```

常用环境变量：

- `HOST` / `PORT`：监听地址和端口，默认 `127.0.0.1:8000`
- `AUTO_PORT`：端口被占用时是否自动顺延，默认 `1`
- `FORCE_INSTALL`：强制重装依赖，默认 `0`
- `FOREGROUND`：前台运行，默认 `0`（后台）
- `LOG_LEVEL`：uvicorn 日志级别，默认 `info`
- `LOG_BACKUP_DAYS`：按天切分日志的保留天数，默认 `14`

### 日志

应用日志统一输出到 `log/app/app.log`，通过 uvicorn 的 `--log-config` 使用 `TimedRotatingFileHandler`，每天零点自动切分为 `log/app/app.log.YYYY-MM-DD`，默认保留最近 14 天（由 `LOG_BACKUP_DAYS` 控制）。uvicorn、错误和访问日志都汇入同一个按天切分的文件。`log/app/startup.log` 仅用于兜底捕获启动前的致命错误。`log/` 已加入 `.gitignore`，不会提交到 git。

也可以手动创建演示 SQLite 数据库并直接用 uvicorn 前台启动（不带日志切分）：

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

### 后台运行（带日志切分）

`start_opencode.sh` 是 OpenCode Server 的后台服务管理脚本，用法和 `start.sh` 一致，支持启动、停止、重启和查看状态：

```bash
chmod +x start_opencode.sh
./start_opencode.sh          # 等价于 ./start_opencode.sh start，后台启动
./start_opencode.sh status   # 查看运行状态、PID、端口
./start_opencode.sh stop     # 停止（先发 TERM，最多等 10 秒，再 KILL 兜底）
./start_opencode.sh restart  # 重启
```

后台启动后：

- PID 写入 `log/opencode/opencode.pid`，实际监听地址写入 `log/opencode/opencode.port`；启动后会等待约 1.5 秒确认进程存活才报成功，失败时自动打印 `log/opencode/startup.log` 末尾并退出。
- OpenCode 的运行日志统一输出到 `log/opencode/opencode.log`，每天零点自动切分为 `log/opencode/opencode.log.YYYY-MM-DD`，默认保留最近 14 天（由 `OPENCODE_LOG_BACKUP_DAYS` 控制）。`log/` 已加入 `.gitignore`，不会提交到 git。
- 脚本内部通过 `scripts/opencode_serve.py` 启动，会先加载根目录 `.env` 并校验 `HUAYAN_API_BASE` / `HUAYAN_API_KEY`，日志切分复用和应用日志相同的 `TimedRotatingFileHandler` 机制。

需要前台运行（例如本地调试）：

```bash
FOREGROUND=1 ./start_opencode.sh
```

可选环境变量：

- `OPENCODE_HOST` / `OPENCODE_PORT`：控制 `scripts/start_opencode.py` 和 `start_opencode.sh` 启动地址，默认 `127.0.0.1:4096`
- `OPENCODE_LOG_BACKUP_DAYS`：`start_opencode.sh` 后台日志按天切分的保留天数，默认 `14`
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
- 连接分组：支持新建、重命名、删除分组，可拖拽连接或在弹窗里选择分组归组，展开状态本地保存
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
POST   /api/ai/tool/knowledge_search
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
