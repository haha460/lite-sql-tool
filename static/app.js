const state = {
  connections: [],
  activeConnectionId: null,
  editingConnectionId: null,
  deletingConnectionId: null,
  expandedConnectionIds: new Set(),
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
  highlightedRowKeys: new Set(),
  isDraggingRowHighlight: false,
  cellSelection: null,
  isDraggingCellSelection: false,
  cellSelectionPointer: null,
  cellSelectionScrollFrame: 0,
  cellSelectionRenderFrame: 0,
  cellTooltipTimer: 0,
  cellTooltipHideTimer: 0,
  cellTooltipCell: null,
  cellTooltipElement: null,
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
  aiConfig: null,
  aiSessionId: null,
  aiSessionByConnection: {},
  aiConnectionId: null,
  aiMessages: [],
  aiBusy: false,
  aiSkillBusy: false,
  aiSkill: null,
  aiLastSql: "",
  aiSqlList: [],
  aiModelId: sessionStorage.getItem("sqlRedisVisualAiModelId") || null,
  aiPanelCollapsed: localStorage.getItem("sqlRedisVisualAiPanelCollapsed") === "1",
  aiRestoreRequestId: 0,
  sqlAutocomplete: {
    visible: false,
    items: [],
    selectedIndex: 0,
    tokenStart: 0,
    tokenEnd: 0,
  },
};

const STORAGE_KEY = "sqlRedisVisualConnections";
const SIDEBAR_WIDTH_KEY = "sqlRedisVisualSidebarWidth";
const COLUMN_WIDTHS_KEY = "sqlRedisVisualColumnWidths";
const AI_SESSION_BY_CONNECTION_KEY = "sqlRedisVisualAiSessionByConnection";
const AI_MODEL_KEY = "sqlRedisVisualAiModelId";
const AI_PANEL_WIDTH_KEY = "sqlRedisVisualAiPanelWidth";
const AI_PANEL_COLLAPSED_KEY = "sqlRedisVisualAiPanelCollapsed";
const DEFAULT_REDIS_URL = "redis://localhost:6379/0";
const TABLE_ROW_LIMIT = 100;
const QUERY_ROW_LIMIT = 100;
const VIRTUAL_ROW_HEIGHT = 38;
const VIRTUAL_OVERSCAN_ROWS = 10;
const VIRTUAL_BOTTOM_PADDING = 72;
const LOAD_MORE_BOTTOM_THRESHOLD = 12;
const CELL_SELECTION_SCROLL_EDGE = 72;
const CELL_SELECTION_MAX_SCROLL_SPEED = 44;
const CELL_TOOLTIP_DELAY = 1000;
const CELL_TOOLTIP_HIDE_DELAY = 500;
const SQL_AUTOCOMPLETE_LIMIT = 80;
const SQL_AUTOCOMPLETE_KEYWORDS = [
  "select",
  "from",
  "where",
  "join",
  "left join",
  "right join",
  "inner join",
  "outer join",
  "on",
  "and",
  "or",
  "not",
  "in",
  "is",
  "null",
  "like",
  "between",
  "group by",
  "order by",
  "having",
  "limit",
  "offset",
  "distinct",
  "case",
  "when",
  "then",
  "else",
  "end",
  "as",
  "with",
  "union",
  "union all",
  "exists",
  "desc",
  "asc",
];
const SQL_AUTOCOMPLETE_FUNCTIONS = [
  "count(*)",
  "sum()",
  "avg()",
  "min()",
  "max()",
  "coalesce()",
  "date()",
  "datetime()",
  "lower()",
  "upper()",
  "substr()",
  "round()",
];
const SQL_RESERVED_WORDS = new Set([
  ...SQL_AUTOCOMPLETE_KEYWORDS.flatMap((keyword) => keyword.split(/\s+/)),
  "by",
  "cross",
  "full",
  "natural",
  "using",
  "window",
  "partition",
  "over",
  "create",
  "alter",
  "drop",
  "insert",
  "update",
  "delete",
]);

state.aiSessionByConnection = loadAiSessionMap();

const els = {
  sqlStatus: document.querySelector("#sqlStatus"),
  redisStatus: document.querySelector("#redisStatus"),
  sqlStatusLabel: document.querySelector("#sqlStatusLabel"),
  redisStatusLabel: document.querySelector("#redisStatusLabel"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  aiResizeHandle: document.querySelector("#aiResizeHandle"),
  aiOpenButton: document.querySelector("#aiOpenButton"),
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
  copySelectionButton: document.querySelector("#copySelectionButton"),
  exportSelectionButton: document.querySelector("#exportSelectionButton"),
  commitButton: document.querySelector("#commitButton"),
  refreshButton: document.querySelector("#refreshButton"),
  sqlEditor: document.querySelector("#sqlEditor"),
  sqlAutocomplete: document.querySelector("#sqlAutocomplete"),
  limitInput: document.querySelector("#limitInput"),
  runQueryButton: document.querySelector("#runQueryButton"),
  message: document.querySelector("#message"),
  tabBar: document.querySelector("#tabBar"),
  tableWrap: document.querySelector(".table-wrap"),
  table: document.querySelector("#dataTable"),
  thead: document.querySelector("#dataTable thead"),
  tbody: document.querySelector("#dataTable tbody"),
  aiConfigStatus: document.querySelector("#aiConfigStatus"),
  aiBackendBadge: document.querySelector("#aiBackendBadge"),
  aiModelSelect: document.querySelector("#aiModelSelect"),
  aiConnectionSelect: document.querySelector("#aiConnectionSelect"),
  aiSkillFile: document.querySelector("#aiSkillFile"),
  aiSkillUploadButton: document.querySelector("#aiSkillUploadButton"),
  aiSkillStatus: document.querySelector("#aiSkillStatus"),
  aiMessageList: document.querySelector("#aiMessageList"),
  aiSqlCard: document.querySelector("#aiSqlCard"),
  aiSqlText: document.querySelector("#aiSqlText"),
  aiUseSqlButton: document.querySelector("#aiUseSqlButton"),
  aiForm: document.querySelector("#aiForm"),
  aiPrompt: document.querySelector("#aiPrompt"),
  aiSendButton: document.querySelector("#aiSendButton"),
  aiResetButton: document.querySelector("#aiResetButton"),
  aiCloseButton: document.querySelector("#aiCloseButton"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const rawText = await response.text();
  const data = rawText ? parseApiJson(rawText) : {};
  if (!response.ok) {
    throw new Error(apiErrorMessage(response, data, rawText));
  }
  return data;
}

function parseApiJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function apiErrorMessage(response, data, rawText) {
  const detail = data?.detail ?? data?.message ?? data?.error;
  const message = normalizeApiErrorDetail(detail) || rawText?.trim();
  return message || `Request failed: ${response.status}`;
}

function normalizeApiErrorDetail(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => normalizeApiErrorDetail(item))
      .filter(Boolean)
      .join("；");
  }
  if (typeof detail === "object") {
    const location = Array.isArray(detail.loc) ? detail.loc.join(".") : "";
    const message = detail.msg || detail.message || detail.error || JSON.stringify(detail);
    return location ? `${location}: ${message}` : String(message);
  }
  return String(detail);
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

function aiEligibleConnections() {
  return state.connections.filter((connection) => !isRedisOnly(connection) && connection.sqlUrl);
}

function selectedAiConnection() {
  return connectionById(state.aiConnectionId) || activeConnection() || aiEligibleConnections()[0] || null;
}

function loadAiSessionMap() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(AI_SESSION_BY_CONNECTION_KEY) || "{}");
    return normalizeAiSessionMap(parsed);
  } catch {
    return {};
  }
}

function normalizeAiSessionMap(links) {
  if (!links || typeof links !== "object" || Array.isArray(links)) return {};
  const seenSessionIds = new Set();
  const cleanMap = {};
  Object.entries(links).forEach(([connectionId, sessionId]) => {
    if (!connectionId || !sessionId || seenSessionIds.has(sessionId)) return;
    seenSessionIds.add(sessionId);
    cleanMap[connectionId] = sessionId;
  });
  return cleanMap;
}

async function loadAiSessionLinks() {
  try {
    const data = await api("/api/ai/session-links");
    const serverLinks = normalizeAiSessionMap(data.links);
    const legacyLinks = loadAiSessionMap();
    state.aiSessionByConnection = normalizeAiSessionMap({ ...legacyLinks, ...serverLinks });
    sessionStorage.removeItem(AI_SESSION_BY_CONNECTION_KEY);
    if (Object.keys(legacyLinks).length > 0) {
      await saveAiSessionMap();
    }
  } catch (error) {
    state.aiSessionByConnection = loadAiSessionMap();
    setMessage(`读取 AI 会话映射失败：${error.message}`, true);
  }
}

async function saveAiSessionMap() {
  state.aiSessionByConnection = normalizeAiSessionMap(state.aiSessionByConnection);
  sessionStorage.setItem(AI_SESSION_BY_CONNECTION_KEY, JSON.stringify(state.aiSessionByConnection));
  try {
    await api("/api/ai/session-links", {
      method: "PUT",
      body: JSON.stringify({ links: state.aiSessionByConnection }),
    });
    sessionStorage.removeItem(AI_SESSION_BY_CONNECTION_KEY);
  } catch (error) {
    setMessage(`保存 AI 会话映射失败：${error.message}`, true);
  }
}

async function rememberCurrentAiSession() {
  if (!state.aiConnectionId || !state.aiSessionId) return;
  state.aiSessionByConnection[state.aiConnectionId] = state.aiSessionId;
  await saveAiSessionMap();
}

async function forgetAiSessionForConnection(connectionId) {
  if (!connectionId) return;
  delete state.aiSessionByConnection[connectionId];
  await saveAiSessionMap();
}

function setCurrentAiSession(sessionId) {
  state.aiSessionId = sessionId || null;
}

function renderAiConnectionOptions() {
  const previous = state.aiConnectionId;
  const options = aiEligibleConnections();
  els.aiConnectionSelect.innerHTML = "";

  if (options.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无 SQL 连接";
    els.aiConnectionSelect.appendChild(option);
    state.aiConnectionId = null;
  } else {
    options.forEach((connection) => {
      const option = document.createElement("option");
      option.value = connection.id;
      option.textContent = connection.name;
      els.aiConnectionSelect.appendChild(option);
    });
    const active = activeConnection();
    const preferredId = previous && options.some((connection) => connection.id === previous)
      ? previous
      : active && options.some((connection) => connection.id === active.id)
        ? active.id
        : options[0].id;
    state.aiConnectionId = preferredId;
    els.aiConnectionSelect.value = preferredId;
    setCurrentAiSession(state.aiSessionByConnection[preferredId] || null);
  }

  updateAiControls();
}

function renderAiModelOptions() {
  const models = state.aiConfig?.models || [];
  els.aiModelSelect.innerHTML = "";

  if (models.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无模型";
    els.aiModelSelect.appendChild(option);
    state.aiModelId = null;
    sessionStorage.removeItem(AI_MODEL_KEY);
    updateAiControls();
    return;
  }

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name || model.model || model.id;
    option.title = `${model.model || model.id} @ ${model.api_base || ""}`;
    els.aiModelSelect.appendChild(option);
  });

  const preferredId = state.aiModelId && models.some((model) => model.id === state.aiModelId)
    ? state.aiModelId
    : state.aiConfig?.default_model_id || models[0].id;
  state.aiModelId = preferredId;
  els.aiModelSelect.value = preferredId;
  sessionStorage.setItem(AI_MODEL_KEY, preferredId);
  updateAiControls();
}

