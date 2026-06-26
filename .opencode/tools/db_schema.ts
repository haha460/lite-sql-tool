import { tool } from "@opencode-ai/plugin"

const appBaseUrl = process.env.APP_API_BASE || "http://127.0.0.1:8000"

export default tool({
  description: "Read the SQL schema for the selected app AI session.",
  args: {
    app_session_id: tool.schema.string().describe("FastAPI AI session id"),
  },
  async execute(args) {
    const response = await fetch(`${appBaseUrl}/api/ai/tool/schema`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: args.app_session_id }),
    })
    return JSON.stringify(await response.json())
  },
})
