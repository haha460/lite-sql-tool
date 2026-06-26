const state = {
  connections: [],
  activeConnectionId: null,
  editingConnectionId: null,
  deletingConnectionId: null,
  tabs: [],
  activeTabId: null,
  activeTable: null,
  activeRows: [],
  activeRowsTotal: null,
  activeRowsHasMore: false,
  activeRealRowsLoaded: 0,
  isLoadingRows: false,
  pendingChanges: new Map(),
  pendingInserts: [],
  pendingDeletes: new Map(),
  selectedRowKeys: new Set(),
  queryMode: false,
  activeQuery: null,
  gridColumns: [],
  gridEditable: false,
  gridDisplayColumnCount: 0,
  gridVirtual: false,
  visibleRowEndIndex: 0,
  virtualFirstRowIndex: -1,
  virtualLastRowIndex: -1,
  virtualRowCount: 0,
  virtualRenderFrame: 0,
};

const STORAGE_KEY = "sqlRedisVisualConnections";
const SIDEBAR_WIDTH_KEY = "sqlRedisVisualSidebarWidth";
const COLUMN_WIDTHS_KEY = "sqlRedisVisualColumnWidths";
const DEFAULT_REDIS_URL = "redis://localhost:6379/0";
const TABLE_ROW_LIMIT = 100;
const QUERY_ROW_LIMIT = 100;
const VIRTUAL_ROW_HEIGHT = 38;
const VIRTUAL_OVERSCAN_ROWS = 10;
const VIRTUAL_BOTTOM_PADDING = 72;
const LOAD_MORE_BOTTOM_THRESHOLD = 12;

