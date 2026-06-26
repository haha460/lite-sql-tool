import { tool } from "@opencode-ai/plugin"

const appBaseUrl = process.env.APP_API_BASE || "http://127.0.0.1:8000"

export default tool({
  description: "Run a read-only SQL SELECT/WITH query for the selected app AI session.",
  args: {
    app_session_id: tool.schema.string().describe("FastAPI AI session id"),
    sql: tool.schema.string().describe("SELECT/WITH SQL"),
    limit: tool.schema.number().optional().describe("Maximum rows to return"),
  },
  async execute(args) {
    const response = await fetch(`${appBaseUrl}/api/ai/tool/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: args.app_session_id,
        sql: args.sql,
        limit: args.limit || 100,
      }),
    })
    return JSON.stringify(await response.json())
  },
})
