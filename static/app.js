const state = {
  connections: [],
  activeConnectionId: null,
  editingConnectionId: null,
  tabs: [],
  activeTabId: null,
  activeTable: null,
  activeRows: [],
  activeRowsTotal: 0,
  activeRealRowsLoaded: 0,
  isLoadingRows: false,
  pendingChanges: new Map(),
  pendingInserts: [],
  pendingDeletes: new Map(),
  queryMode: false,
};

const STORAGE_KEY = "sqlRedisVisualConnections";
const SIDEBAR_WIDTH_KEY = "sqlRedisVisualSidebarWidth";
const COLUMN_WIDTHS_KEY = "sqlRedisVisualColumnWidths";
const DEFAULT_REDIS_URL = "redis://localhost:6379/0";
const TABLE_ROW_LIMIT = 100;
const QUERY_ROW_LIMIT = 100;

const els = {
  sqlStatus: document.querySelector("#sqlStatus"),
  redisStatus: document.querySelector("#redisStatus"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  newConnectionButton: document.querySelector("#newConnectionButton"),
  connectionModal: document.querySelector("#connectionModal"),
  connectionModalTitle: document.querySelector("#connectionModalTitle"),
  closeConnectionModal: document.querySelector("#closeConnectionModal"),
  cancelConnectionButton: document.querySelector("#cancelConnectionButton"),
  connectionForm: document.querySelector("#connectionForm"),
  connectionName: document.querySelector("#connectionName"),
  connectionMode: () => document.querySelector('input[name="connectionMode"]:checked')?.value || "dsn",
  dsnFields: document.querySelector("#dsnFields"),
  fieldInputs: document.querySelector("#fieldInputs"),
  driverSelect: document.querySelector("#driverSelect"),
  dsnInput: document.querySelector("#dsnInput"),
  dbHost: document.querySelector("#dbHost"),
  dbPort: document.querySelector("#dbPort"),
  dbUser: document.querySelector("#dbUser"),
  dbPassword: document.querySelector("#dbPassword"),
  dbName: document.querySelector("#dbName"),
  sqlUrl: document.querySelector("#sqlUrl"),
  redisUrl: document.querySelector("#redisUrl"),
  connectionList: document.querySelector("#connectionList"),
  viewTitle: document.querySelector("#viewTitle"),
  viewMeta: document.querySelector("#viewMeta"),
  addRowButton: document.querySelector("#addRowButton"),
  deleteRowsButton: document.querySelector("#deleteRowsButton"),
  commitButton: document.querySelector("#commitButton"),
  refreshButton: document.querySelector("#refreshButton"),
  sqlEditor: document.querySelector("#sqlEditor"),
  limitInput: document.querySelector("#limitInput"),
  runQueryButton: document.querySelector("#runQueryButton"),
  message: document.querySelector("#message"),
  tabBar: document.querySelector("#tabBar"),
  tableWrap: document.querySelector(".table-wrap"),
  table: document.querySelector("#dataTable"),
  thead: document.querySelector("#dataTable thead"),
  tbody: document.querySelector("#dataTable tbody"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }
  return data;
}

function activeConnection() {
  return state.connections.find((connection) => connection.id === state.activeConnectionId) || null;
}

function connectionById(id) {
  return state.connections.find((connection) => connection.id === id) || null;
}

function connectionPayload(connection = null) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const selectedConnection = connection || activeTab?.connection || activeConnection();
  const connectionForError = selectedConnection;
  if (!connectionForError) {
    throw new Error("请先选择一个连接");
  }
  return {
    sql_url: selectedConnection.sqlUrl,
    redis_url: selectedConnection.redisUrl || DEFAULT_REDIS_URL,
  };
}

function setMessage(text, isError = false) {
  els.message.textContent = text || "";
  els.message.classList.toggle("error", isError);
}