function selectedAiModel() {
  const models = state.aiConfig?.models || [];
  return models.find((model) => model.id === state.aiModelId) || models[0] || null;
}

function aiBackendLabel() {
  if (!state.aiConfig) return "检测中";
  return state.aiConfig?.agent_backend === "opencode" ? "OpenCode 模式" : "直连模式";
}

function updateAiControls() {
  const configured = Boolean(state.aiConfig?.configured);
  const hasModel = Boolean(selectedAiModel());
  const hasConnection = Boolean(selectedAiConnection());
  const backendLabel = aiBackendLabel();
  els.aiSendButton.disabled = state.aiBusy || !configured || !hasModel || !hasConnection;
  els.aiPrompt.disabled = state.aiBusy || !configured || !hasModel || !hasConnection;
  els.aiSkillUploadButton.disabled = state.aiBusy || state.aiSkillBusy || !configured || !hasModel || !hasConnection;
  els.aiModelSelect.disabled = state.aiBusy || !configured || (state.aiConfig?.models || []).length === 0;
  els.aiConnectionSelect.disabled = state.aiBusy || aiEligibleConnections().length === 0;
  els.aiResetButton.disabled = state.aiBusy;
  els.aiBackendBadge.textContent = backendLabel;
  els.aiBackendBadge.classList.toggle("opencode", state.aiConfig?.agent_backend === "opencode");
  els.aiBackendBadge.classList.toggle("direct", Boolean(state.aiConfig) && state.aiConfig?.agent_backend !== "opencode");
  els.aiBackendBadge.classList.toggle("pending", !state.aiConfig);
  els.aiBackendBadge.title = state.aiConfig?.agent_backend === "opencode"
    ? "通过 OpenCode 后端 agent 执行"
    : state.aiConfig
      ? "由后端直接调用模型接口"
      : "正在读取 AI 后端模式";
  els.aiConfigStatus.textContent = !state.aiConfig
    ? "检查配置中..."
    : configured
    ? `${backendLabel}，已配置 ${(state.aiConfig.models || []).length} 个模型`
    : "未配置 AI_MODELS 或 AI_API_BASE / AI_API_KEY / AI_MODEL";
  els.aiConfigStatus.classList.toggle("error", state.aiConfig && !configured);
  renderAiSkillStatus();
}

function renderAiSkillStatus() {
  const skill = state.aiSkill;
  const text = state.aiSkillBusy
    ? "正在生成 Skill..."
    : skill?.path
      ? `已绑定：${skill.name || skill.path}`
      : "未绑定 Skill";
  els.aiSkillStatus.textContent = text;
  els.aiSkillStatus.title = skill?.path ? `${skill.path}${skill.source_filename ? `（来源：${skill.source_filename}）` : ""}` : text;
  els.aiSkillStatus.classList.toggle("bound", Boolean(skill?.path));
}

function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^\s*(```|~~~)([A-Za-z0-9_-]*)\s*$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].match(new RegExp(`^\\s*${fence}\\s*$`))) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (fenceMatch[2]) code.className = `language-${fenceMatch[2]}`;
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const { element, nextIndex } = renderMarkdownTable(lines, index);
      fragment.appendChild(element);
      index = nextIndex;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s*(.+)$/);
    if (headingMatch) {
      const heading = document.createElement(`h${Math.min(headingMatch[1].length, 4)}`);
      appendInlineMarkdown(heading, headingMatch[2].trim());
      fragment.appendChild(heading);
      index += 1;
      continue;
    }

    if (/^\s*<\/?(details|summary)\b/i.test(line)) {
      const { element, nextIndex } = renderMarkdownHtmlBlock(lines, index);
      fragment.appendChild(element);
      index = nextIndex;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      fragment.appendChild(document.createElement("hr"));
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      const blockquote = document.createElement("blockquote");
      const paragraph = document.createElement("p");
      appendInlineMarkdown(paragraph, quoteLines.join("\n"));
      blockquote.appendChild(paragraph);
      fragment.appendChild(blockquote);
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (!itemMatch || /\d+\./.test(itemMatch[2]) !== ordered) break;
        const item = renderMarkdownListItem(itemMatch[3].trim());
        list.appendChild(item);
        index += 1;
      }
      fragment.appendChild(list);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join("\n"));
    fragment.appendChild(paragraph);
  }

  return fragment;
}

function isMarkdownBlockStart(lines, index) {
  const line = lines[index] || "";
  return /^\s*(```|~~~)/.test(line)
    || /^(#{1,6})\s*.+/.test(line)
    || /^\s*(-{3,}|\*{3,})\s*$/.test(line)
    || /^\s*<\/?(details|summary)\b/i.test(line)
    || /^\s*>\s?/.test(line)
    || /^(\s*)([-*+]|\d+\.)\s+/.test(line)
    || isMarkdownTable(lines, index);
}

function renderMarkdownListItem(text) {
  const item = document.createElement("li");
  const taskMatch = text.match(/^\[([ xX])\]\s+(.+)$/);
  if (!taskMatch) {
    appendInlineMarkdown(item, text);
    return item;
  }

  item.className = "markdown-task-item";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.disabled = true;
  checkbox.checked = taskMatch[1].toLowerCase() === "x";
  const label = document.createElement("span");
  appendInlineMarkdown(label, taskMatch[2].trim());
  item.append(checkbox, label);
  return item;
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(!\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    appendTextWithBreaks(parent, text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("![")) {
      const imageMatch = token.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
      if (imageMatch) {
        const image = document.createElement("img");
        image.src = imageMatch[2];
        image.alt = imageMatch[1] || "";
        image.loading = "lazy";
        parent.appendChild(image);
      } else {
        appendTextWithBreaks(parent, token);
      }
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith("~~")) {
      const deleted = document.createElement("del");
      deleted.textContent = token.slice(2, -2);
      parent.appendChild(deleted);
    } else if (token.startsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      parent.appendChild(emphasis);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        const link = document.createElement("a");
        link.href = linkMatch[2];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = linkMatch[1];
        parent.appendChild(link);
      } else {
        appendTextWithBreaks(parent, token);
      }
    }
    cursor = Number(match.index) + token.length;
  }
  appendTextWithBreaks(parent, text.slice(cursor));
}

function renderMarkdownHtmlBlock(lines, index) {
  const collected = [];
  while (index < lines.length) {
    collected.push(lines[index]);
    const line = lines[index];
    index += 1;
    if (/<\/details>/i.test(line)) break;
    if (!/<details\b/i.test(collected[0]) && !/<summary\b/i.test(line)) break;
  }

  const details = document.createElement("details");
  details.className = "markdown-details";
  details.open = true;
  const summary = document.createElement("summary");
  const summaryText = stripMarkdownHtmlTags(
    collected.find((line) => /<summary\b/i.test(line)) || "补充内容",
  ).trim() || "补充内容";
  summary.textContent = summaryText;
  details.appendChild(summary);

  const bodyText = collected
    .map(stripMarkdownHtmlTags)
    .filter((line) => line.trim() && line.trim() !== summaryText)
    .join("\n");
  const body = document.createElement("div");
  body.appendChild(renderMarkdown(bodyText));
  details.appendChild(body);
  return { element: details, nextIndex: index };
}

function stripMarkdownHtmlTags(line = "") {
  return line
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(details|summary|p|div|span|strong|em|b|i|ul|ol|li)\b[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function appendTextWithBreaks(parent, text) {
  const parts = String(text || "").split("\n");
  parts.forEach((part, index) => {
    if (index > 0) parent.appendChild(document.createElement("br"));
    if (part) parent.appendChild(document.createTextNode(part));
  });
}

function isMarkdownTable(lines, index) {
  return isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1]);
}

function isMarkdownTableRow(line = "") {
  return line.includes("|") && line.split("|").filter((cell) => cell.trim()).length >= 2;
}

function isMarkdownTableSeparator(line = "") {
  const cells = markdownTableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function markdownTableCells(line = "") {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderMarkdownTable(lines, index) {
  const headers = markdownTableCells(lines[index]);
  index += 2;
  const rows = [];
  while (index < lines.length && isMarkdownTableRow(lines[index]) && !isMarkdownTableSeparator(lines[index])) {
    rows.push(markdownTableCells(lines[index]));
    index += 1;
  }

  const wrap = document.createElement("div");
  wrap.className = "markdown-table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    appendInlineMarkdown(th, header);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((_, cellIndex) => {
      const td = document.createElement("td");
      appendInlineMarkdown(td, row[cellIndex] || "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return { element: wrap, nextIndex: index };
}

function renderAiMessages() {
  els.aiMessageList.innerHTML = "";
  if (state.aiMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ai-empty";
    empty.textContent = "选择数据库后，可以直接问表结构、生成查询或分析数据。";
    els.aiMessageList.appendChild(empty);
    return;
  }

  state.aiMessages.forEach((message) => {
    const item = document.createElement("article");
    item.className = `ai-message ${message.role === "user" ? "user" : "assistant"}`;
    const label = document.createElement("div");
    label.className = "ai-message-label";
    label.textContent = message.role === "user" ? "你" : "AI";
    const content = document.createElement("div");
    content.className = "ai-message-content";
    if (message.role === "assistant") {
      content.classList.add("markdown");
      if (Array.isArray(message.steps) && message.steps.length > 0) {
        content.appendChild(renderAiStageResult(message));
      } else {
        content.appendChild(renderMarkdown(message.content || ""));
      }
    } else {
      content.textContent = message.content || "";
    }
    item.append(label, content);
    els.aiMessageList.appendChild(item);
  });
  els.aiMessageList.scrollTop = els.aiMessageList.scrollHeight;
}

function renderAiStageResult(message) {
  const wrap = document.createElement("div");
  wrap.className = "ai-stage-result";
  const status = document.createElement("div");
  status.className = `ai-stage-status ${message.streaming ? "running" : "done"}`;
  status.textContent = message.streaming ? "分析中" : "已完成";
  wrap.appendChild(status);

  const stages = document.createElement("div");
  stages.className = "ai-stage-list";
  const latestRunningSqlPhase = latestAiSqlPhase(message.steps, "running");
  const latestErrorSqlPhase = latestAiSqlPhase(message.steps, "error");
  message.steps.forEach((step) => {
    stages.appendChild(renderAiStage(step, {
      streaming: message.streaming,
      latestRunningSqlPhase,
      latestErrorSqlPhase,
    }));
  });
  wrap.appendChild(stages);

  const final = document.createElement("section");
  final.className = "ai-final-result";
  const heading = document.createElement("h3");
  heading.textContent = message.streaming ? "正在生成最终结果" : "分析结果";
  final.appendChild(heading);
  const body = document.createElement("div");
  body.appendChild(renderMarkdown(message.content || (message.streaming ? "请稍候..." : "没有返回内容")));
  final.appendChild(body);
  wrap.appendChild(final);
  return wrap;
}

function renderAiStage(step, options = {}) {
  const hasDetails = Boolean(step.sql || step.detail || step.error || step.row_count !== undefined);
  const details = document.createElement("details");
  details.className = `ai-stage ${step.status || "running"}`;
  details.open = shouldOpenAiStage(step, options);
  const summary = document.createElement("summary");
  const icon = document.createElement("span");
  icon.className = "ai-stage-icon";
  icon.textContent = aiStageIcon(step);
  const title = document.createElement("span");
  title.className = "ai-stage-title";
  title.textContent = step.title || aiStageTitle(step.phase);
  const meta = document.createElement("span");
  meta.className = "ai-stage-meta";
  meta.textContent = aiStageMeta(step);
  summary.append(icon, title, meta);
  details.appendChild(summary);

  if (hasDetails) {
    const body = document.createElement("div");
    body.className = "ai-stage-body";
    if (step.detail) {
      const detail = document.createElement("p");
      detail.textContent = step.detail;
      body.appendChild(detail);
    }
    if (step.sql) {
      const sqlHeader = document.createElement("div");
      sqlHeader.className = "ai-stage-sql-header";
      const sqlLabel = document.createElement("span");
      sqlLabel.className = "ai-stage-sql-label";
      sqlLabel.textContent = step.sql_index ? `使用的 SQL ${step.sql_index}` : "使用的 SQL";
      const copyButton = document.createElement("button");
      copyButton.className = "ai-stage-copy-sql";
      copyButton.type = "button";
      copyButton.textContent = "复制";
      copyButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await writeClipboardText(step.sql);
          setMessage("SQL 已复制");
        } catch (error) {
          setMessage(`复制失败：${error.message}`, true);
        }
      });
      sqlHeader.append(sqlLabel, copyButton);
      body.appendChild(sqlHeader);
      const pre = document.createElement("pre");
      pre.className = "ai-stage-sql";
      pre.textContent = step.sql;
      body.appendChild(pre);
    }
    if (step.row_count !== undefined) {
      const rows = document.createElement("p");
      rows.textContent = `${step.row_count} 行${step.truncated ? "，结果已截断" : ""}`;
      body.appendChild(rows);
    }
    if (step.error) {
      const error = document.createElement("p");
      error.className = "ai-stage-error";
      error.textContent = step.error;
      body.appendChild(error);
    }
    details.appendChild(body);
  }
  return details;
}

