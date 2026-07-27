import { tool } from "@opencode-ai/plugin"

const appBaseUrl = process.env.APP_API_BASE || "http://127.0.0.1:8000"

export default tool({
  description:
    "Search the project knowledge base (business docs and notes) by semantic meaning. " +
    "Use this before answering questions about business concepts, metric definitions, " +
    "workflows, rules, or any '为什么/怎么算/规则是什么' type question. " +
    "Returns the most relevant text chunks with their source doc_path.",
  args: {
    app_session_id: tool.schema.string().describe("FastAPI AI session id"),
    query: tool.schema.string().describe("Natural-language question to search the knowledge base for"),
    top_k: tool.schema.number().optional().describe("How many chunks to return (default 5, max 20)"),
  },
  async execute(args) {
    const response = await fetch(`${appBaseUrl}/api/ai/tool/knowledge_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: args.app_session_id,
        query: args.query,
        top_k: args.top_k || 5,
      }),
    })
    return JSON.stringify(await response.json())
  },
})
