# SQL Redis Visual Tool

一个连接 SQL 和 Redis 的小型可视化项目。它包含：

- FastAPI 后端接口
- 原生 HTML/CSS/JS 前端
- SQL 数据表浏览
- SELECT SQL 查询
- 在可视化表格里直接修改单元格
- 前端添加和保存数据库连接
- Redis 连接检测和 key 查看接口
- 保留原来的 CLI 缓存/同步工具

## 安装

```bash
pip install -r requirements.txt
```

如果连接 MySQL 或 PostgreSQL，还需要在 `requirements.txt` 里打开对应驱动依赖。

## 配置

Web 前端支持直接添加连接。连接信息保存在浏览器本地 `localStorage`，重新打开页面后会显示，但不会自动连接数据库；只有点击某个连接时，才会把连接信息发给后端并连接数据库。

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

先创建一个演示 SQLite 数据库：

```bash
python scripts/create_demo_db.py
```

启动服务：

```bash
uvicorn app.main:app --reload
```

打开：

```text
http://127.0.0.1:8000
```

## 前端功能

- 添加连接：填写连接名称、SQL URL、Redis URL 后保存
- 添加连接：点击“新建连接”后在弹窗里填写
- 添加连接：可选择连接串模式，支持 `local_user:local_password@(127.0.0.1:3306)/local_db?charset=utf8&loc=Asia%2FShanghai&parseTime=true` 这类格式
- 添加连接：也可以选择 IP/Port 模式，然后填写 Driver、IP/Host、端口、用户名、密码、数据库名自动生成 SQL URL
- 本地保存：刷新或重新打开页面后显示已保存连接
- 手动连接：点击连接名称后才真正连接数据库
- 编辑连接：已保存连接旁边有编辑按钮，鼠标悬停会显示 SQL / Redis 连接信息
- 支持同时打开不同数据库连接下的多个数据表 tab
- 左侧每个数据库连接下拉展示自己的数据表，便于同时浏览多个数据库
- 每个数据表可展开查看字段、外键、索引信息
- 点击表名后可视化展示数据，默认先加载前 100 行，滚动到底部后继续加载下一批 100 行
- 点击表名后会在右侧工作区打开浏览数据 tab，标题包含当前表名和连接地址
- 有主键的表可以编辑非主键单元格，点击“提交更新”后才会写入数据库
- 可以勾选数据行并标记删除，点击“提交更新”后才会删除数据库里的行
- 可以点击“新增行”创建虚拟行，填写后点击“提交更新”写入数据库
- 上方 SQL 编辑器支持 `SELECT` / `WITH` 查询
- SQL 查询默认限制 100 行，查询结果只读，避免误更新复杂查询结果

## API

```text
GET    /api/health
POST   /api/connections/test
POST   /api/tables
POST   /api/tables/{table_name}/rows
PATCH  /api/tables/{table_name}/cell
POST   /api/tables/{table_name}/rows/insert
POST   /api/tables/{table_name}/rows/delete
POST   /api/query
POST   /api/redis/keys
POST   /api/redis/value
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

---

# SQL Redis Visual Tool

A lightweight visual tool for working with SQL databases and Redis. It includes:

- FastAPI backend APIs
- Native HTML/CSS/JavaScript frontend
- SQL table browsing
- `SELECT` SQL query execution
- Direct cell editing in a visual data grid
- Browser-side database connection management
- Redis connection checks and key inspection APIs
- The original CLI utilities for SQL query caching and table synchronization

## Installation

```bash
pip install -r requirements.txt
```

If you want to connect to MySQL or PostgreSQL, enable or install the matching driver dependency in `requirements.txt`.

## Configuration

The web frontend lets you add database connections directly. Connection details are stored in browser `localStorage`, so they remain visible after refreshing or reopening the page. The app does not automatically connect to a database; it only sends connection details to the backend when you click a saved connection.

You can use the default SQLite database in the current directory:

```bash
sqlite:///app.db
redis://localhost:6379/0
```

You can also add a MySQL connection in the frontend:

```text
mysql+pymysql://user:password@localhost:3306/app
```

Or PostgreSQL:

```text
postgresql+psycopg://user:password@localhost:5432/app
```

## Run The Web App

Start everything with one command:

```bash
chmod +x start.sh
./start.sh
```

The script caches a fingerprint of `requirements.txt`. If dependencies have not changed, it skips installation on the next run. To force dependency installation:

```bash
FORCE_INSTALL=1 ./start.sh
```

Create a demo SQLite database first:

```bash
python scripts/create_demo_db.py
```

Start the server:

```bash
uvicorn app.main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

## Frontend Features

- Add a connection by entering a connection name, SQL URL, and Redis URL
- Open the connection modal from the "New Connection" button
- Use DSN mode with strings such as `local_user:local_password@(127.0.0.1:3306)/local_db?charset=utf8&loc=Asia%2FShanghai&parseTime=true`
- Use IP/Port mode to generate a SQL URL from driver, host, port, username, password, and database name
- Store connections locally and show them again after refresh or reopen
- Connect manually by clicking a saved connection
- Edit saved connections and preview SQL / Redis connection info on hover
- Open multiple table tabs from different database connections at the same time
- Show each connection's tables in the sidebar
- Expand each table to inspect columns, foreign keys, and indexes
- Load table data visually, with the first 100 rows loaded by default and more rows loaded while scrolling
- Open a table tab with the table name and connection address in the workspace title
- Edit non-primary-key cells for tables that have a primary key, then persist changes with "Commit Updates"
- Select rows and mark them for deletion, then delete them with "Commit Updates"
- Add virtual rows with "Add Row", fill values, then insert them with "Commit Updates"
- Run `SELECT` / `WITH` queries from the SQL editor
- Limit ad hoc SQL queries to 100 rows by default and keep query results read-only

## API

```text
GET    /api/health
POST   /api/connections/test
POST   /api/tables
POST   /api/tables/{table_name}/rows
PATCH  /api/tables/{table_name}/cell
POST   /api/tables/{table_name}/rows/insert
POST   /api/tables/{table_name}/rows/delete
POST   /api/query
POST   /api/redis/keys
POST   /api/redis/value
```

## CLI Usage

Check connections:

```bash
python sql_redis_tool.py health
```

Run a SQL query and cache the result for 300 seconds:

```bash
python sql_redis_tool.py query-cache \
  --sql "select id, name from users where id = :id" \
  --params '{"id": 1}' \
  --ttl 300
```

Sync a SQL table into Redis hashes:

```bash
python sql_redis_tool.py sync-table \
  --table users \
  --id-column id \
  --prefix user \
  --ttl 3600
```