function latestAiSqlPhase(steps = [], status) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.sql && step.status === status) return step.phase;
  }
  return "";
}

function shouldOpenAiStage(step, options = {}) {
  if (!step) return false;
  if (step.status === "error") return step.phase === options.latestErrorSqlPhase || !step.sql;
  if (step.sql && step.status === "running") return step.phase === options.latestRunningSqlPhase;
  if (options.streaming && !step.sql && step.status === "running") return true;
  return false;
}

function aiStageIcon(step) {
  if (step.status === "error") return "!";
  if (step.status === "done") return "✓";
  return "•";
}

function aiStageTitle(phase) {
  return {
    schema: "解析业务数据与约束",
    plan: "求解优化方案",
    sql: "执行只读 SQL",
    summary: "生成最终结果",
  }[phase] || "处理阶段";
}

function aiStageMeta(step) {
  if (step.status === "error") return "失败";
  if (step.row_count !== undefined) return `${step.row_count} 行${step.truncated ? " · 已截断" : ""}`;
  if (step.sql && step.status === "done") return "可展开查看";
  if (step.status === "done") return "完成";
  return "进行中";
}

function showAiSql(sqlOrList) {
  const sqlList = Array.isArray(sqlOrList)
    ? sqlOrList.filter((item) => sqlTextFromItem(item))
    : (sqlOrList ? [sqlOrList] : []);
  state.aiSqlList = sqlList;
  state.aiLastSql = sqlTextFromItem(sqlList[sqlList.length - 1]) || "";
  els.aiSqlText.textContent = "";
  sqlList.forEach((sqlEntry, index) => {
    const sql = sqlTextFromItem(sqlEntry);
    const sqlItem = document.createElement("div");
    sqlItem.className = "ai-sql-item";
    const title = document.createElement("div");
    title.className = "ai-sql-item-title";
    title.textContent = `SQL ${sqlIndexFromItem(sqlEntry, index)}`;
    const pre = document.createElement("pre");
    pre.textContent = sql;
    sqlItem.append(title, pre);
    els.aiSqlText.appendChild(sqlItem);
  });
  els.aiSqlCard.classList.toggle("hidden", sqlList.length === 0);
}

function sqlTextFromItem(item) {
  if (typeof item === "string") return item.trim();
  if (item && typeof item.sql === "string") return item.sql.trim();
  return "";
}

function sqlIndexFromItem(item, fallbackIndex) {
  if (item && typeof item === "object" && item.sql_index) return item.sql_index;
  return fallbackIndex + 1;
}

async function loadAiConfig() {
  try {
    state.aiConfig = await api("/api/ai/config");
  } catch (error) {
    state.aiConfig = { configured: false, model: "", api_base: "", models: [], error: error.message };
  }
  renderAiModelOptions();
  updateAiControls();
}

async function restoreAiSessionMessages() {
  const requestId = ++state.aiRestoreRequestId;
  const connectionId = state.aiConnectionId;
  if (!state.aiSessionId) {
    await lookupAiSessionForCurrentConnection(requestId, connectionId);
    return;
  }
  try {
    const data = await api(`/api/ai/sessions/${encodeURIComponent(state.aiSessionId)}/messages`);
    if (requestId !== state.aiRestoreRequestId || connectionId !== state.aiConnectionId) return;
    const connection = selectedAiConnection();
    if (connection && data.connection_name && data.connection_name !== connection.name) {
      await forgetAiSessionForConnection(state.aiConnectionId);
      setCurrentAiSession(null);
      await lookupAiSessionForCurrentConnection(requestId, connectionId);
      return;
    }
    state.aiMessages = Array.isArray(data.messages) ? data.messages : [];
    await loadAiSkillStatus();
    renderAiMessages();
  } catch (error) {
    if (requestId !== state.aiRestoreRequestId || connectionId !== state.aiConnectionId) return;
    await forgetAiSessionForConnection(state.aiConnectionId);
    setCurrentAiSession(null);
    await lookupAiSessionForCurrentConnection(requestId, connectionId);
  }
}

async function lookupAiSessionForCurrentConnection(requestId = ++state.aiRestoreRequestId, connectionId = state.aiConnectionId) {
  const connection = selectedAiConnection();
  if (!connection || !connectionId) {
    if (requestId !== state.aiRestoreRequestId || connectionId !== state.aiConnectionId) return;
    state.aiMessages = [];
    renderAiMessages();
    return;
  }

  try {
    const data = await api("/api/ai/sessions/lookup", {
      method: "POST",
      body: JSON.stringify({
        connection: connectionPayload(connection),
        connection_name: connection.name,
      }),
    });
    if (requestId !== state.aiRestoreRequestId || connectionId !== state.aiConnectionId) return;
    const session = data.session;
    if (!session?.session_id) {
      state.aiMessages = [];
      renderAiMessages();
      return;
    }
    setCurrentAiSession(session.session_id);
    state.aiSessionByConnection[connectionId] = state.aiSessionId;
    await saveAiSessionMap();
    state.aiMessages = Array.isArray(session.messages) ? session.messages : [];
    await loadAiSkillStatus();
    renderAiMessages();
  } catch (error) {
    if (requestId !== state.aiRestoreRequestId || connectionId !== state.aiConnectionId) return;
    state.aiMessages = [];
    renderAiMessages();
  }
}

async function switchAiConnection(connectionId) {
  await rememberCurrentAiSession();
  state.aiConnectionId = connectionId || null;
  state.aiSkill = null;
  const sessionId = state.aiConnectionId ? state.aiSessionByConnection[state.aiConnectionId] : null;
  setCurrentAiSession(sessionId || null);
  showAiSql("");
  try {
    await restoreAiSessionMessages();
    await loadAiSkillStatus();
  } catch (error) {
    state.aiMessages = [];
    state.aiSkill = null;
    renderAiMessages();
    renderAiSkillStatus();
    setMessage(`恢复 AI 会话失败：${error.message}`, true);
  }
  updateAiControls();
}

async function ensureAiSession() {
  const connection = selectedAiConnection();
  if (!connection) {
    throw new Error("请先保存并选择一个 SQL 数据库连接");
  }
  if (state.aiSessionId) {
    return state.aiSessionId;
  }
  const data = await api("/api/ai/sessions", {
    method: "POST",
    body: JSON.stringify({
      connection: connectionPayload(connection),
      connection_name: connection.name,
    }),
  });
  setCurrentAiSession(data.session_id);
  if (state.aiConnectionId) {
    state.aiSessionByConnection[state.aiConnectionId] = state.aiSessionId;
    await saveAiSessionMap();
  }
  await loadAiSkillStatus();
  return state.aiSessionId;
}

async function loadAiSkillStatus() {
  if (!state.aiSessionId) {
    state.aiSkill = null;
    renderAiSkillStatus();
    return;
  }
  try {
    const data = await api(`/api/ai/sessions/${encodeURIComponent(state.aiSessionId)}/skill`);
    state.aiSkill = data.skill || null;
  } catch {
    state.aiSkill = null;
  }
  renderAiSkillStatus();
}

async function uploadAiSkillFromFile(file) {
  if (!file || state.aiSkillBusy) return;
  state.aiSkillBusy = true;
  updateAiControls();
  try {
    const sessionId = await ensureAiSession();
    const content = await file.text();
    const data = await api("/api/ai/skills/upload", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        filename: file.name,
        content,
        model_id: state.aiModelId,
      }),
    });
    state.aiSkill = data.skill || null;
    const fallbackNote = state.aiSkill?.generated_by === "local_fallback" ? "（AI 转换失败，已本地兜底导入）" : "";
    setMessage(`Skill 已生成并导入：${state.aiSkill?.path || file.name}${fallbackNote}`);
  } catch (error) {
    setMessage(`Skill 上传失败：${error.message}`, true);
  } finally {
    state.aiSkillBusy = false;
    els.aiSkillFile.value = "";
    updateAiControls();
  }
}

async function resetAiSession({ keepMessages = false } = {}) {
  await forgetAiSessionForConnection(state.aiConnectionId);
  setCurrentAiSession(null);
  state.aiSkill = null;
  renderAiSkillStatus();
  showAiSql("");
  if (!keepMessages) {
    state.aiMessages = [];
    renderAiMessages();
  }
}

async function submitAiMessage(event) {
  event.preventDefault();
  const text = els.aiPrompt.value.trim();
  if (!text || state.aiBusy) return;

  state.aiBusy = true;
  updateAiControls();
  showAiSql("");
  els.aiPrompt.value = "";
  state.aiMessages.push({ role: "user", content: text });
  const assistantMessage = {
    role: "assistant",
    content: "正在分析...",
    steps: [],
    streaming: true,
  };
  state.aiMessages.push(assistantMessage);
  renderAiMessages();

  try {
    const sessionId = await ensureAiSession();
    await streamAiChat({
      sessionId,
      message: text,
      assistantMessage,
      limit: Number(els.limitInput.value || QUERY_ROW_LIMIT),
      modelId: state.aiModelId,
    });
  } catch (error) {
    assistantMessage.streaming = false;
    assistantMessage.content = error.message;
    if (/AI session not found/i.test(error.message) || /会话不存在/.test(error.message)) {
      await resetAiSession({ keepMessages: true });
    }
  } finally {
    state.aiBusy = false;
    renderAiMessages();
    updateAiControls();
  }
}

async function streamAiChat({ sessionId, message, assistantMessage, limit, modelId }) {
  const response = await fetch("/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      limit,
      model_id: modelId,
    }),
  });
  if (!response.ok || !response.body) {
    const rawText = await response.text();
    const data = rawText ? parseApiJson(rawText) : {};
    throw new Error(apiErrorMessage(response, data, rawText));
  }

  await readSseStream(response.body, (event) => {
    applyAiStreamEvent(assistantMessage, event);
    renderAiMessages();
  });
}