function loadColumnWidths() {
  try {
    return JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveColumnWidth(key, width) {
  const widths = loadColumnWidths();
  widths[key] = width;
  localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
}

function columnWidthKey(column) {
  const tableName = state.activeTable?.name || "query";
  return `${state.activeConnectionId || "query"}::${tableName}::${column}`;
}

function columnWidth(column) {
  const saved = loadColumnWidths()[columnWidthKey(column)];
  return Math.max(70, Number(saved) || defaultColumnWidth(column));
}

function defaultColumnWidth(column) {
  if (column === "__select") return 42;
  return Math.min(360, Math.max(120, String(column).length * 12 + 44));
}

function applyColumnWidth(index, width) {
  const col = els.table.querySelector(`col[data-col-index="${index}"]`);
  if (col) col.style.width = `${width}px`;
}

function setupColumnResize(handle, column, index) {
  let startX = 0;
  let startWidth = 0;

  function onMove(event) {
    const nextWidth = Math.max(70, startWidth + event.clientX - startX);
    applyColumnWidth(index, nextWidth);
  }

  function onUp(event) {
    const nextWidth = Math.max(70, startWidth + event.clientX - startX);
    saveColumnWidth(columnWidthKey(column), nextWidth);
    document.body.classList.remove("resizing-column");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }

  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startX = event.clientX;
    const col = els.table.querySelector(`col[data-col-index="${index}"]`);
    startWidth = Number.parseFloat(col?.style.width) || defaultColumnWidth(column);
    document.body.classList.add("resizing-column");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

function setSidebarWidth(width) {
  const nextWidth = Math.max(220, Math.min(560, width));
  document.documentElement.style.setProperty("--sidebar-width", `${nextWidth}px`);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
}

function setupSidebarResize() {
  const savedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (savedWidth) {
    setSidebarWidth(savedWidth);
  }

  let startX = 0;
  let startWidth = 0;

  function onMove(event) {
    setSidebarWidth(startWidth + event.clientX - startX);
  }

  function onUp() {
    document.body.classList.remove("resizing");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }

  els.sidebarResizeHandle.addEventListener("mousedown", (event) => {
    startX = event.clientX;
    startWidth = Number(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width").replace("px", "")) || 280;
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

function changeKey(primaryKeyValue, column) {
  return `${String(primaryKeyValue)}::${column}`;
}

function updateCommitButton() {
  const count = state.pendingChanges.size + state.pendingInserts.length + state.pendingDeletes.size;
  els.commitButton.disabled = count === 0;
  els.commitButton.textContent = count > 0 ? `提交更新 (${count})` : "提交更新";
  els.deleteRowsButton.disabled = !state.activeTable || state.queryMode || selectedRows().length === 0;
  els.addRowButton.disabled = !state.activeTable || state.queryMode;
}

function clearPendingChanges() {
  state.pendingChanges.clear();
  state.pendingInserts = [];
  state.pendingDeletes.clear();
  updateCommitButton();
}

function buildSqlUrlFromFields() {
  const driver = els.driverSelect.value;
  const host = els.dbHost.value.trim();
  const port = els.dbPort.value.trim();
  const user = els.dbUser.value.trim();
  const password = els.dbPassword.value;
  const dbName = els.dbName.value.trim();

  if (driver === "sqlite") {
    return dbName ? `sqlite:///${dbName}` : "";
  }
  if (!host || !port || !dbName) {
    return "";
  }

  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : "";
  if (driver === "postgresql") {
    return `postgresql+psycopg://${auth}${host}:${port}/${dbName}`;
  }
  if (driver === "clickhouse") {
    return `clickhouse+http://${auth}${host}:${port}/${dbName}`;
  }
  return `mysql+pymysql://${auth}${host}:${port}/${dbName}`;
}

function buildSqlUrlFromDsn() {
  const driver = els.driverSelect.value;
  const raw = els.dsnInput.value.trim();
  if (!raw) return "";
  if (raw.includes("://")) return raw;

  const match = raw.match(/^([^:]+):(.+)@\(([^:]+):(\d+)\)\/([^?]+)(?:\?(.*))?$/);
  if (!match) return raw;

  const [, user, password, host, port, dbName, query] = match;
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`;
  const suffix = query ? `?${query}` : "";

  if (driver === "postgresql") {
    return `postgresql+psycopg://${auth}${host}:${port}/${dbName}${suffix}`;
  }
  if (driver === "clickhouse") {
    return `clickhouse+http://${auth}${host}:${port}/${dbName}${suffix}`;
  }
  return `mysql+pymysql://${auth}${host}:${port}/${dbName}${suffix}`;
}

function buildSqlUrl() {
  return els.connectionMode() === "fields" ? buildSqlUrlFromFields() : buildSqlUrlFromDsn();
}

function updateSqlUrlFromFields() {
  const builtSqlUrl = buildSqlUrl();
  if (builtSqlUrl) {
    els.sqlUrl.value = builtSqlUrl;
  }
}

function setConnectionMode(mode) {
  document.querySelectorAll('input[name="connectionMode"]').forEach((input) => {
    input.checked = input.value === mode;
  });
  els.dsnFields.classList.toggle("hidden", mode !== "dsn");
  els.fieldInputs.classList.toggle("hidden", mode !== "fields");
  updateSqlUrlFromFields();
}

function fillConnectionFieldsFromUrl(sqlUrl) {
  const match = sqlUrl.match(/^(mysql\+pymysql|postgresql\+psycopg|clickhouse\+http):\/\/(?:(.*?)(?::(.*?))?@)?([^:/]+):(\d+)\/(.+)$/);
  if (!match) return;

  const [, scheme, user, password, host, port, dbName] = match;
  if (scheme.startsWith("postgresql")) els.driverSelect.value = "postgresql";
  else if (scheme.startsWith("clickhouse")) els.driverSelect.value = "clickhouse";
  else els.driverSelect.value = "mysql";
  els.dbHost.value = host || "";
  els.dbPort.value = port || "";
  els.dbUser.value = user ? decodeURIComponent(user) : "";
  els.dbPassword.value = password ? decodeURIComponent(password) : "";
  els.dbName.value = dbName ? decodeURIComponent(dbName) : "";
}

function setStatus(el, ok) {
  el.classList.remove("pending", "ok", "bad");
  el.classList.add(ok ? "ok" : "bad");
}

function setPendingStatus() {
  els.sqlStatus.className = "status-dot pending";
  els.redisStatus.className = "status-dot pending";
}

function loadStoredConnections() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredConnections() {
  const persisted = state.connections.map(({ tables, loadingTables, ...connection }) => connection);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function renderConnections() {
  els.connectionList.innerHTML = "";
  state.connections.forEach((connection) => {
    const item = document.createElement("details");
    item.className = "connection-item";
    item.open = connection.id === state.activeConnectionId;
    item.classList.toggle("active", connection.id === state.activeConnectionId);
    item.title = `SQL: ${connection.sqlUrl}\nRedis: ${connection.redisUrl || DEFAULT_REDIS_URL}`;

    const summary = document.createElement("summary");
    summary.className = "connection-summary";

    const main = document.createElement("button");
    main.type = "button";
    main.className = "connection-main";
    main.textContent = connection.name;
    main.addEventListener("click", () => {
      useConnection(connection.id);
    });

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "connection-edit";
    edit.textContent = "编辑";
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      editConnection(connection.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "connection-remove";
    remove.textContent = "删除";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      deleteConnection(connection.id);
    });

    summary.append(main, edit, remove);
    item.append(summary);
    item.appendChild(renderConnectionTables(connection));
    els.connectionList.appendChild(item);
  });
}

function renderConnectionTables(connection) {
  const wrapper = document.createElement("div");
  wrapper.className = "connection-tables";

  if (connection.loadingTables) {
    const loading = document.createElement("div");
    loading.className = "connection-empty";
    loading.textContent = "正在加载数据表...";
    wrapper.appendChild(loading);
    return wrapper;
  }

  const tables = connection.tables || [];
  if (tables.length === 0) {
    const empty = document.createElement("div");
    empty.className = "connection-empty";
    empty.textContent = "点击连接加载数据表";
    wrapper.appendChild(empty);
    return wrapper;
  }

  tables.forEach((table) => wrapper.appendChild(renderTableItem(connection, table)));
  return wrapper;
}

function openConnectionModal(connection = null) {
  state.editingConnectionId = connection?.id || null;
  els.connectionModalTitle.textContent = connection ? "编辑连接" : "新建连接";
  els.connectionForm.reset();
  els.redisUrl.value = DEFAULT_REDIS_URL;
  setConnectionMode("dsn");

  if (connection) {
    els.connectionName.value = connection.name;
    els.sqlUrl.value = connection.sqlUrl;
    els.redisUrl.value = connection.redisUrl || DEFAULT_REDIS_URL;
    fillConnectionFieldsFromUrl(connection.sqlUrl);
    els.dsnInput.value = connection.sqlUrl;
  }

  els.connectionModal.classList.remove("hidden");
  els.connectionName.focus();
}

function closeConnectionModal() {
  state.editingConnectionId = null;
  els.connectionModal.classList.add("hidden");
}

function resetDataView() {
  state.activeTable = null;
  state.activeRows = [];
  state.activeRowsTotal = 0;
  state.activeRealRowsLoaded = 0;
  state.isLoadingRows = false;
  state.queryMode = false;
  clearPendingChanges();
  renderConnections();
  renderGrid([], [], false);
}

function connectionHostLabel() {
  const connection = activeConnection();
  if (!connection) return "";
  try {
    return `@${new URL(connection.sqlUrl).host}`;
  } catch {
    return "";
  }
}

function tableTabId(tableName) {
  return `${state.activeConnectionId || "connection"}::${tableName}`;
}

function renderTabs() {
  els.tabBar.innerHTML = "";
  state.tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-item";
    button.classList.toggle("active", tab.id === state.activeTabId);
    button.title = `${tab.table.name} ${tab.hostLabel}`;
    button.addEventListener("click", () => switchTab(tab.id));

    const label = document.createElement("span");
    label.textContent = `浏览数据 ${tab.table.name} ${tab.hostLabel}`;

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    button.append(label, close);
    els.tabBar.appendChild(button);
  });
}

function openTableTab(table) {
  const connection = activeConnection();
  if (!connection) {
    setMessage("请先选择一个连接", true);
    return;
  }
  const id = tableTabId(table.name);
  let tab = state.tabs.find((item) => item.id === id);
  if (!tab) {
    tab = {
      id,
      table,
      connection: { ...connection },
      connectionId: connection.id,
      hostLabel: connectionHostLabel(),
    };
    state.tabs.push(tab);
  }
  return switchTab(id);
}

async function switchTab(id) {
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab) return;

  state.activeTabId = id;
  state.activeConnectionId = tab.connectionId;
  state.activeTable = tab.table;
  state.queryMode = false;
  clearPendingChanges();
  renderTabs();
  renderConnections();
  els.viewTitle.textContent = `浏览数据 ${tab.table.name}`;
  els.viewMeta.textContent = `${tab.hostLabel}，每次加载 ${TABLE_ROW_LIMIT} 行`;
  els.sqlEditor.value = `select * from ${tab.table.name}`;
  await loadRows({ append: false });
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  state.tabs.splice(index, 1);

  if (state.activeTabId === id) {
    const nextTab = state.tabs[index] || state.tabs[index - 1] || null;
    state.activeTabId = null;
    state.activeTable = null;
    clearPendingChanges();
    renderGrid([], [], false);
    if (nextTab) {
      switchTab(nextTab.id);
    } else {
      renderTabs();
      renderConnections();
      els.viewTitle.textContent = "选择数据表";
      els.viewMeta.textContent = "点击左侧数据表会在右侧打开 tab";
      setMessage("请选择数据表");
    }
  } else {
    renderTabs();
  }
}

function addConnection(event) {
  event.preventDefault();
  const name = els.connectionName.value.trim();
  const builtSqlUrl = buildSqlUrl();
  const sqlUrl = els.sqlUrl.value.trim() || builtSqlUrl;
  const redisUrl = els.redisUrl.value.trim() || DEFAULT_REDIS_URL;

  if (!name || !sqlUrl) {
    setMessage("连接名称和 SQL URL 不能为空，也可以填写 IP/端口/用户名/密码/数据库名自动生成", true);
    return;
  }

  const existing = state.editingConnectionId
    ? state.connections.find((connection) => connection.id === state.editingConnectionId)
    : state.connections.find((connection) => connection.name === name);

  if (existing) {
    const oldActiveId = existing.id;
    const nameChanged = existing.name !== name;
    existing.name = name;
    existing.sqlUrl = sqlUrl;
    existing.redisUrl = redisUrl;
    if (state.activeConnectionId === oldActiveId && nameChanged) {
      els.viewTitle.textContent = name;
    }
  } else {
    state.connections.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      sqlUrl,
      redisUrl,
    });
  }

  saveStoredConnections();
  renderConnections();
  state.editingConnectionId = null;
  closeConnectionModal();
  setMessage("连接已保存，点击连接名称后才会连接数据库");
}

function editConnection(id) {
  const connection = state.connections.find((item) => item.id === id);
  if (!connection) return;
  openConnectionModal(connection);
  setMessage("正在编辑连接，保存后不会自动重新连接数据库");
}

async function deleteConnection(id) {
  state.connections = state.connections.filter((connection) => connection.id !== id);
  state.tabs = state.tabs.filter((tab) => tab.connectionId !== id);
  if (state.activeConnectionId === id) {
    state.activeConnectionId = null;
    setPendingStatus();
    if (state.tabs.length > 0) {
      await switchTab(state.tabs[0].id);
    } else {
      state.activeTabId = null;
      state.activeTable = null;
      state.activeRows = [];
      state.activeRowsTotal = 0;
      state.activeRealRowsLoaded = 0;
      clearPendingChanges();
      renderTabs();
      renderConnections();
      renderGrid([], [], false);
      els.viewTitle.textContent = "选择连接";
      els.viewMeta.textContent = "本地连接已显示，点击后才连接数据库";
    }
  }
  saveStoredConnections();
  renderConnections();
}

async function useConnection(id) {
  state.activeConnectionId = id;
  state.activeTable = null;
  state.activeRows = [];
  state.activeRowsTotal = 0;
  state.activeRealRowsLoaded = 0;
  state.isLoadingRows = false;
  state.queryMode = false;
  clearPendingChanges();
  renderConnections();
  setPendingStatus();
  const connection = activeConnection();
  els.viewTitle.textContent = connection.name;
  els.viewMeta.textContent = "正在连接数据库...";
  setMessage("正在连接数据库...");
  try {
    await loadHealth();
    await loadTables();
  } catch (error) {
    setStatus(els.sqlStatus, false);
    setMessage(error.message, true);
    els.viewMeta.textContent = "连接失败，请检查连接信息或网络";
  }
}

async function loadHealth() {
  try {
    const health = await api("/api/connections/test", {
      method: "POST",
      body: JSON.stringify(connectionPayload(activeConnection())),
    });
    setStatus(els.sqlStatus, health.sql);
    setStatus(els.redisStatus, health.redis);
  } catch (error) {
    setStatus(els.sqlStatus, false);
    setStatus(els.redisStatus, false);
    setMessage(error.message, true);
  }
}

async function loadTables() {
  const connection = activeConnection();
  if (!connection) return;
  connection.loadingTables = true;
  renderConnections();
  const data = await api("/api/tables", {
    method: "POST",
    body: JSON.stringify(connectionPayload(connection)),
  });
  connection.tables = data.tables;
  connection.loadingTables = false;
  renderConnections();

  if (state.activeTable && state.activeConnectionId === connection.id && !data.tables.some((table) => table.name === state.activeTable.name)) {
    state.activeTable = null;
  }

  if (data.tables.length === 0) {
    renderGrid([], []);
    els.viewTitle.textContent = "没有数据表";
    els.viewMeta.textContent = "连接的数据库暂时没有可视化表";
  } else if (!state.activeTable) {
    renderGrid([], []);
    els.viewTitle.textContent = "选择数据表";
    els.viewMeta.textContent = "点击连接下的数据表会在右侧打开 tab";
    setMessage(`已加载 ${data.tables.length} 个数据表`);
  }
}

function renderTableItem(connection, table) {
  const item = document.createElement("details");
  item.className = "table-item";

  const summary = document.createElement("summary");
  summary.className = "table-summary";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "table-open";
  openButton.classList.toggle("active", state.activeTable?.name === table.name && state.activeConnectionId === connection.id);
  openButton.textContent = table.name;
  openButton.addEventListener("click", (event) => {
    event.preventDefault();
    selectTable(connection.id, table.name);
  });

  summary.appendChild(openButton);
  item.appendChild(summary);
  item.appendChild(renderTableMeta(table));
  return item;
}

function renderTableMeta(table) {
  const meta = document.createElement("div");
  meta.className = "table-meta";

  meta.appendChild(renderMetaSection(
    "字段",
    table.columns.map((column) => {
      const tags = [];
      if (column.primary_key) tags.push("PK");
      if (column.nullable === false) tags.push("NOT NULL");
      if (column.default !== undefined && column.default !== null) tags.push(`DEFAULT ${column.default}`);
      return `${column.name} · ${column.type}${tags.length ? ` · ${tags.join(" · ")}` : ""}`;
    }),
  ));

  meta.appendChild(renderMetaSection(
    "外键",
    (table.foreign_keys || []).map((fk) => {
      const columns = (fk.columns || []).join(", ");
      const referredColumns = (fk.referred_columns || []).join(", ");
      return `${columns} → ${fk.referred_table || "-"}(${referredColumns})`;
    }),
  ));

  meta.appendChild(renderMetaSection(
    "索引",
    (table.indexes || []).map((index) => {
      const columns = (index.columns || []).join(", ");
      return `${index.name || "-"} · ${columns}${index.unique ? " · UNIQUE" : ""}`;
    }),
  ));

  return meta;
}

function renderMetaSection(title, items) {
  const section = document.createElement("details");
  section.className = "meta-section";

  const heading = document.createElement("summary");
  heading.className = "meta-heading";
  heading.textContent = `${title} (${items.length})`;
  section.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "meta-list";
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "无";
    list.appendChild(empty);
  } else {
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      li.title = item;
      list.appendChild(li);
    });
  }
  section.appendChild(list);
  return section;
}