const els = {
  sqlStatus: document.querySelector("#sqlStatus"),
  redisStatus: document.querySelector("#redisStatus"),
  sqlStatusLabel: document.querySelector("#sqlStatusLabel"),
  redisStatusLabel: document.querySelector("#redisStatusLabel"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  newConnectionButton: document.querySelector("#newConnectionButton"),
  connectionModal: document.querySelector("#connectionModal"),
  connectionModalTitle: document.querySelector("#connectionModalTitle"),
  closeConnectionModal: document.querySelector("#closeConnectionModal"),
  cancelConnectionButton: document.querySelector("#cancelConnectionButton"),
  deleteConnectionModal: document.querySelector("#deleteConnectionModal"),
  closeDeleteModal: document.querySelector("#closeDeleteModal"),
  cancelDeleteButton: document.querySelector("#cancelDeleteButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  deleteConnectionText: document.querySelector("#deleteConnectionText"),
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
  readOnlyConnection: document.querySelector("#readOnlyConnection"),
  readOnlyRow: document.querySelector("#readOnlyRow"),
  redisEnabled: document.querySelector("#redisEnabled"),
  redisEnabledRow: document.querySelector("#redisEnabledRow"),
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
    sql_url: isRedisOnly(selectedConnection) ? null : selectedConnection.sqlUrl,
    redis_url: selectedConnection.redisEnabled ? selectedConnection.redisUrl : null,
    readonly: Boolean(selectedConnection.readonly),
  };
}

function isRedisOnly(connection = activeConnection()) {
  return connection?.kind === "redis";
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
  const readonly = isReadOnlyActive();
  els.commitButton.disabled = readonly || count === 0;
  els.commitButton.textContent = count > 0 ? `提交更新 (${count})` : "提交更新";
  els.deleteRowsButton.disabled = readonly || !state.activeTable || state.queryMode || state.selectedRowKeys.size === 0;
  els.addRowButton.disabled = readonly || !state.activeTable || state.queryMode;
}

function isReadOnlyActive() {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const connection = activeTab?.connection || activeConnection();
  return Boolean(connection?.readonly);
}

function clearPendingChanges() {
  state.pendingChanges.clear();
  state.pendingInserts = [];
  state.pendingDeletes.clear();
  state.selectedRowKeys.clear();
  updateCommitButton();
}

function buildSqlUrlFromFields() {
  const driver = els.driverSelect.value;
  if (driver === "redis") {
    return "";
  }
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
  if (driver === "redis") {
    return "";
  }
  const raw = els.dsnInput.value.trim();
  if (!raw) return "";
  if (raw.includes("://")) {
    return raw
      .replace(/^postgres:\/\//i, "postgresql+psycopg://")
      .replace(/^postgresql:\/\//i, "postgresql+psycopg://");
  }

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
  updateConnectionTypeFields();
  const builtSqlUrl = buildSqlUrl();
  if (builtSqlUrl) {
    els.sqlUrl.value = builtSqlUrl;
  }
}

function updateConnectionTypeFields() {
  const redisOnly = els.driverSelect.value === "redis";
  els.dsnFields.classList.toggle("hidden", redisOnly || els.connectionMode() !== "dsn");
  els.fieldInputs.classList.toggle("hidden", redisOnly || els.connectionMode() !== "fields");
  els.sqlUrl.classList.toggle("hidden", redisOnly);
  els.sqlUrl.disabled = redisOnly;
  els.readOnlyRow.classList.toggle("hidden", redisOnly);
  els.redisEnabledRow.classList.toggle("hidden", redisOnly);
  els.redisEnabled.disabled = false;
  setRedisEnabled(redisOnly || els.redisEnabled.checked, { lock: redisOnly });
  if (redisOnly) {
    els.sqlUrl.value = "";
    els.dsnInput.value = "";
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
  updateConnectionStatusSummary();
}

function updateConnectionStatusSummary() {
  const sqlCount = state.connections.filter((connection) => connection.sqlConnected).length;
  const redisCount = state.connections.filter((connection) => connection.redisEnabled && connection.redisConnected).length;
  els.sqlStatus.className = `status-dot ${sqlCount > 0 ? "ok" : "pending"}`;
  els.redisStatus.className = `status-dot ${redisCount > 0 ? "ok" : "pending"}`;
  els.sqlStatusLabel.closest(".status-pill").classList.toggle("connected", sqlCount > 0);
  els.redisStatusLabel.closest(".status-pill").classList.toggle("connected", redisCount > 0);
  els.sqlStatusLabel.textContent = `SQL ${sqlCount}`;
  els.redisStatusLabel.textContent = `Redis ${redisCount}`;
}

function loadStoredConnections() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((connection) => ({
      ...connection,
      kind: connection.kind || "sql",
      redisEnabled: Boolean(connection.redisEnabled),
      redisConnected: false,
      sqlConnected: false,
    }));
  } catch {
    return [];
  }
}

function saveStoredConnections() {
  const persisted = state.connections.map(({ tables, loadingTables, sqlConnected, redisConnected, redisError, ...connection }) => connection);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function renderConnections() {
  els.connectionList.innerHTML = "";
  state.connections.forEach((connection) => {
    const item = document.createElement("details");
    item.className = "connection-item";
    item.open = connection.id === state.activeConnectionId;
    item.classList.toggle("active", connection.id === state.activeConnectionId);
    item.title = isRedisOnly(connection)
      ? `Redis: ${connection.redisUrl || DEFAULT_REDIS_URL}`
      : `SQL: ${connection.sqlUrl}${connection.redisEnabled ? `\nRedis: ${connection.redisUrl || DEFAULT_REDIS_URL}` : ""}${connection.readonly ? "\n只读连接" : ""}`;

    const summary = document.createElement("summary");
    summary.className = "connection-summary";

    const main = document.createElement("button");
    main.type = "button";
    main.className = "connection-main";

    const badges = document.createElement("span");
    badges.className = "connection-badges";

    const sqlIcon = document.createElement("span");
    sqlIcon.className = `connection-icon ${connectionIconClass(connection)}`;
    sqlIcon.textContent = connectionIconText(connection);
    sqlIcon.title = "SQL 数据库";
    badges.appendChild(sqlIcon);

    if (connection.redisEnabled) {
      const redisIcon = document.createElement("span");
      redisIcon.className = "connection-icon redis";
      redisIcon.textContent = "R";
      redisIcon.title = "Redis 数据库";
      badges.appendChild(redisIcon);
    }

    const name = document.createElement("span");
    name.className = "connection-name";
    name.textContent = `${connection.name}${connection.readonly ? " (只读)" : ""}`;

    const activeDot = document.createElement("span");
    activeDot.className = "connection-active-dot";
    activeDot.title = "数据库连接活跃";
    activeDot.hidden = !connection.sqlConnected && !connection.redisConnected;

    main.append(badges, name, activeDot);
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
      openDeleteConnectionModal(connection.id);
    });

    summary.append(main, edit, remove);
    item.append(summary);
    item.appendChild(renderConnectionTables(connection));
    els.connectionList.appendChild(item);
  });
  updateConnectionStatusSummary();
}

function connectionIconClass(connection) {
  if (isRedisOnly(connection)) return "redis";
  const sqlUrl = connection.sqlUrl || "";
  if (sqlUrl.startsWith("postgres") || sqlUrl.includes("postgresql")) return "pg";
  if (sqlUrl.startsWith("sqlite")) return "sqlite";
  if (sqlUrl.startsWith("clickhouse")) return "clickhouse";
  if (connection.redisEnabled && connection.redisConnected && !connection.sqlConnected) return "redis";
  return "sql";
}

function connectionIconText(connection) {
  if (isRedisOnly(connection)) return "R";
  const sqlUrl = connection.sqlUrl || "";
  if (sqlUrl.startsWith("postgres") || sqlUrl.includes("postgresql")) return "PG";
  if (sqlUrl.startsWith("sqlite")) return "Lite";
  if (sqlUrl.startsWith("clickhouse")) return "CH";
  if (connection.redisEnabled && connection.redisConnected && !connection.sqlConnected) return "R";
  return "SQL";
}

function renderConnectionTables(connection) {
  const wrapper = document.createElement("div");
  wrapper.className = "connection-tables";

  if (isRedisOnly(connection)) {
    const redisInfo = document.createElement("div");
    redisInfo.className = "connection-empty";
    redisInfo.textContent = connection.redisConnected ? "Redis 已连接" : "点击连接 Redis";
    wrapper.appendChild(redisInfo);
    return wrapper;
  }

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
  setRedisEnabled(false);
  els.sqlUrl.disabled = false;
  els.sqlUrl.classList.remove("hidden");
  els.readOnlyRow.classList.remove("hidden");
  els.redisEnabledRow.classList.remove("hidden");
  setConnectionMode("dsn");

  if (connection) {
    els.connectionName.value = connection.name;
    els.driverSelect.value = connection.kind === "redis" ? "redis" : els.driverSelect.value;
    els.sqlUrl.value = connection.sqlUrl;
    els.readOnlyConnection.checked = Boolean(connection.readonly);
    setRedisEnabled(Boolean(connection.redisEnabled), { lock: connection.kind === "redis" });
    els.redisUrl.value = connection.redisUrl || DEFAULT_REDIS_URL;
    if (connection.sqlUrl) {
      fillConnectionFieldsFromUrl(connection.sqlUrl);
    }
    els.dsnInput.value = connection.sqlUrl || "";
  }
  updateConnectionTypeFields();

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
  state.activeRowsTotal = null;
  state.activeRowsHasMore = false;
  state.activeRealRowsLoaded = 0;
  state.isLoadingRows = false;
  state.queryMode = false;
  state.activeQuery = null;
  clearPendingChanges();
  renderConnections();
  renderGrid([], [], false);
}

function connectionHostLabel() {
  const connection = activeConnection();
  if (!connection) return "";
  if (isRedisOnly(connection)) {
    try {
      return `@${new URL(connection.redisUrl).host}`;
    } catch {
      return "";
    }
  }
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
  state.activeQuery = null;
  clearPendingChanges();
  renderTabs();
  renderConnections();
  els.viewTitle.textContent = `浏览数据 ${tab.table.name}`;
  els.viewMeta.textContent = `${tab.hostLabel}，每次加载 ${TABLE_ROW_LIMIT} 行${tab.connection.readonly ? "，只读连接" : ""}`;
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
  const kind = els.driverSelect.value === "redis" ? "redis" : "sql";
  const builtSqlUrl = buildSqlUrl();
  const sqlUrl = kind === "redis" ? "" : (els.sqlUrl.value.trim() || builtSqlUrl);
  const redisEnabled = kind === "redis" || els.redisEnabled.checked;
  const redisUrl = redisEnabled ? (els.redisUrl.value.trim() || DEFAULT_REDIS_URL) : "";
  const readonly = kind === "redis" ? true : els.readOnlyConnection.checked;

  if (!name || (kind !== "redis" && !sqlUrl) || (kind === "redis" && !redisUrl)) {
    setMessage("连接名称和数据库连接信息不能为空", true);
    return;
  }

  const existing = state.editingConnectionId
    ? state.connections.find((connection) => connection.id === state.editingConnectionId)
    : state.connections.find((connection) => connection.name === name);

  if (existing) {
    const oldActiveId = existing.id;
    const nameChanged = existing.name !== name;
    existing.name = name;
    existing.kind = kind;
    existing.sqlUrl = sqlUrl;
    existing.redisUrl = redisUrl;
    existing.redisEnabled = redisEnabled;
    existing.sqlConnected = false;
    existing.redisConnected = false;
    existing.readonly = readonly;
    state.tabs.forEach((tab) => {
      if (tab.connectionId === oldActiveId) {
        tab.connection = { ...existing };
      }
    });
    if (state.activeConnectionId === oldActiveId && nameChanged) {
      els.viewTitle.textContent = name;
    }
  } else {
    state.connections.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      kind,
      sqlUrl,
      redisUrl,
      redisEnabled,
      readonly,
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

function openDeleteConnectionModal(id) {
  const connection = connectionById(id);
  if (!connection) return;
  state.deletingConnectionId = id;
  els.deleteConnectionText.textContent = `确定删除连接「${connection.name}」吗？删除后本地保存的连接信息会被移除，已打开的相关 tab 也会关闭。`;
  els.deleteConnectionModal.classList.remove("hidden");
  els.confirmDeleteButton.focus();
}

function closeDeleteConnectionModal() {
  state.deletingConnectionId = null;
  els.deleteConnectionModal.classList.add("hidden");
}

async function confirmDeleteConnection() {
  const id = state.deletingConnectionId;
  if (!id) return;
  closeDeleteConnectionModal();
  await deleteConnection(id);
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
      state.activeRowsTotal = null;
      state.activeRowsHasMore = false;
      state.activeRealRowsLoaded = 0;
      state.activeQuery = null;
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
  state.activeRowsTotal = null;
  state.activeRowsHasMore = false;
  state.activeRealRowsLoaded = 0;
  state.isLoadingRows = false;
  state.queryMode = false;
  state.activeQuery = null;
  clearPendingChanges();
  renderConnections();
  setPendingStatus();
  const connection = activeConnection();
  els.viewTitle.textContent = connection.name;
  els.viewMeta.textContent = isRedisOnly(connection) ? "正在连接 Redis..." : "正在连接数据库...";
  setMessage("正在连接数据库...");
  try {
    await loadHealth();
    if (isRedisOnly(connection)) {
      renderGrid([], [], false);
      els.viewTitle.textContent = connection.name;
      els.viewMeta.textContent = `${connectionHostLabel()}，Redis 连接已激活`;
      setMessage("Redis 连接成功");
    } else {
      await loadTables();
    }
  } catch (error) {
    connection.sqlConnected = false;
    setStatus(els.sqlStatus, false);
    updateConnectionStatusSummary();
    renderConnections();
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
    const connection = activeConnection();
    if (connection) {
      connection.sqlConnected = Boolean(health.sql);
      connection.redisConnected = Boolean(health.redis);
      connection.redisError = health.redis_error || null;
    }
    updateConnectionStatusSummary();
    renderConnections();
  } catch (error) {
    const connection = activeConnection();
    if (connection) {
      connection.sqlConnected = false;
      connection.redisConnected = false;
      connection.redisError = error.message;
    }
    updateConnectionStatusSummary();
    renderConnections();
    setMessage(error.message, true);
  }
}

function setRedisEnabled(enabled, options = {}) {
  els.redisEnabled.checked = enabled;
  els.redisEnabled.disabled = Boolean(options.lock);
  els.redisUrl.classList.toggle("hidden", !enabled);
  els.redisUrl.disabled = !enabled;
  if (enabled && !els.redisUrl.value.trim()) {
    els.redisUrl.value = DEFAULT_REDIS_URL;
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
  openButton.title = tableStatsTitle(table);

  const tableName = document.createElement("span");
  tableName.className = "table-name";
  tableName.textContent = table.name;

  const tableStats = document.createElement("span");
  tableStats.className = "table-stats";
  tableStats.textContent = tableStatsLabel(table);

  openButton.append(tableName, tableStats);
  openButton.addEventListener("click", (event) => {
    event.preventDefault();
    selectTable(connection.id, table.name);
  });

  summary.appendChild(openButton);
  item.appendChild(summary);
  item.appendChild(renderTableMeta(table));
  return item;
}

function tableStatsLabel(table) {
  const parts = [];
  if (Number.isFinite(Number(table.row_count))) {
    parts.push(`${formatCount(table.row_count)}行`);
  }
  if (Number.isFinite(Number(table.size_bytes))) {
    parts.push(formatBytes(table.size_bytes));
  }
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function tableStatsTitle(table) {
  const parts = [table.name];
  if (Number.isFinite(Number(table.row_count))) {
    parts.push(`${Number(table.row_count).toLocaleString("zh-CN")} 行`);
  }
  if (Number.isFinite(Number(table.size_bytes))) {
    parts.push(formatBytes(table.size_bytes));
  }
  return parts.join(" · ");
}

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number >= 100000000) return `${trimNumber(number / 100000000)}亿`;
  if (number >= 10000) return `${trimNumber(number / 10000)}万`;
  return number.toLocaleString("zh-CN");
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(0, number);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${trimNumber(size)} ${units[unitIndex]}`;
}

function trimNumber(value) {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/\.?0+$/, "");
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
  if (append && !state.activeRowsHasMore) return;

  state.isLoadingRows = true;
  if (!append) {
    state.activeQuery = null;
  }
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
    const parsedTotal = parseOptionalNumber(data.total);
    state.activeRowsTotal = Number.isFinite(parsedTotal) ? parsedTotal : null;
    state.activeRowsHasMore = hasMoreRows(data);
    const columns = state.activeTable.columns.map((column) => column.name);
    if (append) {
      const startIndex = state.activeRows.length;
      state.activeRows = state.activeRows.concat(data.rows);
      state.activeRealRowsLoaded = Number.isFinite(data.loaded) ? data.loaded : state.activeRealRowsLoaded + data.rows.length;
      if (state.gridVirtual) {
        renderVisibleRows({ force: true });
      } else {
        appendRows(data.rows, startIndex);
      }
    } else {
      state.activeRows = data.rows;
      state.activeRealRowsLoaded = Number.isFinite(data.loaded) ? data.loaded : data.rows.length;
      els.tableWrap.scrollTop = 0;
      renderGrid(columns, state.activeRows, !isReadOnlyActive(), { virtual: true });
    }
    setMessage(rowLoadMessage());
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    state.isLoadingRows = false;
  }
}

function appendRows(rows, startIndex) {
  const existingLoadMore = els.tbody.querySelector(".load-more-row");
  const existingBottomSpacer = els.tbody.querySelector(".virtual-spacer-row");
  existingLoadMore?.remove();
  existingBottomSpacer?.remove();

  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => {
    fragment.appendChild(createRowElement(state.gridColumns, row, state.gridEditable, startIndex + index));
  });
  if (state.activeRowsHasMore || state.isLoadingRows) {
    fragment.appendChild(createLoadMoreRow());
  } else {
    fragment.appendChild(createSpacerRow(VIRTUAL_BOTTOM_PADDING));
  }
  els.tbody.appendChild(fragment);
  state.visibleRowEndIndex = state.activeRows.length;
}

function rowLoadMessage() {
  const suffix = state.activeRowsHasMore ? "，滚动到底部继续加载" : "";
  if (typeof state.activeRowsTotal === "number" && Number.isFinite(state.activeRowsTotal)) {
    return `共 ${state.activeRowsTotal} 行，当前显示 ${state.activeRealRowsLoaded} 行${suffix}`;
  }
  return `已加载 ${state.activeRealRowsLoaded} 行${suffix}`;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  return Number(value);
}

function hasMoreRows(data) {
  if (typeof data.has_more === "boolean") {
    return data.has_more;
  }
  if (typeof state.activeRowsTotal === "number" && Number.isFinite(state.activeRowsTotal)) {
    return Number(data.loaded || 0) < state.activeRowsTotal;
  }
  return Array.isArray(data.rows) && data.rows.length >= TABLE_ROW_LIMIT;
}

async function loadQueryRows({ append = false } = {}) {
  if (isRedisOnly()) {
    setMessage("Redis 连接不能执行 SQL 查询", true);
    return;
  }
  if (state.isLoadingRows) return;
  if (append && (!state.activeQuery || !state.activeRowsHasMore)) return;

  const sql = append ? state.activeQuery?.sql : els.sqlEditor.value;
  const queryLimit = append ? state.activeQuery?.limit || QUERY_ROW_LIMIT : Number(els.limitInput.value || QUERY_ROW_LIMIT);
  const offset = append ? state.activeRealRowsLoaded : 0;
  if (!sql) return;

  state.isLoadingRows = true;
  setMessage(append ? `正在继续加载 ${queryLimit} 行查询结果...` : `正在执行查询，默认限制 ${queryLimit} 行...`);
  try {
    const tableForQuery = tableFromQuery(sql);
    const data = await api("/api/query", {
      method: "POST",
      body: JSON.stringify({
        sql,
        connection: connectionPayload(),
        limit: queryLimit,
        offset,
      }),
    });
    const parsedTotal = parseOptionalNumber(data.total);
    state.activeRowsTotal = Number.isFinite(parsedTotal) ? parsedTotal : null;
    state.activeRowsHasMore = hasMoreRows(data);
    state.activeRealRowsLoaded = Number.isFinite(data.loaded) ? data.loaded : offset + data.rows.length;
    state.activeQuery = { sql, limit: queryLimit, tableName: tableForQuery?.name || null };
    if (!append) {
      clearPendingChanges();
    }

    const editableQuery = Boolean(tableForQuery && data.columns.includes(tableForQuery.primary_key) && !isReadOnlyActive());
    if (tableForQuery && data.columns.includes(tableForQuery.primary_key)) {
      state.queryMode = false;
      state.activeTable = tableForQuery;
      if (append) {
        state.activeRows = state.activeRows.concat(data.rows);
        renderVisibleRows({ force: true });
      } else {
        state.activeRows = data.rows;
        els.tableWrap.scrollTop = 0;
        renderGrid(data.columns, data.rows, editableQuery, { virtual: true });
      }
      els.viewTitle.textContent = `浏览数据 ${tableForQuery.name}`;
      els.viewMeta.textContent = isReadOnlyActive() ? "当前为 SQL 筛选结果，只读连接" : "当前为 SQL 筛选结果，可选择和编辑";
    } else {
      state.queryMode = true;
      state.activeTabId = null;
      state.activeTable = null;
      if (append) {
        state.activeRows = state.activeRows.concat(data.rows);
        renderVisibleRows({ force: true });
      } else {
        state.activeRows = data.rows;
        els.tableWrap.scrollTop = 0;
        renderTabs();
        renderConnections();
        renderGrid(data.columns, data.rows, false, { virtual: true });
      }
      els.viewTitle.textContent = "SQL 查询结果";
      els.viewMeta.textContent = `查询结果只读，每次加载 ${data.limit || queryLimit} 行`;
    }
    setMessage(rowLoadMessage());
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    state.isLoadingRows = false;
  }
}

async function runQuery() {
  await loadQueryRows({ append: false });
}

function tableFromQuery(sql) {
  const normalized = sql.trim().replace(/[`"]/g, "").replace(/\s+/g, " ");
  if (!/^select\s+/i.test(normalized)) return null;

  const match = normalized.match(/\bfrom\s+([a-zA-Z0-9_.]+)/i);
  if (!match) return null;

  const rawName = match[1].split(".").pop().toLowerCase();
  const connection = activeConnection();
  const tables = connection?.tables || [];
  return tables.find((table) => table.name.toLowerCase() === rawName) || null;
}

function renderGrid(columns, rows, editable, options = {}) {
  els.thead.innerHTML = "";
  els.tbody.innerHTML = "";
  els.table.querySelector("colgroup")?.remove();
  state.activeRows = rows;
  state.gridColumns = columns;
  state.gridEditable = Boolean(editable);
  state.gridVirtual = Boolean(options.virtual);
  resetVirtualWindow();

  if (columns.length === 0) {
    state.gridDisplayColumnCount = 0;
    return;
  }

  const displayColumns = editable && state.activeTable?.primary_key ? ["__rownum", "__select", ...columns] : ["__rownum", ...columns];
  state.gridDisplayColumnCount = displayColumns.length;
  const colgroup = document.createElement("colgroup");
  displayColumns.forEach((column, index) => {
    const col = document.createElement("col");
    col.dataset.colIndex = String(index);
    col.style.width = `${columnWidth(column)}px`;
    colgroup.appendChild(col);
  });
  els.table.prepend(colgroup);

  const headerRow = document.createElement("tr");
  const rowNumberHeader = document.createElement("th");
  rowNumberHeader.className = "row-number-column";
  rowNumberHeader.textContent = "#";
  rowNumberHeader.dataset.colIndex = "0";
  headerRow.appendChild(rowNumberHeader);

  if (editable && state.activeTable?.primary_key) {
    const selectHeader = document.createElement("th");
    selectHeader.className = "select-column";
    selectHeader.dataset.colIndex = "1";
    headerRow.appendChild(selectHeader);
  }
  columns.forEach((column, columnIndex) => {
    const displayIndex = editable && state.activeTable?.primary_key ? columnIndex + 2 : columnIndex + 1;
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

  if (state.gridVirtual) {
    renderVisibleRows({ force: true });
  } else {
    renderAllRows();
  }
}

function renderAllRows() {
  resetVirtualWindow();
  state.visibleRowEndIndex = state.activeRows.length;
  if (state.gridColumns.length === 0 || state.activeRows.length === 0) {
    els.tbody.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  state.activeRows.forEach((row, rowIndex) => {
    fragment.appendChild(createRowElement(state.gridColumns, row, state.gridEditable, rowIndex));
  });
  if (state.activeRowsHasMore || state.isLoadingRows) {
    fragment.appendChild(createLoadMoreRow());
  } else {
    fragment.appendChild(createSpacerRow(VIRTUAL_BOTTOM_PADDING));
  }
  els.tbody.replaceChildren(fragment);
}

function resetVirtualWindow() {
  if (state.virtualRenderFrame) {
    cancelAnimationFrame(state.virtualRenderFrame);
    state.virtualRenderFrame = 0;
  }
  state.virtualFirstRowIndex = -1;
  state.virtualLastRowIndex = -1;
  state.virtualRowCount = 0;
}

function scheduleVisibleRowsRender() {
  if (!state.gridVirtual || state.virtualRenderFrame) return;
  state.virtualRenderFrame = requestAnimationFrame(() => {
    state.virtualRenderFrame = 0;
    renderVisibleRows();
  });
}

function renderVisibleRows({ force = false } = {}) {
  state.visibleRowEndIndex = 0;
  if (state.gridColumns.length === 0) {
    resetVirtualWindow();
    els.tbody.replaceChildren();
    return;
  }
  if (state.activeRows.length === 0) {
    resetVirtualWindow();
    const fragment = document.createDocumentFragment();
    if (state.activeRowsHasMore || state.isLoadingRows) {
      fragment.appendChild(createLoadMoreRow());
    }
    els.tbody.replaceChildren(fragment);
    return;
  }

  const viewportHeight = els.tableWrap.clientHeight || 400;
  const firstVisible = Math.max(0, Math.floor(els.tableWrap.scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN_ROWS);
  const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN_ROWS * 2;
  const lastVisible = Math.min(state.activeRows.length, firstVisible + visibleCount);
  state.visibleRowEndIndex = lastVisible;

  if (
    !force &&
    firstVisible === state.virtualFirstRowIndex &&
    lastVisible === state.virtualLastRowIndex &&
    state.activeRows.length === state.virtualRowCount
  ) {
    return;
  }

  const topHeight = firstVisible * VIRTUAL_ROW_HEIGHT;
  const bottomHeight = Math.max(
    VIRTUAL_BOTTOM_PADDING,
    (state.activeRows.length - lastVisible) * VIRTUAL_ROW_HEIGHT + VIRTUAL_BOTTOM_PADDING,
  );
  const fragment = document.createDocumentFragment();
  state.virtualFirstRowIndex = firstVisible;
  state.virtualLastRowIndex = lastVisible;
  state.virtualRowCount = state.activeRows.length;

  if (topHeight > 0) {
    fragment.appendChild(createSpacerRow(topHeight));
  }

  for (let rowIndex = firstVisible; rowIndex < lastVisible; rowIndex += 1) {
    fragment.appendChild(createRowElement(state.gridColumns, state.activeRows[rowIndex], state.gridEditable, rowIndex));
  }

  if (bottomHeight > 0) {
    fragment.appendChild(createSpacerRow(bottomHeight));
  }
  if (state.activeRowsHasMore || state.isLoadingRows) {
    fragment.appendChild(createLoadMoreRow());
  }

  const scrollTop = els.tableWrap.scrollTop;
  els.tbody.replaceChildren(fragment);
  if (Math.abs(els.tableWrap.scrollTop - scrollTop) > 1) {
    els.tableWrap.scrollTop = scrollTop;
  }
}

function createSpacerRow(height) {
  const tr = document.createElement("tr");
  tr.className = "virtual-spacer-row";
  tr.setAttribute("aria-hidden", "true");
  const td = document.createElement("td");
  td.colSpan = Math.max(1, state.gridDisplayColumnCount);
  td.style.height = `${height}px`;
  td.style.padding = "0";
  td.style.borderBottom = "0";
  tr.appendChild(td);
  return tr;
}

function createLoadMoreRow() {
  const tr = document.createElement("tr");
  tr.className = "load-more-row";
  tr.setAttribute("aria-hidden", "true");
  const td = document.createElement("td");
  td.colSpan = Math.max(1, state.gridDisplayColumnCount);
  td.textContent = state.isLoadingRows ? "正在加载更多数据..." : "继续滚动加载更多数据";
  tr.appendChild(td);
  return tr;
}

function createRowElement(columns, row, editable, rowIndex) {
  const tr = document.createElement("tr");
  tr.dataset.rowIndex = String(rowIndex);
  if (row.__virtual) {
    tr.classList.add("virtual-row");
  } else if (state.activeTable?.primary_key && state.pendingDeletes.has(String(row[state.activeTable.primary_key]))) {
    tr.classList.add("delete-row");
  }
  const rowNumberCell = document.createElement("td");
  rowNumberCell.className = "row-number-column";
  rowNumberCell.textContent = row.__virtual ? "*" : String(rowIndex + 1);
  tr.appendChild(rowNumberCell);

  if (editable && state.activeTable?.primary_key) {
    const selectCell = document.createElement("td");
    selectCell.className = "select-column";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = Boolean(row.__virtual);
    checkbox.checked = isRowSelected(row);
    selectCell.appendChild(checkbox);
    tr.appendChild(selectCell);
  }
  columns.forEach((column) => {
    const td = document.createElement("td");
    const pendingChange = pendingChangeForCell(row, column);
    const rawValue = pendingChange ? pendingChange.value : row[column];
    td.textContent = rawValue === null || rawValue === undefined ? "" : String(rawValue);
    td.title = td.textContent;

    if (editable && canEditCell(row, column)) {
      td.contentEditable = "true";
      td.dataset.original = pendingChange ? pendingChange.original : td.textContent;
      td.dataset.column = column;
      td.dataset.primaryKeyValue = row.__virtual ? "" : String(row[state.activeTable.primary_key]);
      td.classList.toggle("dirty", Boolean(pendingChange));
    }

    tr.appendChild(td);
  });
  return tr;
}

function pendingChangeForCell(row, column) {
  if (!state.activeTable?.primary_key || row.__virtual) return null;
  return state.pendingChanges.get(changeKey(row[state.activeTable.primary_key], column)) || null;
}

function canEditColumn(column) {
  return state.activeTable?.primary_key && column !== state.activeTable.primary_key;
}

function canEditCell(row, column) {
  if (isReadOnlyActive()) return false;
  if (!state.activeTable) return false;
  if (row.__virtual) {
    const columnMeta = state.activeTable.columns.find((item) => item.name === column);
    return !columnMeta?.primary_key;
  }
  return canEditColumn(column);
}

function rowSelectionKey(row) {
  if (!row || row.__virtual || !state.activeTable?.primary_key) return null;
  const primaryKeyValue = row[state.activeTable.primary_key];
  if (primaryKeyValue === undefined || primaryKeyValue === null) return null;
  return String(primaryKeyValue);
}

function isRowSelected(row) {
  const key = rowSelectionKey(row);
  return key ? state.selectedRowKeys.has(key) : false;
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

function rowForEventTarget(target) {
  const tr = target.closest("tr[data-row-index]");
  if (!tr) return null;
  const rowIndex = Number(tr.dataset.rowIndex);
  if (!Number.isInteger(rowIndex)) return null;
  return state.activeRows[rowIndex] || null;
}

function handleTableBodyChange(event) {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  const row = rowForEventTarget(checkbox);
  const key = rowSelectionKey(row);
  if (!key) return;
  if (checkbox.checked) {
    state.selectedRowKeys.add(key);
  } else {
    state.selectedRowKeys.delete(key);
  }
  updateCommitButton();
}

function handleTableBodyFocusIn(event) {
  const td = event.target.closest('td[contenteditable="true"]');
  if (!td) return;
  td.classList.add("editing");
}

function handleTableBodyFocusOut(event) {
  const td = event.target.closest('td[contenteditable="true"]');
  if (!td) return;
  const row = rowForEventTarget(td);
  const column = td.dataset.column;
  if (!row || !column) return;
  trackCellChange(td, row, column);
}

function handleTableBodyKeyDown(event) {
  const td = event.target.closest('td[contenteditable="true"]');
  if (!td) return;
  if (event.key === "Enter") {
    event.preventDefault();
    td.blur();
  }
  if (event.key === "Escape") {
    td.textContent = td.dataset.original || "";
    td.blur();
  }
}

function selectedRows() {
  return state.activeRows.filter((row) => isRowSelected(row));
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
  if (isReadOnlyActive()) {
    setMessage("当前连接是只读连接，不能新增数据", true);
    return;
  }
  if (!state.activeTable || state.queryMode) return;
  const row = { __virtual: true, __clientId: `new-${Date.now()}` };
  state.activeTable.columns.forEach((column) => {
    row[column.name] = "";
  });
  state.activeRows.unshift(row);
  els.tableWrap.scrollTop = 0;
  renderGrid(state.activeTable.columns.map((column) => column.name), state.activeRows, true);
  updateVirtualInsert(row);
  setMessage("已新增虚拟行，填写后点击提交更新");
}

function markSelectedRowsForDelete() {
  if (isReadOnlyActive()) {
    setMessage("当前连接是只读连接，不能删除数据", true);
    return;
  }
  if (!state.activeTable?.primary_key || state.queryMode) return;
  const rows = selectedRows();
  if (rows.length === 0) return;

  rows.forEach((row) => {
    const primaryKeyValue = row[state.activeTable.primary_key];
    if (primaryKeyValue === undefined || primaryKeyValue === null || row.__virtual) return;
    state.pendingDeletes.set(String(primaryKeyValue), primaryKeyValue);
    state.selectedRowKeys.delete(String(primaryKeyValue));
    state.pendingChanges.forEach((change, key) => {
      if (change.primaryKeyValue === primaryKeyValue) {
        state.pendingChanges.delete(key);
      }
    });
  });

  if (state.gridVirtual) {
    renderVisibleRows({ force: true });
  } else {
    renderAllRows();
  }
  updateCommitButton();
  setMessage(`已标记 ${state.pendingDeletes.size} 行待删除，点击提交更新后生效`);
}

function handleTableScroll() {
  if (state.gridVirtual) {
    scheduleVisibleRowsRender();
  } else {
    state.visibleRowEndIndex = state.activeRows.length;
  }
  if (state.isLoadingRows) return;
  if (!state.activeRowsHasMore) return;

  const remainingPixels = els.tableWrap.scrollHeight - els.tableWrap.scrollTop - els.tableWrap.clientHeight;
  if (remainingPixels <= LOAD_MORE_BOTTOM_THRESHOLD) {
    if (state.activeQuery) {
      loadQueryRows({ append: true });
    } else if (state.activeTable && !state.queryMode) {
      loadRows({ append: true });
    }
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
  if (isReadOnlyActive()) {
    setMessage("当前连接是只读连接，不能提交更新", true);
    return;
  }
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
  if (isRedisOnly()) {
    renderGrid([], [], false);
    els.viewMeta.textContent = `${connectionHostLabel()}，Redis 连接已激活`;
    setMessage("Redis 连接成功");
  } else if (state.queryMode) {
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
els.redisEnabled.addEventListener("change", () => setRedisEnabled(els.redisEnabled.checked));
els.driverSelect.addEventListener("change", updateConnectionTypeFields);
els.tableWrap.addEventListener("scroll", handleTableScroll);
els.tableWrap.addEventListener("wheel", handleTableWheel, { passive: false });
els.tbody.addEventListener("change", handleTableBodyChange);
els.tbody.addEventListener("focusin", handleTableBodyFocusIn);
els.tbody.addEventListener("focusout", handleTableBodyFocusOut);
els.tbody.addEventListener("keydown", handleTableBodyKeyDown);
els.newConnectionButton.addEventListener("click", () => openConnectionModal());
els.closeConnectionModal.addEventListener("click", closeConnectionModal);
els.cancelConnectionButton.addEventListener("click", closeConnectionModal);
els.closeDeleteModal.addEventListener("click", closeDeleteConnectionModal);
els.cancelDeleteButton.addEventListener("click", closeDeleteConnectionModal);
els.confirmDeleteButton.addEventListener("click", confirmDeleteConnection);
els.connectionModal.addEventListener("click", (event) => {
  if (event.target === els.connectionModal) {
    closeConnectionModal();
  }
});
els.deleteConnectionModal.addEventListener("click", (event) => {
  if (event.target === els.deleteConnectionModal) {
    closeDeleteConnectionModal();
  }
});
document.querySelectorAll('input[name="connectionMode"]').forEach((input) => {
  input.addEventListener("change", () => setConnectionMode(input.value));
});

async function start() {
  setupSidebarResize();
  state.connections = loadStoredConnections();
  els.redisUrl.value = DEFAULT_REDIS_URL;
  setRedisEnabled(false);
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