async function readSseStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary = sseBoundaryIndex(buffer);
    while (boundary.index >= 0) {
      const rawEvent = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const event = parseSseEvent(rawEvent);
      if (event) onEvent(event);
      boundary = sseBoundaryIndex(buffer);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = parseSseEvent(buffer);
    if (event) onEvent(event);
  }
}

function sseBoundaryIndex(buffer) {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0) return { index: crlf, length: 4 };
  if (crlf < 0) return { index: lf, length: 2 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function parseSseEvent(rawEvent) {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines = [];
  let name = "message";
  lines.forEach((line) => {
    if (!line || line.startsWith(":")) return;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").replace(/^ /, "");
    if (field === "event") name = value || name;
    if (field === "data") dataLines.push(value);
  });
  if (dataLines.length === 0) return null;
  const data = parseApiJson(dataLines.join("\n"));
  return { name, data };
}

function applyAiStreamEvent(assistantMessage, event) {
  const data = event.data || {};
  if (event.name === "step" || data.type === "step") {
    assistantMessage.steps = mergeAiMessageStep(assistantMessage.steps || [], data);
    assistantMessage.content = assistantMessage.steps.length ? "正在分析全部数据..." : assistantMessage.content;
    showAiSql(aiSqlListFromMessage(assistantMessage));
    return;
  }
  if (event.name === "final" || data.type === "final") {
    const message = data.message || {};
    assistantMessage.content = message.content || "没有返回内容";
    assistantMessage.steps = Array.isArray(message.steps) && message.steps.length > 0
      ? message.steps
      : assistantMessage.steps || [];
    assistantMessage.sql = message.sql || "";
    assistantMessage.result = message.result || null;
    assistantMessage.streaming = false;
    showAiSql(aiSqlListFromMessage(assistantMessage));
    return;
  }
  if (event.name === "error" || data.type === "error") {
    assistantMessage.content = data.message || "AI 流式响应失败";
    assistantMessage.streaming = false;
    return;
  }
  if (event.name === "done" || data.type === "done") {
    assistantMessage.streaming = false;
  }
}

function mergeAiMessageStep(steps, nextStep) {
  const phase = nextStep.phase || `step-${steps.length + 1}`;
  const merged = steps.filter((step) => step.phase !== phase);
  merged.push({ ...nextStep, phase });
  return merged;
}

function aiSqlListFromMessage(message) {
  const sqlList = [];
  (message.steps || []).forEach((step) => {
    if (typeof step.sql === "string" && step.sql.trim()) {
      sqlList.push({ sql: step.sql, sql_index: step.sql_index });
    }
  });
  if (sqlList.length === 0 && typeof message.sql === "string" && message.sql.trim()) {
    sqlList.push({ sql: message.sql, sql_index: 1 });
  }
  return sqlList;
}

function useAiSqlInEditor() {
  if (!state.aiLastSql) return;
  els.sqlEditor.value = state.aiLastSql;
  rememberActiveTabSql();
  els.sqlEditor.focus();
  hideSqlAutocomplete();
  setMessage("AI 生成的 SQL 已放入编辑器");
}

function setupSqlAutocomplete() {
  els.sqlEditor.addEventListener("input", () => {
    rememberActiveTabSql();
    window.requestAnimationFrame(() => updateSqlAutocomplete());
  });
  els.sqlEditor.addEventListener("keydown", handleSqlAutocompleteKeyDown);
  els.sqlEditor.addEventListener("click", () => updateSqlAutocomplete());
  els.sqlEditor.addEventListener("scroll", hideSqlAutocomplete);
  els.sqlEditor.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!els.sqlAutocomplete.matches(":hover")) {
        hideSqlAutocomplete();
      }
    }, 120);
  });
  els.sqlAutocomplete.addEventListener("mousedown", (event) => event.preventDefault());
  document.addEventListener("click", (event) => {
    if (event.target === els.sqlEditor || els.sqlAutocomplete.contains(event.target)) return;
    hideSqlAutocomplete();
  });
}

function handleSqlAutocompleteKeyDown(event) {
  if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
    event.preventDefault();
    updateSqlAutocomplete({ manual: true });
    return;
  }

  if (!state.sqlAutocomplete.visible) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectSqlAutocompleteIndex(state.sqlAutocomplete.selectedIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selectSqlAutocompleteIndex(state.sqlAutocomplete.selectedIndex - 1);
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    acceptSqlAutocompleteItem(state.sqlAutocomplete.selectedIndex);
  } else if (event.key === "Escape") {
    event.preventDefault();
    hideSqlAutocomplete();
  }
}

function updateSqlAutocomplete(options = {}) {
  const context = sqlAutocompleteContext();
  if (!context) {
    hideSqlAutocomplete();
    return;
  }

  const shouldOpen = options.manual || context.hasQualifier || context.query.length > 0;
  if (!shouldOpen) {
    hideSqlAutocomplete();
    return;
  }

  const items = rankedSqlAutocompleteItems(context);
  if (items.length === 0) {
    hideSqlAutocomplete();
    return;
  }

  state.sqlAutocomplete.visible = true;
  state.sqlAutocomplete.items = items;
  state.sqlAutocomplete.selectedIndex = 0;
  state.sqlAutocomplete.tokenStart = context.tokenStart;
  state.sqlAutocomplete.tokenEnd = context.tokenEnd;
  renderSqlAutocomplete();
}

function sqlAutocompleteContext() {
  const editor = els.sqlEditor;
  const value = editor.value || "";
  const selectionStart = editor.selectionStart ?? 0;
  const selectionEnd = editor.selectionEnd ?? selectionStart;

  if (selectionStart !== selectionEnd) {
    return {
      query: stripSqlIdentifierQuotes(value.slice(selectionStart, selectionEnd)),
      qualifier: "",
      hasQualifier: false,
      tokenStart: selectionStart,
      tokenEnd: selectionEnd,
      tablePosition: isSqlTableCompletionPosition(value, selectionStart),
      value,
      cursor: selectionStart,
    };
  }

  let tokenStart = selectionStart;
  while (tokenStart > 0 && isSqlCompletionTokenChar(value[tokenStart - 1])) {
    tokenStart -= 1;
  }

  const rawToken = value.slice(tokenStart, selectionStart);
  const dotIndex = rawToken.lastIndexOf(".");
  const hasQualifier = dotIndex >= 0;
  const queryStart = hasQualifier ? tokenStart + dotIndex + 1 : tokenStart;
  const qualifier = hasQualifier ? stripSqlIdentifierQuotes(rawToken.slice(0, dotIndex)) : "";
  const query = stripSqlIdentifierQuotes(value.slice(queryStart, selectionStart));

  return {
    query,
    qualifier,
    hasQualifier,
    tokenStart: queryStart,
    tokenEnd: selectionEnd,
    tablePosition: isSqlTableCompletionPosition(value, queryStart),
    value,
    cursor: selectionStart,
  };
}

function isSqlCompletionTokenChar(char) {
  return /[\p{L}\p{N}_.$"`]/u.test(char || "");
}

function isSqlTableCompletionPosition(value, tokenStart) {
  const before = value.slice(0, tokenStart).replace(/--.*$/gm, " ").replace(/\s+/g, " ").toLowerCase();
  return /(?:\bfrom|\bjoin|\bupdate|\binto|,\s*)\s*$/.test(before);
}

function rankedSqlAutocompleteItems(context) {
  const query = context.query.toLowerCase();
  const candidates = sqlAutocompleteCandidates(context);
  const seen = new Set();

  return candidates
    .map((item) => {
      const key = `${item.kind}:${item.value}:${item.detail || ""}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const label = item.value.toLowerCase();
      const detail = String(item.detail || "").toLowerCase();
      let score = item.priority || 0;

      if (query) {
        if (label === query) score += 1000;
        else if (label.startsWith(query)) score += 800;
        else if (label.includes(query)) score += 420;
        else if (detail.includes(query)) score += 180;
        else return null;
      } else {
        score += 100;
      }

      if (context.tablePosition && item.kind === "表") score += 220;
      if (context.hasQualifier && item.kind === "字段") score += 260;
      return { ...item, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value, "zh-CN"))
    .slice(0, SQL_AUTOCOMPLETE_LIMIT);
}

function sqlAutocompleteCandidates(context) {
  if (context.hasQualifier) {
    return sqlColumnCompletionItemsForQualifier(context);
  }

  const candidates = [];
  if (!context.tablePosition) {
    SQL_AUTOCOMPLETE_KEYWORDS.forEach((keyword) => {
      candidates.push(sqlCompletionItem("关键字", keyword, "SQL 关键字", { appendSpace: true, priority: 100 }));
    });
    SQL_AUTOCOMPLETE_FUNCTIONS.forEach((fn) => {
      const cursorOffset = /\(\)$/.test(fn) ? fn.length - 1 : null;
      candidates.push(sqlCompletionItem("函数", fn, "SQL 函数", { cursorOffset, priority: 90 }));
    });
  }

  sqlTableCompletionItems().forEach((item) => candidates.push(item));

  if (!context.tablePosition) {
    sqlColumnCompletionItems().forEach((item) => candidates.push(item));
  }

  return candidates;
}

function sqlColumnCompletionItemsForQualifier(context) {
  const table = resolveSqlQualifier(context.qualifier, context.value, context.cursor);
  if (!table) return [];
  return (table.columns || []).map((column) => sqlCompletionItem(
    "字段",
    column.name,
    `${table.name} · ${column.type || "字段"}`,
    {
      insertText: sqlIdentifierInsertText(column.name),
      priority: column.primary_key ? 130 : 110,
    },
  ));
}

function sqlTableCompletionItems() {
  return sqlAvailableTables().map((table) => sqlCompletionItem(
    "表",
    table.name,
    table.columns?.length ? `${table.columns.length} 个字段` : "数据表",
    {
      insertText: sqlIdentifierInsertText(table.name),
      appendSpace: true,
      priority: state.activeTable?.name === table.name ? 120 : 80,
    },
  ));
}

function sqlColumnCompletionItems() {
  const items = [];
  const tables = sqlAvailableTables();
  const active = state.activeTable;
  if (active) {
    (active.columns || []).forEach((column) => {
      items.push(sqlCompletionItem(
        "字段",
        column.name,
        `${active.name} · ${column.type || "字段"}`,
        {
          insertText: sqlIdentifierInsertText(column.name),
          priority: column.primary_key ? 95 : 80,
        },
      ));
    });
  }
  tables.forEach((table) => {
    if (active && table.name === active.name) return;
    (table.columns || []).forEach((column) => {
      items.push(sqlCompletionItem(
        "字段",
        column.name,
        `${table.name} · ${column.type || "字段"}`,
        {
          insertText: sqlIdentifierInsertText(column.name),
          priority: column.primary_key ? 55 : 40,
        },
      ));
    });
  });
  return items;
}

function sqlCompletionItem(kind, value, detail, options = {}) {
  return {
    kind,
    value,
    detail,
    insertText: options.insertText || value,
    appendSpace: Boolean(options.appendSpace),
    cursorOffset: options.cursorOffset,
    priority: options.priority || 0,
  };
}

function sqlAvailableTables() {
  const connection = activeConnection();
  return Array.isArray(connection?.tables) ? connection.tables : [];
}

function resolveSqlQualifier(qualifier, sql, cursor) {
  const normalized = stripSqlIdentifierQuotes(qualifier).split(".").pop().toLowerCase();
  if (!normalized) return null;

  const references = sqlTableReferences(sql, cursor);
  if (references.has(normalized)) return references.get(normalized);

  return sqlAvailableTables().find((table) => table.name.toLowerCase() === normalized) || null;
}

function sqlTableReferences(sql, cursor) {
  const tables = new Map();
  const tableByName = new Map(sqlAvailableTables().map((table) => [table.name.toLowerCase(), table]));
  const source = String(sql || "").slice(0, cursor).replace(/[`"]/g, "");
  const pattern = /\b(?:from|join)\s+([A-Za-z0-9_.]+)(?:\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
  for (const match of source.matchAll(pattern)) {
    const tableName = match[1].split(".").pop().toLowerCase();
    const table = tableByName.get(tableName);
    if (!table) continue;
    tables.set(table.name.toLowerCase(), table);
    const alias = (match[2] || "").toLowerCase();
    if (alias && !SQL_RESERVED_WORDS.has(alias)) {
      tables.set(alias, table);
    }
  }
  return tables;
}

function stripSqlIdentifierQuotes(value) {
  return String(value || "").replace(/^[`"]+|[`"]+$/g, "");
}

function sqlIdentifierInsertText(value) {
  const identifier = String(value || "");
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier) && !SQL_RESERVED_WORDS.has(identifier.toLowerCase())) {
    return identifier;
  }
  const quote = sqlIdentifierQuote();
  return `${quote}${identifier.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function sqlIdentifierQuote() {
  const sqlUrl = activeConnection()?.sqlUrl || "";
  return sqlUrl.startsWith("mysql") || sqlUrl.includes("mysql+") ? "`" : "\"";
}

function renderSqlAutocomplete() {
  els.sqlAutocomplete.innerHTML = "";
  state.sqlAutocomplete.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `sqlAutocompleteOption${index}`;
    button.className = "sql-autocomplete-item";
    button.classList.toggle("active", index === state.sqlAutocomplete.selectedIndex);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === state.sqlAutocomplete.selectedIndex ? "true" : "false");

    const kind = document.createElement("span");
    kind.className = "sql-autocomplete-kind";
    kind.textContent = item.kind;

    const main = document.createElement("span");
    main.className = "sql-autocomplete-main";
    const value = document.createElement("span");
    value.className = "sql-autocomplete-value";
    value.textContent = item.value;
    const detail = document.createElement("span");
    detail.className = "sql-autocomplete-detail";
    detail.textContent = item.detail || "";
    main.append(value, detail);

    button.append(kind, main);
    button.addEventListener("click", () => acceptSqlAutocompleteItem(index));
    els.sqlAutocomplete.appendChild(button);
  });

  els.sqlAutocomplete.classList.remove("hidden");
  els.sqlEditor.setAttribute("aria-expanded", "true");
  els.sqlEditor.setAttribute("aria-activedescendant", `sqlAutocompleteOption${state.sqlAutocomplete.selectedIndex}`);
}

function selectSqlAutocompleteIndex(index) {
  if (state.sqlAutocomplete.items.length === 0) return;
  const count = state.sqlAutocomplete.items.length;
  state.sqlAutocomplete.selectedIndex = (index + count) % count;
  Array.from(els.sqlAutocomplete.children).forEach((child, childIndex) => {
    const active = childIndex === state.sqlAutocomplete.selectedIndex;
    child.classList.toggle("active", active);
    child.setAttribute("aria-selected", active ? "true" : "false");
    if (active) child.scrollIntoView({ block: "nearest" });
  });
  els.sqlEditor.setAttribute("aria-activedescendant", `sqlAutocompleteOption${state.sqlAutocomplete.selectedIndex}`);
}

function acceptSqlAutocompleteItem(index) {
  const item = state.sqlAutocomplete.items[index];
  if (!item) return;

  const editor = els.sqlEditor;
  const before = editor.value.slice(0, state.sqlAutocomplete.tokenStart);
  const after = editor.value.slice(state.sqlAutocomplete.tokenEnd);
  let insertText = item.insertText || item.value;
  const nextChar = after[0] || "";
  if (item.appendSpace && !/[\s),;]/.test(nextChar)) {
    insertText += " ";
  }

  editor.value = before + insertText + after;
  const cursor = Number.isFinite(item.cursorOffset)
    ? before.length + item.cursorOffset
    : before.length + insertText.length;
  editor.focus();
  editor.setSelectionRange(cursor, cursor);
  hideSqlAutocomplete();
}