async function selectTable(connectionId, name) {
  const connection = connectionById(connectionId);
  const table = connection?.tables?.find((item) => item.name === name);
  if (!table) return;
  state.activeConnectionId = connectionId;
  renderConnections();
  await openTableTab(table);
}

async function loadRows({ append = false } = {}) {
  if (!state.activeTable) return;
  if (state.isLoadingRows) return;
  if (append && state.activeRealRowsLoaded >= state.activeRowsTotal) return;

  state.isLoadingRows = true;
  const offset = append ? state.activeRealRowsLoaded : 0;
  if (!append) {
    clearPendingChanges();
  }
  setMessage(append ? `正在继续加载 ${TABLE_ROW_LIMIT} 行数据...` : `正在加载前 ${TABLE_ROW_LIMIT} 行数据...`);
  try {
    const data = await api(`/api/tables/${encodeURIComponent(state.activeTable.name)}/rows?limit=${TABLE_ROW_LIMIT}&offset=${offset}`, {
      method: "POST",
      body: JSON.stringify(connectionPayload()),
    });
    state.activeRowsTotal = data.total;
    const columns = state.activeTable.columns.map((column) => column.name);
    if (append) {
      state.activeRows = state.activeRows.concat(data.rows);
      appendRows(columns, data.rows, true, state.activeRows.length - data.rows.length);
      state.activeRealRowsLoaded += data.rows.length;
    } else {
      state.activeRows = data.rows;
      state.activeRealRowsLoaded = data.rows.length;
      renderGrid(columns, state.activeRows, true);
      els.tableWrap.scrollTop = 0;
    }
    const hasMore = state.activeRealRowsLoaded < state.activeRowsTotal;
    setMessage(`共 ${data.total} 行，当前显示 ${state.activeRealRowsLoaded} 行${hasMore ? "，滚动到底部继续加载" : ""}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    state.isLoadingRows = false;
  }
}

async function runQuery() {
  const queryLimit = Number(els.limitInput.value || QUERY_ROW_LIMIT);
  setMessage(`正在执行查询，默认限制 ${queryLimit} 行...`);
  try {
    const data = await api("/api/query", {
      method: "POST",
      body: JSON.stringify({
        sql: els.sqlEditor.value,
        connection: connectionPayload(),
        limit: queryLimit,
      }),
    });
    state.queryMode = true;
    state.activeTabId = null;
    state.activeTable = null;
    clearPendingChanges();
    renderTabs();
    renderConnections();
    renderGrid(data.columns, data.rows, false);
    els.viewTitle.textContent = "SQL 查询结果";
    els.viewMeta.textContent = `查询结果只读，默认限制 ${data.limit || queryLimit} 行`;
    setMessage(`返回 ${data.rows.length} 行，默认限制 ${data.limit || queryLimit} 行`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function renderGrid(columns, rows, editable) {
  els.thead.innerHTML = "";
  els.tbody.innerHTML = "";
  els.table.querySelector("colgroup")?.remove();

  if (columns.length === 0) {
    return;
  }

  const displayColumns = editable && state.activeTable?.primary_key ? ["__select", ...columns] : columns;
  const colgroup = document.createElement("colgroup");
  displayColumns.forEach((column, index) => {
    const col = document.createElement("col");
    col.dataset.colIndex = String(index);
    col.style.width = `${columnWidth(column)}px`;
    colgroup.appendChild(col);
  });
  els.table.prepend(colgroup);

  const headerRow = document.createElement("tr");
  if (editable && state.activeTable?.primary_key) {
    const selectHeader = document.createElement("th");
    selectHeader.className = "select-column";
    selectHeader.dataset.colIndex = "0";
    headerRow.appendChild(selectHeader);
  }
  columns.forEach((column, columnIndex) => {
    const displayIndex = editable && state.activeTable?.primary_key ? columnIndex + 1 : columnIndex;
    const th = document.createElement("th");
    th.dataset.colIndex = String(displayIndex);
    const label = document.createElement("span");
    label.className = "th-label";
    label.textContent = column;
    const handle = document.createElement("span");
    handle.className = "column-resize-handle";
    handle.title = "拖动调整列宽";
    setupColumnResize(handle, column, displayIndex);
    th.append(label, handle);
    headerRow.appendChild(th);
  });
  els.thead.appendChild(headerRow);

  appendRows(columns, rows, editable);
}

function appendRows(columns, rows, editable, startIndex = 0) {
  if (rows.length === 0) return;
  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    fragment.appendChild(createRowElement(columns, row, editable, startIndex + index));
  });
  els.tbody.appendChild(fragment);
}

function createRowElement(columns, row, editable, rowIndex) {
  const tr = document.createElement("tr");
  tr.dataset.rowIndex = String(rowIndex);
  if (row.__virtual) {
    tr.classList.add("virtual-row");
  }
  if (editable && state.activeTable?.primary_key) {
    const selectCell = document.createElement("td");
    selectCell.className = "select-column";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = Boolean(row.__virtual);
    checkbox.addEventListener("change", updateCommitButton);
    selectCell.appendChild(checkbox);
    tr.appendChild(selectCell);
  }
  columns.forEach((column) => {
    const td = document.createElement("td");
    const rawValue = row[column];
    td.textContent = rawValue === null || rawValue === undefined ? "" : String(rawValue);
    td.title = td.textContent;

    if (editable && canEditCell(row, column)) {
      td.contentEditable = "true";
      td.dataset.original = td.textContent;
      td.dataset.column = column;
      td.dataset.primaryKeyValue = row.__virtual ? "" : String(row[state.activeTable.primary_key]);
      td.addEventListener("focus", () => td.classList.add("editing"));
      td.addEventListener("blur", () => trackCellChange(td, row, column));
      td.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          td.blur();
        }
        if (event.key === "Escape") {
          td.textContent = td.dataset.original || "";
          td.blur();
        }
      });
    }

    tr.appendChild(td);
  });
  return tr;
}

function canEditColumn(column) {
  return state.activeTable?.primary_key && column !== state.activeTable.primary_key;
}

function canEditCell(row, column) {
  if (!state.activeTable) return false;
  if (row.__virtual) {
    const columnMeta = state.activeTable.columns.find((item) => item.name === column);
    return !columnMeta?.primary_key;
  }
  return canEditColumn(column);
}

function trackCellChange(td, row, column) {
  td.classList.remove("editing", "error");
  const nextValue = td.textContent;
  const original = td.dataset.original || "";

  if (row.__virtual) {
    row[column] = nextValue;
    td.classList.toggle("dirty", nextValue !== original);
    updateVirtualInsert(row);
    return;
  }

  const primaryKey = state.activeTable.primary_key;
  const primaryKeyValue = row[primaryKey];
  const key = changeKey(primaryKeyValue, column);

  if (nextValue === original) {
    state.pendingChanges.delete(key);
    td.classList.remove("dirty");
    updateCommitButton();
    return;
  }

  state.pendingChanges.set(key, {
    td,
    row,
    column,
    original,
    value: nextValue,
    primaryKey,
    primaryKeyValue,
  });
  td.classList.add("dirty");
  updateCommitButton();
  setMessage(`有 ${state.pendingChanges.size} 处修改待提交`);
}

function selectedRows() {
  return Array.from(els.tbody.querySelectorAll("tr"))
    .map((tr) => {
      const checkbox = tr.querySelector('input[type="checkbox"]');
      if (!checkbox || !checkbox.checked) return null;
      return state.activeRows[Number(tr.dataset.rowIndex)];
    })
    .filter(Boolean);
}

function updateVirtualInsert(row) {
  const hasValue = state.activeTable.columns.some((column) => {
    const value = row[column.name];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });

  if (!hasValue) {
    state.pendingInserts = state.pendingInserts.filter((item) => item !== row);
  } else if (!state.pendingInserts.includes(row)) {
    state.pendingInserts.push(row);
  }
  updateCommitButton();
  setMessage(`有 ${state.pendingChanges.size + state.pendingInserts.length + state.pendingDeletes.size} 处修改待提交`);
}

function addVirtualRow() {
  if (!state.activeTable || state.queryMode) return;
  const row = { __virtual: true, __clientId: `new-${Date.now()}` };
  state.activeTable.columns.forEach((column) => {
    row[column.name] = "";
  });
  state.activeRows.unshift(row);
  renderGrid(state.activeTable.columns.map((column) => column.name), state.activeRows, true);
  updateVirtualInsert(row);
  setMessage("已新增虚拟行，填写后点击提交更新");
}

function markSelectedRowsForDelete() {
  if (!state.activeTable?.primary_key || state.queryMode) return;
  const rows = selectedRows();
  if (rows.length === 0) return;

  rows.forEach((row) => {
    const primaryKeyValue = row[state.activeTable.primary_key];
    if (primaryKeyValue === undefined || primaryKeyValue === null || row.__virtual) return;
    state.pendingDeletes.set(String(primaryKeyValue), primaryKeyValue);
    state.pendingChanges.forEach((change, key) => {
      if (change.primaryKeyValue === primaryKeyValue) {
        state.pendingChanges.delete(key);
      }
    });
  });

  Array.from(els.tbody.querySelectorAll("tr")).forEach((tr, index) => {
    const row = state.activeRows[index];
    if (row && state.pendingDeletes.has(String(row[state.activeTable.primary_key]))) {
      tr.classList.add("delete-row");
    }
  });
  updateCommitButton();
  setMessage(`已标记 ${state.pendingDeletes.size} 行待删除，点击提交更新后生效`);
}

function handleTableScroll() {
  if (state.queryMode || !state.activeTable || state.isLoadingRows) return;
  if (state.activeRealRowsLoaded >= state.activeRowsTotal) return;

  const remaining = els.tableWrap.scrollHeight - els.tableWrap.scrollTop - els.tableWrap.clientHeight;
  if (remaining < 80) {
    loadRows({ append: true });
  }
}

function handleTableWheel(event) {
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

  const maxScrollLeft = els.tableWrap.scrollWidth - els.tableWrap.clientWidth;
  if (maxScrollLeft <= 0) return;

  event.preventDefault();
  els.tableWrap.scrollLeft = Math.max(
    0,
    Math.min(maxScrollLeft, els.tableWrap.scrollLeft + event.deltaX),
  );
}

async function commitChanges() {
  const totalChanges = state.pendingChanges.size + state.pendingInserts.length + state.pendingDeletes.size;
  if (totalChanges === 0) return;
  if (!state.activeTable || state.queryMode) {
    setMessage("当前视图不能提交更新", true);
    return;
  }

  const changes = Array.from(state.pendingChanges.values());
  els.commitButton.disabled = true;
  setMessage(`正在提交 ${totalChanges} 处修改...`);

  try {
    if (state.pendingDeletes.size > 0) {
      await api(`/api/tables/${encodeURIComponent(state.activeTable.name)}/rows/delete`, {
        method: "POST",
        body: JSON.stringify({
          primary_key: state.activeTable.primary_key,
          primary_key_values: Array.from(state.pendingDeletes.values()),
          connection: connectionPayload(),
        }),
      });
    }

    for (const row of state.pendingInserts) {
      const values = {};
      state.activeTable.columns.forEach((column) => {
        if (column.primary_key) return;
        const value = row[column.name];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          values[column.name] = value;
        }
      });
      await api(`/api/tables/${encodeURIComponent(state.activeTable.name)}/rows/insert`, {
        method: "POST",
        body: JSON.stringify({
          values,
          connection: connectionPayload(),
        }),
      });
    }

    for (const change of changes) {
      if (state.pendingDeletes.has(String(change.primaryKeyValue))) continue;
      change.td.classList.add("saving");
      await api(`/api/tables/${encodeURIComponent(state.activeTable.name)}/cell`, {
        method: "PATCH",
        body: JSON.stringify({
          primary_key: change.primaryKey,
          primary_key_value: change.primaryKeyValue,
          column: change.column,
          connection: connectionPayload(),
          value: change.value,
        }),
      });
      change.td.dataset.original = change.value;
      change.row[change.column] = change.value;
      change.td.classList.remove("dirty", "saving");
    }

    clearPendingChanges();
    setMessage(`已提交 ${totalChanges} 处修改`);
    await loadRows({ append: false });
  } catch (error) {
    changes.forEach((change) => change.td.classList.remove("saving"));
    setMessage(error.message, true);
  } finally {
    updateCommitButton();
  }
}

els.refreshButton.addEventListener("click", async () => {
  if (!activeConnection()) {
    setMessage("请先选择一个连接", true);
    return;
  }
  await loadHealth();
  if (state.queryMode) {
    await runQuery();
  } else if (state.activeTable) {
    await loadRows({ append: false });
  } else {
    await loadTables();
  }
});

els.runQueryButton.addEventListener("click", runQuery);
els.addRowButton.addEventListener("click", addVirtualRow);
els.deleteRowsButton.addEventListener("click", markSelectedRowsForDelete);
els.commitButton.addEventListener("click", commitChanges);
els.connectionForm.addEventListener("submit", addConnection);
els.tableWrap.addEventListener("scroll", handleTableScroll);
els.tableWrap.addEventListener("wheel", handleTableWheel, { passive: false });
els.newConnectionButton.addEventListener("click", () => openConnectionModal());
els.closeConnectionModal.addEventListener("click", closeConnectionModal);
els.cancelConnectionButton.addEventListener("click", closeConnectionModal);
els.connectionModal.addEventListener("click", (event) => {
  if (event.target === els.connectionModal) {
    closeConnectionModal();
  }
});
document.querySelectorAll('input[name="connectionMode"]').forEach((input) => {
  input.addEventListener("change", () => setConnectionMode(input.value));
});

async function start() {
  setupSidebarResize();
  state.connections = loadStoredConnections();
  els.redisUrl.value = DEFAULT_REDIS_URL;
  els.limitInput.value = QUERY_ROW_LIMIT;
  renderConnections();
  setPendingStatus();
  updateCommitButton();
  els.viewTitle.textContent = state.connections.length > 0 ? "选择连接" : "添加连接";
  els.viewMeta.textContent = "连接信息保存在浏览器本地，不会自动连接数据库";
  setMessage("添加或点击左侧连接后开始浏览数据");
}

[
  els.driverSelect,
  els.dsnInput,
  els.dbHost,
  els.dbPort,
  els.dbUser,
  els.dbPassword,
  els.dbName,
].forEach((input) => input.addEventListener("input", updateSqlUrlFromFields));

start();