function hideSqlAutocomplete() {
  state.sqlAutocomplete.visible = false;
  state.sqlAutocomplete.items = [];
  state.sqlAutocomplete.selectedIndex = 0;
  els.sqlAutocomplete.classList.add("hidden");
  els.sqlAutocomplete.innerHTML = "";
  els.sqlEditor.setAttribute("aria-expanded", "false");
  els.sqlEditor.removeAttribute("aria-activedescendant");
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
  if (column === "__rownum") return 42;
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

function setAiPanelWidth(width) {
  const nextWidth = Math.max(280, Math.min(680, width));
  document.documentElement.style.setProperty("--ai-panel-width", `${nextWidth}px`);
  localStorage.setItem(AI_PANEL_WIDTH_KEY, String(nextWidth));
}

function setAiPanelCollapsed(collapsed) {
  state.aiPanelCollapsed = Boolean(collapsed);
  document.body.classList.toggle("ai-panel-collapsed", state.aiPanelCollapsed);
  els.aiOpenButton.classList.toggle("hidden", !state.aiPanelCollapsed);
  localStorage.setItem(AI_PANEL_COLLAPSED_KEY, state.aiPanelCollapsed ? "1" : "0");
}

function setupAiPanelResize() {
  const savedWidth = Number(localStorage.getItem(AI_PANEL_WIDTH_KEY));
  if (savedWidth) {
    setAiPanelWidth(savedWidth);
  }
  setAiPanelCollapsed(state.aiPanelCollapsed);

  let startX = 0;
  let startWidth = 0;

  function onMove(event) {
    setAiPanelWidth(startWidth + startX - event.clientX);
  }

  function onUp() {
    document.body.classList.remove("resizing-ai");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }

  els.aiResizeHandle.addEventListener("mousedown", (event) => {
    startX = event.clientX;
    startWidth = Number(getComputedStyle(document.documentElement).getPropertyValue("--ai-panel-width").replace("px", "")) || 360;
    document.body.classList.add("resizing-ai");
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

function clearRowHighlights() {
  state.highlightedRowKeys.clear();
  state.isDraggingRowHighlight = false;
}

function clearCellSelection() {
  state.cellSelection = null;
  state.isDraggingCellSelection = false;
  updateCellSelectionView({ immediate: true });
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

function loadLegacyStoredConnections() {
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

function normalizeStoredConnections(connections) {
  if (!Array.isArray(connections)) return [];
  return connections.map((connection) => ({
    ...connection,
    kind: connection.kind || "sql",
    redisEnabled: Boolean(connection.redisEnabled),
    redisConnected: false,
    sqlConnected: false,
  }));
}

function serializableConnections() {
  const persisted = state.connections.map(({ tables, loadingTables, sqlConnected, redisConnected, redisError, ...connection }) => connection);
  return persisted;
}

async function loadStoredConnections() {
  try {
    const data = await api("/api/connections");
    const serverConnections = normalizeStoredConnections(data.connections);
    if (serverConnections.length > 0) {
      localStorage.removeItem(STORAGE_KEY);
      return serverConnections;
    }

    const legacyConnections = loadLegacyStoredConnections();
    if (legacyConnections.length > 0) {
      state.connections = legacyConnections;
      await saveStoredConnections();
      localStorage.removeItem(STORAGE_KEY);
      return legacyConnections;
    }
    return [];
  } catch (error) {
    setMessage(`读取本地连接配置失败：${error.message}`, true);
    return loadLegacyStoredConnections();
  }
}

async function saveStoredConnections() {
  const persisted = serializableConnections();
  await api("/api/connections", {
    method: "PUT",
    body: JSON.stringify({ connections: persisted }),
  });
}

function renderConnections() {
  els.connectionList.innerHTML = "";
  state.connections.forEach((connection) => {
    const item = document.createElement("details");
    item.className = "connection-item";
    item.open = state.expandedConnectionIds.has(connection.id);
    item.addEventListener("toggle", () => {
      if (item.open) {
        state.expandedConnectionIds.add(connection.id);
      } else {
        state.expandedConnectionIds.delete(connection.id);
      }
    });
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
    main.addEventListener("click", (event) => {
      event.preventDefault();
      handleConnectionClick(connection.id);
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
  renderAiConnectionOptions();
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
  clearRowHighlights();
  clearCellSelection();
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

function defaultSqlForTable(table) {
  return `select * from ${table.name}`;
}

function activeTableTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

function rememberActiveTabSql() {
  const tab = activeTableTab();
  if (!tab) return;
  const sql = els.sqlEditor.value;
  tab.sql = sql;
  if (state.activeQuery && state.activeQuery.sql !== sql) {
    state.activeQuery = null;
    tab.activeQuery = null;
  }
}

function rememberActiveTabQuery(activeQuery = state.activeQuery) {
  const tab = activeTableTab();
  if (!tab) return;
  tab.activeQuery = activeQuery ? { ...activeQuery } : null;
}

function activeTableSort() {
  const tab = activeTableTab();
  const sort = state.activeQuery?.sort || tab?.sort || null;
  if (!sort?.column || !["asc", "desc"].includes(sort.dir)) return null;
  const hasColumn = state.gridColumns.includes(sort.column) || state.activeTable?.columns?.some((column) => column.name === sort.column);
  return hasColumn ? sort : null;
}

function canSortGridColumns() {
  return Boolean(state.gridColumns.length > 0 && (state.activeQuery || (state.activeTable && activeTableTab() && !state.queryMode)));
}

async function sortTableByColumn(column) {
  if (!canSortGridColumns()) return;
  const current = activeTableSort();
  const nextSort = {
    column,
    dir: current?.column === column && current.dir === "asc" ? "desc" : "asc",
  };
  if (state.activeQuery) {
    state.activeQuery.sort = nextSort;
    rememberActiveTabQuery(state.activeQuery);
    await loadQueryRows({
      append: false,
      sql: state.activeQuery.sql,
      limit: state.activeQuery.limit,
      sort: nextSort,
      restoreTabQuery: true,
    });
    return;
  }

  const tab = activeTableTab();
  if (!tab) return;
  tab.sort = nextSort;
  await loadRows({ append: false });
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
      sql: defaultSqlForTable(table),
      activeQuery: null,
      sort: null,
    };
    state.tabs.push(tab);
  }
  return switchTab(id);
}

async function switchTab(id) {
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab) return;

  hideSqlAutocomplete();
  rememberActiveTabSql();
  rememberActiveTabQuery();
  state.activeTabId = id;
  state.activeConnectionId = tab.connectionId;
  state.activeTable = tab.table;
  state.queryMode = false;
  state.activeQuery = tab.activeQuery ? { ...tab.activeQuery } : null;
  clearPendingChanges();
  renderTabs();
  renderConnections();
  els.sqlEditor.value = tab.sql || defaultSqlForTable(tab.table);
  if (state.activeQuery) {
    await loadQueryRows({
      append: false,
      sql: state.activeQuery.sql,
      limit: state.activeQuery.limit,
      sort: state.activeQuery.sort || null,
      restoreTabQuery: true,
    });
  } else {
    els.viewTitle.textContent = `浏览数据 ${tab.table.name}`;
    els.viewMeta.textContent = `${tab.hostLabel}，每次加载 ${TABLE_ROW_LIMIT} 行${tab.connection.readonly ? "，只读连接" : ""}`;
    await loadRows({ append: false });
  }
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

async function addConnection(event) {
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
    existing.tables = [];
    existing.loadingTables = false;
    existing.readonly = readonly;
    state.expandedConnectionIds.delete(existing.id);
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

  try {
    await saveStoredConnections();
    renderConnections();
    state.editingConnectionId = null;
    closeConnectionModal();
    setMessage("连接已保存到本地配置，启动后会自动加载");
  } catch (error) {
    setMessage(`保存连接失败：${error.message}`, true);
  }
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

async function handleConnectionClick(id) {
  const connection = connectionById(id);
  if (!connection) return;

  const hasLoadedTables = !isRedisOnly(connection) && Array.isArray(connection.tables) && connection.tables.length > 0;
  const alreadyConnected = isRedisOnly(connection)
    ? Boolean(connection.redisConnected)
    : Boolean(connection.sqlConnected && hasLoadedTables);

  if (!alreadyConnected) {
    await useConnection(id);
    return;
  }

  state.expandedConnectionIds.add(id);
  if (!state.activeTable && !state.queryMode) {
    state.activeConnectionId = id;
  }
  renderConnections();
  if (isRedisOnly(connection)) {
    if (!state.activeTable && !state.queryMode) {
      renderGrid([], [], false);
      els.viewTitle.textContent = connection.name;
      els.viewMeta.textContent = `${connectionHostLabel()}，Redis 连接已激活`;
    }
    setMessage("Redis 连接已展开");
  } else if (!state.activeTable && !state.queryMode) {
    els.viewTitle.textContent = connection.name;
    els.viewMeta.textContent = "已连接，点击左侧数据表打开或切换 tab";
    setMessage(`已显示 ${connection.tables.length} 个数据表`);
  } else {
    setMessage(`已显示 ${connection.tables.length} 个数据表`);
  }
}

async function deleteConnection(id) {
  if (state.aiConnectionId === id) {
    setCurrentAiSession(null);
    state.aiConnectionId = null;
    state.aiMessages = [];
    showAiSql("");
    renderAiMessages();
  }
  await forgetAiSessionForConnection(id);
  state.expandedConnectionIds.delete(id);
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
      els.viewMeta.textContent = "已加载本地配置连接，点击后才连接数据库";
    }
  }
  try {
    await saveStoredConnections();
    renderConnections();
  } catch (error) {
    setMessage(`删除连接后保存配置失败：${error.message}`, true);
  }
}

async function useConnection(id) {
  hideSqlAutocomplete();
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
    state.expandedConnectionIds.add(id);
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
    parts.push(`${tableRowCountPrefix(table)}${formatCount(table.row_count)}行`);
  }
  if (Number.isFinite(Number(table.size_bytes))) {
    parts.push(formatBytes(table.size_bytes));
  }
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function tableStatsTitle(table) {
  const parts = [table.name];
  if (Number.isFinite(Number(table.row_count))) {
    parts.push(`${tableRowCountPrefix(table)}${Number(table.row_count).toLocaleString("zh-CN")} 行`);
  }
  if (Number.isFinite(Number(table.size_bytes))) {
    parts.push(formatBytes(table.size_bytes));
  }
  return parts.join(" · ");
}

function tableRowCountPrefix(table) {
  if (table.row_count_lower_bound) return "至少";
  if (table.row_count_estimated) return "约";
  return "";
}

function syncTableLoadedCount(table, loadedCount) {
  if (!table || !Number.isFinite(Number(loadedCount))) return;
  const loaded = Number(loadedCount);
  const displayed = Number(table.row_count);
  if (!Number.isFinite(displayed) || loaded > displayed) {
    table.row_count = loaded;
    table.row_count_estimated = false;
    table.row_count_lower_bound = true;
    renderConnections();
  }
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
    rememberActiveTabQuery(null);
  }
  const offset = append ? state.activeRealRowsLoaded : 0;
  if (!append) {
    clearPendingChanges();
    clearRowHighlights();
    clearCellSelection();
  }
  setMessage(append ? `正在继续加载 ${TABLE_ROW_LIMIT} 行数据...` : `正在加载前 ${TABLE_ROW_LIMIT} 行数据...`);
  try {
    const params = new URLSearchParams({
      limit: String(TABLE_ROW_LIMIT),
      offset: String(offset),
    });
    const sort = activeTableSort();
    if (sort) {
      params.set("sort_by", sort.column);
      params.set("sort_dir", sort.dir);
    }
    const data = await api(`/api/tables/${encodeURIComponent(state.activeTable.name)}/rows?${params.toString()}`, {
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
    syncTableLoadedCount(state.activeTable, state.activeRealRowsLoaded);
    setMessage(rowLoadMessage());
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    finishRowsLoading();
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

function finishRowsLoading() {
  state.isLoadingRows = false;
  if (state.gridVirtual) {
    renderVisibleRows({ force: true });
  } else if (state.gridColumns.length > 0) {
    renderAllRows();
  }
}

async function loadQueryRows({
  append = false,
  sql: explicitSql = null,
  limit: explicitLimit = null,
  sort: explicitSort = undefined,
  restoreTabQuery = false,
} = {}) {
  if (isRedisOnly()) {
    setMessage("Redis 连接不能执行 SQL 查询", true);
    return;
  }
  if (state.isLoadingRows) return;
  if (append && (!state.activeQuery || !state.activeRowsHasMore)) return;

  const sql = append ? state.activeQuery?.sql : explicitSql || els.sqlEditor.value;
  const queryLimit = append ? state.activeQuery?.limit || QUERY_ROW_LIMIT : Number(explicitLimit || els.limitInput.value || QUERY_ROW_LIMIT);
  const offset = append ? state.activeRealRowsLoaded : 0;
  const querySort = append
    ? state.activeQuery?.sort || null
    : explicitSort === undefined
      ? state.activeQuery?.sort || null
      : explicitSort;
  if (!sql) return;

  if (!append) {
    els.sqlEditor.value = sql;
    rememberActiveTabSql();
  }
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
        sort_by: querySort?.column || null,
        sort_dir: querySort?.dir || "asc",
      }),
    });
    const parsedTotal = parseOptionalNumber(data.total);
    state.activeRowsTotal = Number.isFinite(parsedTotal) ? parsedTotal : null;
    state.activeRowsHasMore = hasMoreRows(data);
    state.activeRealRowsLoaded = Number.isFinite(data.loaded) ? data.loaded : offset + data.rows.length;
    state.activeQuery = { sql, limit: queryLimit, tableName: tableForQuery?.name || null };
    if (querySort) {
      state.activeQuery.sort = { ...querySort };
    }
    if (!append && restoreTabQuery) {
      rememberActiveTabQuery(state.activeQuery);
    }
    if (!append) {
      clearPendingChanges();
      clearRowHighlights();
      clearCellSelection();
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
      syncTableLoadedCount(tableForQuery, state.activeRealRowsLoaded);
      if (!append) {
        const matchingTab = state.tabs.find((tab) => tab.connectionId === state.activeConnectionId && tab.table.name === tableForQuery.name);
        if (matchingTab) {
          state.activeTabId = matchingTab.id;
          matchingTab.sql = sql;
          matchingTab.activeQuery = { ...state.activeQuery };
          renderTabs();
          renderConnections();
        }
      }
    } else {
      rememberActiveTabQuery(null);
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
    finishRowsLoading();
  }
}

async function runQuery() {
  await loadQueryRows({ append: false, sort: null });
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
    updateExportSelectionButton();
    return;
  }

  const displayColumns = editable && state.activeTable?.primary_key ? ["__rownum", "__select", ...columns] : ["__rownum", ...columns];
  state.gridDisplayColumnCount = displayColumns.length;
  const colgroup = document.createElement("colgroup");
  displayColumns.forEach((column, index) => {
    const col = document.createElement("col");
    col.dataset.colIndex = String(index);
    col.style.width = `${defaultColumnWidth(column)}px`;
    if (column !== "__rownum" && column !== "__select") {
      col.style.width = `${columnWidth(column)}px`;
    }
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
  const sortable = canSortGridColumns();
  const sort = sortable ? activeTableSort() : null;
  columns.forEach((column, columnIndex) => {
    const displayIndex = editable && state.activeTable?.primary_key ? columnIndex + 2 : columnIndex + 1;
    const th = document.createElement("th");
    th.dataset.colIndex = String(displayIndex);
    const isSorted = sort?.column === column;
    const label = sortable ? document.createElement("button") : document.createElement("span");
    label.className = sortable ? "th-label th-sort-button" : "th-label";
    if (sortable) {
      label.type = "button";
      label.classList.toggle("active", isSorted);
      label.title = isSorted
        ? `按 ${column} ${sort.dir === "asc" ? "降序" : "升序"}排序`
        : `按 ${column} 升序排序`;
      th.setAttribute("aria-sort", isSorted ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
      label.addEventListener("click", () => {
        sortTableByColumn(column).catch((error) => setMessage(error.message, true));
      });
      const labelText = document.createElement("span");
      labelText.className = "th-label-text";
      labelText.textContent = column;
      const indicator = document.createElement("span");
      indicator.className = "th-sort-indicator";
      indicator.textContent = isSorted ? (sort.dir === "asc" ? "↑" : "↓") : "";
      label.append(labelText, indicator);
    } else {
      label.textContent = column;
    }
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
  updateExportSelectionButton();
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

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function createRowElement(columns, row, editable, rowIndex) {
  const tr = document.createElement("tr");
  tr.dataset.rowIndex = String(rowIndex);
  tr.classList.toggle("highlight-row", isRowHighlighted(row, rowIndex));
  tr.classList.toggle("selected-row", isRowSelected(row));
  if (row.__virtual) {
    tr.classList.add("virtual-row");
  } else if (state.activeTable?.primary_key && state.pendingDeletes.has(String(row[state.activeTable.primary_key]))) {
    tr.classList.add("delete-row");
  }
  const rowNumberCell = document.createElement("td");
  rowNumberCell.className = "row-number-column";
  rowNumberCell.dataset.rowHandle = "true";
  rowNumberCell.textContent = row.__virtual ? "*" : String(rowIndex + 1);
  rowNumberCell.title = "点击选中整行，按住拖动可连续选择";
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
  columns.forEach((column, columnIndex) => {
    const td = document.createElement("td");
    td.dataset.selectableCell = "true";
    td.dataset.rowIndex = String(rowIndex);
    td.dataset.columnIndex = String(columnIndex);
    td.classList.toggle("cell-selected", isCellSelected(rowIndex, columnIndex));
    const pendingChange = pendingChangeForCell(row, column);
    const rawValue = pendingChange ? pendingChange.value : row[column];
    td.textContent = formatCellValue(rawValue);
    td.dataset.tooltipValue = td.textContent;

    if (editable && canEditCell(row, column)) {
      td.dataset.editableCell = "true";
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

function rowHighlightKey(row, rowIndex) {
  if (!row) return null;
  const primaryKey = state.activeTable?.primary_key;
  if (!row.__virtual && primaryKey && row[primaryKey] !== undefined && row[primaryKey] !== null) {
    return `pk:${String(row[primaryKey])}`;
  }
  if (row.__clientId) {
    return `client:${row.__clientId}`;
  }
  return `index:${rowIndex}`;
}

function isRowHighlighted(row, rowIndex) {
  const key = rowHighlightKey(row, rowIndex);
  return key ? state.highlightedRowKeys.has(key) : false;
}

function setRowHighlight(row, rowIndex, highlighted) {
  const key = rowHighlightKey(row, rowIndex);
  if (!key) return;
  if (highlighted) {
    state.highlightedRowKeys.add(key);
  } else {
    state.highlightedRowKeys.delete(key);
  }
  const tr = els.tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
  tr?.classList.toggle("highlight-row", highlighted);
}

function rowIndexForEventTarget(target) {
  const tr = target.closest("tr[data-row-index]");
  if (!tr) return null;
  const rowIndex = Number(tr.dataset.rowIndex);
  return Number.isInteger(rowIndex) ? rowIndex : null;
}

function normalizedCellSelection() {
  const selection = state.cellSelection;
  if (!selection) return null;
  return {
    rowStart: Math.min(selection.anchorRow, selection.focusRow),
    rowEnd: Math.max(selection.anchorRow, selection.focusRow),
    colStart: Math.min(selection.anchorCol, selection.focusCol),
    colEnd: Math.max(selection.anchorCol, selection.focusCol),
  };
}

function isCellSelected(rowIndex, columnIndex) {
  const selection = normalizedCellSelection();
  return Boolean(
    selection &&
    rowIndex >= selection.rowStart &&
    rowIndex <= selection.rowEnd &&
    columnIndex >= selection.colStart &&
    columnIndex <= selection.colEnd
  );
}

function updateCellSelectionView({ immediate = false } = {}) {
  if (!immediate) {
    if (state.cellSelectionRenderFrame) return;
    state.cellSelectionRenderFrame = requestAnimationFrame(() => {
      state.cellSelectionRenderFrame = 0;
      renderCellSelectionView();
    });
    return;
  }
  if (state.cellSelectionRenderFrame) {
    cancelAnimationFrame(state.cellSelectionRenderFrame);
    state.cellSelectionRenderFrame = 0;
  }
  renderCellSelectionView();
}

function renderCellSelectionView() {
  const selection = normalizedCellSelection();
  els.tbody.querySelectorAll('td[data-selectable-cell="true"]').forEach((td) => {
    const rowIndex = Number(td.dataset.rowIndex);
    const columnIndex = Number(td.dataset.columnIndex);
    td.classList.toggle(
      "cell-selected",
      Boolean(
        selection &&
        rowIndex >= selection.rowStart &&
        rowIndex <= selection.rowEnd &&
        columnIndex >= selection.colStart &&
        columnIndex <= selection.colEnd
      ),
    );
  });
  updateExportSelectionButton();
}

function updateExportSelectionButton() {
  const selection = normalizedCellSelection();
  const disabled = !selection || state.gridColumns.length === 0 || state.activeRows.length === 0;
  if (els.copySelectionButton) {
    els.copySelectionButton.disabled = disabled;
  }
  if (els.exportSelectionButton) {
    els.exportSelectionButton.disabled = disabled;
  }
}

function selectableCellForEvent(event) {
  return event.target.closest('td[data-selectable-cell="true"]');
}

function cellPositionFromElement(cell) {
  const rowIndex = Number(cell.dataset.rowIndex);
  const columnIndex = Number(cell.dataset.columnIndex);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return null;
  return { rowIndex, columnIndex };
}

function setCellSelection(anchor, focus = anchor) {
  state.cellSelection = {
    anchorRow: anchor.rowIndex,
    anchorCol: anchor.columnIndex,
    focusRow: focus.rowIndex,
    focusCol: focus.columnIndex,
  };
  updateCellSelectionView();
}

function extendCellSelection(position) {
  if (!state.cellSelection) return;
  if (state.cellSelection.focusRow === position.rowIndex && state.cellSelection.focusCol === position.columnIndex) return;
  setCellSelection(
    { rowIndex: state.cellSelection.anchorRow, columnIndex: state.cellSelection.anchorCol },
    position,
  );
}

function setRowCellSelection(anchorRowIndex, focusRowIndex = anchorRowIndex) {
  const lastColumnIndex = state.gridColumns.length - 1;
  if (lastColumnIndex < 0) return;
  setCellSelection(
    { rowIndex: anchorRowIndex, columnIndex: 0 },
    { rowIndex: focusRowIndex, columnIndex: lastColumnIndex },
  );
}

function extendRowCellSelection(rowIndex) {
  if (!state.cellSelection) return;
  setRowCellSelection(state.cellSelection.anchorRow, rowIndex);
}

function isRowSelected(row) {
  const key = rowSelectionKey(row);
  return key ? state.selectedRowKeys.has(key) : false;
}

function trackCellChange(td, row, column) {
  td.classList.remove("editing", "error");
  const nextValue = td.textContent;
  const original = td.dataset.original || "";
  td.dataset.tooltipValue = nextValue;

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

function activeEditingCell() {
  const activeElement = document.activeElement;
  if (!activeElement?.closest) return null;
  const td = activeElement.closest('td[contenteditable="true"]');
  return td && els.tbody.contains(td) ? td : null;
}

function placeCaretAtEnd(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function startCellEdit(td) {
  if (!td?.matches?.('td[data-editable-cell="true"]')) return;
  const current = activeEditingCell();
  if (current && current !== td) {
    current.blur();
  }
  td.contentEditable = "true";
  td.classList.add("editing");
  td.focus({ preventScroll: true });
  placeCaretAtEnd(td);
}

function finishCellEdit(td) {
  if (!td) return;
  const row = rowForEventTarget(td);
  const column = td.dataset.column;
  if (row && column) {
    trackCellChange(td, row, column);
  } else {
    td.classList.remove("editing");
  }
  td.removeAttribute("contenteditable");
}

function rowForEventTarget(target) {
  const tr = target.closest("tr[data-row-index]");
  if (!tr) return null;
  const rowIndex = Number(tr.dataset.rowIndex);
  if (!Number.isInteger(rowIndex)) return null;
  return state.activeRows[rowIndex] || null;
}

function rowNumberCellForEvent(event) {
  return event.target.closest('td[data-row-handle="true"]');
}

function highlightRowForEvent(event, options = {}) {
  const cell = rowNumberCellForEvent(event);
  if (!cell) return false;
  const rowIndex = rowIndexForEventTarget(cell);
  if (rowIndex === null) return false;
  const row = state.activeRows[rowIndex];
  if (!row) return false;
  const highlighted = options.toggle ? !isRowHighlighted(row, rowIndex) : true;
  setRowHighlight(row, rowIndex, highlighted);
  return true;
}

function renderRowHighlights() {
  els.tbody.querySelectorAll("tr.highlight-row").forEach((tr) => tr.classList.remove("highlight-row"));
  state.highlightedRowKeys.clear();
}

function handleTableBodyPointerDown(event) {
  if (event.button !== 0) return;
  if (!rowNumberCellForEvent(event)) return;
  renderRowHighlights();
  if (!highlightRowForEvent(event)) return;
  const rowIndex = rowIndexForEventTarget(event.target);
  if (rowIndex !== null) {
    setRowCellSelection(rowIndex);
  }
  state.isDraggingRowHighlight = true;
  event.preventDefault();
}

function handleTableBodyPointerOver(event) {
  if (!state.isDraggingRowHighlight || event.buttons !== 1) return;
  if (highlightRowForEvent(event)) {
    const rowIndex = rowIndexForEventTarget(event.target);
    if (rowIndex !== null) {
      extendRowCellSelection(rowIndex);
    }
  }
}

function finishRowHighlightDrag() {
  state.isDraggingRowHighlight = false;
}

function handleCellSelectionPointerDown(event) {
  if (event.button !== 0) return;
  const cell = selectableCellForEvent(event);
  if (!cell) return;
  const editingCell = activeEditingCell();
  if (editingCell) {
    if (editingCell === cell) return;
    editingCell.blur();
  }
  const position = cellPositionFromElement(cell);
  if (!position) return;
  setCellSelection(position);
  state.isDraggingCellSelection = true;
  state.cellSelectionPointer = { x: event.clientX, y: event.clientY };
  startCellSelectionAutoScroll();
  event.preventDefault();
}

function handleCellSelectionPointerOver(event) {
  if (!state.isDraggingCellSelection || event.buttons !== 1 || !state.cellSelection) return;
  state.cellSelectionPointer = { x: event.clientX, y: event.clientY };
  const cell = selectableCellForEvent(event);
  if (!cell) return;
  const position = cellPositionFromElement(cell);
  if (!position) return;
  extendCellSelection(position);
}

function finishCellSelectionDrag() {
  state.isDraggingCellSelection = false;
  state.cellSelectionPointer = null;
  stopCellSelectionAutoScroll();
  updateCellSelectionView({ immediate: true });
}

function handleCellSelectionPointerMove(event) {
  if (!state.isDraggingCellSelection) return;
  state.cellSelectionPointer = { x: event.clientX, y: event.clientY };
}

function startCellSelectionAutoScroll() {
  if (state.cellSelectionScrollFrame) return;
  const tick = () => {
    state.cellSelectionScrollFrame = 0;
    if (!state.isDraggingCellSelection || !state.cellSelectionPointer) return;

    const { dx, dy } = cellSelectionScrollDelta(state.cellSelectionPointer);
    if (dx !== 0 || dy !== 0) {
      els.tableWrap.scrollLeft += dx;
      els.tableWrap.scrollTop += dy;
      if (dy !== 0) {
        scheduleVisibleRowsRender();
      }
      extendCellSelectionFromPointer();
    }

    state.cellSelectionScrollFrame = requestAnimationFrame(tick);
  };
  state.cellSelectionScrollFrame = requestAnimationFrame(tick);
}

function stopCellSelectionAutoScroll() {
  if (!state.cellSelectionScrollFrame) return;
  cancelAnimationFrame(state.cellSelectionScrollFrame);
  state.cellSelectionScrollFrame = 0;
}

function cellSelectionScrollDelta(pointer) {
  const rect = els.tableWrap.getBoundingClientRect();
  return {
    dx: edgeScrollDelta(pointer.x, rect.left, rect.right),
    dy: edgeScrollDelta(pointer.y, rect.top, rect.bottom),
  };
}

function edgeScrollDelta(position, start, end) {
  if (start >= end) return 0;
  if (position < start + CELL_SELECTION_SCROLL_EDGE) {
    const ratio = Math.min(1, Math.max(0, (start + CELL_SELECTION_SCROLL_EDGE - position) / CELL_SELECTION_SCROLL_EDGE));
    return -Math.ceil(ratio * CELL_SELECTION_MAX_SCROLL_SPEED);
  }
  if (position > end - CELL_SELECTION_SCROLL_EDGE) {
    const ratio = Math.min(1, Math.max(0, (position - (end - CELL_SELECTION_SCROLL_EDGE)) / CELL_SELECTION_SCROLL_EDGE));
    return Math.ceil(ratio * CELL_SELECTION_MAX_SCROLL_SPEED);
  }
  return 0;
}

function extendCellSelectionFromPointer() {
  const pointer = state.cellSelectionPointer;
  if (!pointer) return;
  const rect = els.tableWrap.getBoundingClientRect();
  const x = Math.min(rect.right - 2, Math.max(rect.left + 2, pointer.x));
  const y = Math.min(rect.bottom - 2, Math.max(rect.top + 2, pointer.y));
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest?.('td[data-selectable-cell="true"]');
  if (!cell) return;
  const position = cellPositionFromElement(cell);
  if (position) {
    extendCellSelection(position);
  }
}

function selectedCellMatrix() {
  const selection = normalizedCellSelection();
  if (!selection) return null;
  const columns = state.gridColumns.slice(selection.colStart, selection.colEnd + 1);
  const rows = [];
  for (let rowIndex = selection.rowStart; rowIndex <= selection.rowEnd; rowIndex += 1) {
    const row = state.activeRows[rowIndex];
    if (!row) continue;
    rows.push(columns.map((column) => formatCellValue(row[column])));
  }
  return { columns, rows };
}

function exportSelectedCells() {
  const matrix = selectedCellMatrix();
  if (!matrix || matrix.columns.length === 0 || matrix.rows.length === 0) {
    setMessage("请先框选需要导出的单元格", true);
    return;
  }
  const lines = [matrix.columns, ...matrix.rows].map((row) => row.map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${exportFileBaseName()}-selection.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage(`已导出 ${matrix.rows.length} 行 × ${matrix.columns.length} 列`);
}

async function copySelectedCells() {
  const matrix = selectedCellMatrix();
  if (!matrix || matrix.columns.length === 0 || matrix.rows.length === 0) {
    setMessage("请先框选需要复制的单元格", true);
    return;
  }
  const text = tableText(matrix);
  try {
    await writeClipboardText(text);
    setMessage(`已复制 ${matrix.rows.length} 行 × ${matrix.columns.length} 列`);
  } catch (error) {
    setMessage(`复制失败：${error.message}`, true);
  }
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("浏览器未允许写入剪贴板");
  }
}

function tableText(matrix) {
  return [matrix.columns, ...matrix.rows].map((row) => row.map(tsvCell).join("\t")).join("\n");
}

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ");
}

function handleDocumentCopyShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") return;
  if (!normalizedCellSelection()) return;
  if (event.target.closest("input, textarea, [contenteditable='true']")) return;
  event.preventDefault();
  copySelectedCells();
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportFileBaseName() {
  const source = state.activeTable?.name || (state.queryMode ? "query" : "selection");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${source}-${timestamp}`;
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
  checkbox.closest("tr[data-row-index]")?.classList.toggle("selected-row", checkbox.checked);
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
  finishCellEdit(td);
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

function handleTableBodyDoubleClick(event) {
  if (event.button !== 0) return;
  const td = event.target.closest('td[data-editable-cell="true"]');
  if (!td || !els.tbody.contains(td)) return;
  hideCellTooltip();
  event.preventDefault();
  startCellEdit(td);
}

function ensureCellTooltip() {
  if (state.cellTooltipElement) return state.cellTooltipElement;
  const tooltip = document.createElement("div");
  tooltip.className = "cell-tooltip hidden";
  tooltip.addEventListener("pointerenter", () => {
    clearCellTooltipTimers();
  });
  tooltip.addEventListener("pointerleave", scheduleHideCellTooltip);
  document.body.appendChild(tooltip);
  state.cellTooltipElement = tooltip;
  return tooltip;
}

function cellTooltipForEvent(event) {
  const cell = event.target.closest('td[data-tooltip-value]');
  if (!cell || !els.tbody.contains(cell)) return null;
  if (cell.matches('[contenteditable="true"], .row-number-column, .select-column')) return null;
  return cell;
}

function handleCellTooltipPointerOver(event) {
  const cell = cellTooltipForEvent(event);
  if (!cell || cell === state.cellTooltipCell) return;
  scheduleCellTooltip(cell);
}

function handleCellTooltipPointerOut(event) {
  const cell = event.target.closest?.('td[data-tooltip-value]');
  if (!cell || !els.tbody.contains(cell)) return;
  const next = event.relatedTarget;
  if (next && (cell.contains(next) || state.cellTooltipElement?.contains(next))) return;
  scheduleHideCellTooltip();
}

function handleDocumentPointerDown(event) {
  if (state.cellTooltipElement?.contains(event.target)) return;
  hideCellTooltip();
}

function scheduleCellTooltip(cell) {
  clearCellTooltipTimers();
  state.cellTooltipCell = cell;
  state.cellTooltipTimer = window.setTimeout(() => {
    state.cellTooltipTimer = 0;
    showCellTooltip(cell);
  }, CELL_TOOLTIP_DELAY);
}

function scheduleHideCellTooltip() {
  if (state.cellTooltipHideTimer) return;
  if (state.cellTooltipTimer) {
    clearTimeout(state.cellTooltipTimer);
    state.cellTooltipTimer = 0;
  }
  state.cellTooltipHideTimer = window.setTimeout(() => {
    state.cellTooltipHideTimer = 0;
    if (state.cellTooltipElement?.matches(":hover")) return;
    hideCellTooltip();
  }, CELL_TOOLTIP_HIDE_DELAY);
}

function clearCellTooltipHideTimer() {
  if (!state.cellTooltipHideTimer) return;
  clearTimeout(state.cellTooltipHideTimer);
  state.cellTooltipHideTimer = 0;
}

function clearCellTooltipTimers() {
  if (state.cellTooltipTimer) {
    clearTimeout(state.cellTooltipTimer);
    state.cellTooltipTimer = 0;
  }
  clearCellTooltipHideTimer();
}

function hideCellTooltip(options = {}) {
  if (!options.keepTimer) {
    clearCellTooltipTimers();
  }
  state.cellTooltipCell = null;
  state.cellTooltipElement?.classList.add("hidden");
}

function showCellTooltip(cell) {
  if (!cell?.isConnected || cell.matches('[contenteditable="true"]')) return;
  const value = cell.dataset.tooltipValue ?? cell.textContent ?? "";
  if (!value.trim()) return;

  const tooltip = ensureCellTooltip();
  tooltip.textContent = "";
  const content = document.createElement("pre");
  content.className = "cell-tooltip-content";
  const parsed = formatTooltipValue(value);
  content.textContent = parsed.text;
  tooltip.classList.toggle("json", parsed.type === "json");
  tooltip.appendChild(content);
  tooltip.classList.remove("hidden");
  positionCellTooltip(tooltip, cell);
}

function formatTooltipValue(value) {
  const text = String(value ?? "");
  const trimmed = text.trim();
  if (!trimmed) return { type: "text", text };
  try {
    const parsed = JSON.parse(trimmed);
    return { type: "json", text: JSON.stringify(parsed, null, 2) };
  } catch {
    return { type: "text", text };
  }
}

function positionCellTooltip(tooltip, cell) {
  const gap = 10;
  const margin = 12;
  const cellRect = cell.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const maxLeft = window.innerWidth - tooltipRect.width - margin;
  const maxTop = window.innerHeight - tooltipRect.height - margin;
  let left = Math.min(Math.max(cellRect.left, margin), Math.max(margin, maxLeft));
  let top = cellRect.bottom + gap;

  if (top > maxTop && cellRect.top - tooltipRect.height - gap >= margin) {
    top = cellRect.top - tooltipRect.height - gap;
  }
  top = Math.min(Math.max(top, margin), Math.max(margin, maxTop));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
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
  hideCellTooltip();
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
  } else if (state.activeQuery) {
    await loadQueryRows({
      append: false,
      sql: state.activeQuery.sql,
      limit: state.activeQuery.limit,
      sort: state.activeQuery.sort || null,
      restoreTabQuery: true,
    });
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
els.copySelectionButton.addEventListener("click", () => copySelectedCells());
els.exportSelectionButton.addEventListener("click", exportSelectedCells);
els.commitButton.addEventListener("click", commitChanges);
els.connectionForm.addEventListener("submit", addConnection);
els.redisEnabled.addEventListener("change", () => setRedisEnabled(els.redisEnabled.checked));
els.driverSelect.addEventListener("change", updateConnectionTypeFields);
els.tableWrap.addEventListener("scroll", handleTableScroll);
els.tableWrap.addEventListener("wheel", handleTableWheel, { passive: false });
els.tbody.addEventListener("pointerdown", handleTableBodyPointerDown);
els.tbody.addEventListener("pointerover", handleTableBodyPointerOver);
els.tbody.addEventListener("pointerdown", handleCellSelectionPointerDown);
els.tbody.addEventListener("pointerover", handleCellSelectionPointerOver);
els.tbody.addEventListener("pointerover", handleCellTooltipPointerOver);
els.tbody.addEventListener("pointerout", handleCellTooltipPointerOut);
els.tbody.addEventListener("change", handleTableBodyChange);
els.tbody.addEventListener("dblclick", handleTableBodyDoubleClick);
els.tbody.addEventListener("focusin", handleTableBodyFocusIn);
els.tbody.addEventListener("focusout", handleTableBodyFocusOut);
els.tbody.addEventListener("keydown", handleTableBodyKeyDown);
window.addEventListener("pointerup", finishRowHighlightDrag);
window.addEventListener("pointerup", finishCellSelectionDrag);
window.addEventListener("pointermove", handleCellSelectionPointerMove);
window.addEventListener("blur", finishRowHighlightDrag);
window.addEventListener("blur", finishCellSelectionDrag);
window.addEventListener("resize", hideCellTooltip);
document.addEventListener("pointerdown", handleDocumentPointerDown);
document.addEventListener("keydown", handleDocumentCopyShortcut);
els.newConnectionButton.addEventListener("click", () => openConnectionModal());
els.closeConnectionModal.addEventListener("click", closeConnectionModal);
els.cancelConnectionButton.addEventListener("click", closeConnectionModal);
els.closeDeleteModal.addEventListener("click", closeDeleteConnectionModal);
els.cancelDeleteButton.addEventListener("click", closeDeleteConnectionModal);
els.confirmDeleteButton.addEventListener("click", confirmDeleteConnection);
els.aiForm.addEventListener("submit", submitAiMessage);
els.aiUseSqlButton.addEventListener("click", useAiSqlInEditor);
els.aiResetButton.addEventListener("click", () => {
  resetAiSession().catch((error) => setMessage(`重置 AI 会话失败：${error.message}`, true));
});
els.aiSkillUploadButton.addEventListener("click", () => {
  els.aiSkillFile.click();
});
els.aiSkillFile.addEventListener("change", () => {
  uploadAiSkillFromFile(els.aiSkillFile.files?.[0]).catch((error) => setMessage(`Skill 上传失败：${error.message}`, true));
});
els.aiCloseButton.addEventListener("click", () => setAiPanelCollapsed(true));
els.aiOpenButton.addEventListener("click", () => setAiPanelCollapsed(false));
els.aiModelSelect.addEventListener("change", () => {
  state.aiModelId = els.aiModelSelect.value || null;
  if (state.aiModelId) {
    sessionStorage.setItem(AI_MODEL_KEY, state.aiModelId);
  } else {
    sessionStorage.removeItem(AI_MODEL_KEY);
  }
  updateAiControls();
});
els.aiConnectionSelect.addEventListener("change", () => {
  switchAiConnection(els.aiConnectionSelect.value || null);
});
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
  try {
    sessionStorage.removeItem("sqlRedisVisualAiSessionId");
    setupSidebarResize();
    setupAiPanelResize();
    setupSqlAutocomplete();
    state.connections = await loadStoredConnections();
    await loadAiSessionLinks();
    els.redisUrl.value = DEFAULT_REDIS_URL;
    setRedisEnabled(false);
    els.limitInput.value = QUERY_ROW_LIMIT;
    renderConnections();
    setPendingStatus();
    updateCommitButton();
    els.viewTitle.textContent = state.connections.length > 0 ? "选择连接" : "添加连接";
    els.viewMeta.textContent = "连接信息保存在后端本地配置，不会自动连接数据库";
    setMessage("添加或点击左侧连接后开始浏览数据");
    renderAiMessages();
    await loadAiConfig();
    await restoreAiSessionMessages();
  } catch (error) {
    setMessage(`页面初始化失败：${error.message}`, true);
    console.error(error);
  } finally {
    updateAiControls();
  }
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
