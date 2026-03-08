const path = require("path");
const { executeTool } = require("./tool-executors");
const { getSkillsConfig, downloadSkillFile } = require("./skills-manager");

const API_URL = "https://api.anthropic.com/v1/messages";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "claude-sonnet-4-5-20250929";
const SYNTHESIS_MODEL = process.env.SYNTHESIS_MODEL || "claude-opus-4-6";

const CUSTOM_TOOLS = [
  "create_presentation", "create_report",
  "create_spreadsheet", "create_chart", "send_email",
];

const SYSTEM_PROMPT = `You are a research agent. Search the web first, then create detailed documents.

TOOLS:
1. web_search — Search the internet for current data
2. create_presentation — Generate slide decks
3. create_report — Generate written reports
4. create_spreadsheet — Generate data tables
5. create_chart — Generate visualizations (bar, line, pie, scatter)
6. send_email — Draft emails

WORKFLOW:
1. ALWAYS search first (2-4 queries) to gather real data
2. Then create documents PACKED with specific data you found

RULES:
- Every bullet must contain a specific fact, number, or finding
- Every spreadsheet row must contain real data points
- Every report section must have 3-5 sentences of analysis
- Include company names, dollar amounts, percentages, dates
- slides, sheets, rows, headers, bullets, datasets, labels MUST be JSON arrays`;

const TOOLS = [
  { type: "web_search_20250305", name: "web_search", max_uses: 10 },
  {
    name: "create_presentation",
    description: "Create a PowerPoint presentation. Include data-rich bullet points on every slide.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        theme_color: { type: "string", description: "Hex without # e.g. 1E2761" },
        slides: { type: "array", items: { type: "object", properties: { title: { type: "string" }, bullets: { type: "array", items: { type: "string" } } }, required: ["title", "bullets"] } },
      },
      required: ["title", "slides"],
    },
  },
  {
    name: "create_report",
    description: "Create a research report with detailed sections.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, content: { type: "string" } }, required: ["heading", "content"] } },
      },
      required: ["title", "sections"],
    },
  },
  {
    name: "create_spreadsheet",
    description: "Create an Excel spreadsheet with real data.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sheets: { type: "array", items: { type: "object", properties: { name: { type: "string" }, headers: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: {} } }, formulas: { type: "array", items: { type: "object", properties: { cell: { type: "string" }, formula: { type: "string" } } } } }, required: ["name", "headers", "rows"] } },
      },
      required: ["title", "sheets"],
    },
  },
  {
    name: "create_chart",
    description: "Create a data visualization chart.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { type: "string", enum: ["bar", "line", "pie", "scatter"] },
        labels: { type: "array", items: { type: "string" } },
        datasets: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } },
      },
      required: ["title", "type", "labels", "datasets"],
    },
  },
  {
    name: "send_email",
    description: "Draft an email.",
    input_schema: {
      type: "object",
      properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
      required: ["to", "subject", "body"],
    },
  },
];

async function callClaude(messages, model, onStep) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY not set. Add it in Railway environment variables.");

  // Merge skills config (modular — only adds if ENABLE_SKILLS is set)
  const skillsConfig = getSkillsConfig();
  const allTools = [...TOOLS];
  if (skillsConfig.skillTools.length) {
    allTools.push(...skillsConfig.skillTools);
  }

  const body = { model, max_tokens: 4096, system: SYSTEM_PROMPT, tools: allTools, messages };
  if (skillsConfig.container) {
    body.container = skillsConfig.container;
  }

  // Build headers — add beta headers if skills are enabled
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
  };
  if (skillsConfig.betas.length) {
    headers["anthropic-beta"] = skillsConfig.betas.join(",");
  }

  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Rate limited — wait and retry
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const waitSecs = retryAfter ? parseInt(retryAfter, 10) : Math.min(30 * attempt, 90);

      if (attempt < MAX_RETRIES) {
        if (onStep) onStep({ step: "rate_limit", attempt, wait: waitSecs, message: `Rate limited. Waiting ${waitSecs}s before retry ${attempt}/${MAX_RETRIES}...` });
        await new Promise(resolve => setTimeout(resolve, waitSecs * 1000));
        continue;
      }
      const text = await res.text();
      throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries. Wait a minute and try again. (${text.slice(0, 200)})`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
    }

    return res.json();
  }
}

async function runAgentLoop(userMessage, onStep, onArtifact) {
  const msgs = [{ role: "user", content: userMessage }];
  let iter = 0;
  let hasSearched = false;

  onStep({ step: "start", message: userMessage.slice(0, 100) });

  while (iter++ < 15) {
    const model = hasSearched && iter > 2 ? SYNTHESIS_MODEL : RESEARCH_MODEL;
    onStep({ step: "api_call", iteration: iter, model: model.includes("opus") ? "Opus 4.6" : "Sonnet" });

    const data = await callClaude(msgs, model, onStep);

    // Parse blocks
    const texts = [], toolCalls = [], searchBlocks = [];
    for (const b of data.content || []) {
      if (b.type === "text" && b.text?.trim()) {
        texts.push(b);
        onStep({ step: "reasoning", text: b.text.slice(0, 200) });
      } else if (b.type === "tool_use") {
        toolCalls.push(b);
        onStep({ step: "tool_call", tool: b.name, input_keys: Object.keys(b.input || {}) });
        if (b.name === "web_search") hasSearched = true;
      } else if (b.type === "web_search_tool_result") {
        searchBlocks.push(b);
        const results = (b.content || []).filter(c => c.type === "web_search_result");
        onStep({ step: "search_results", count: results.length, sources: results.slice(0, 3).map(r => r.title) });
      }
    }

    // Done?
    if (data.stop_reason === "end_turn" || (data.stop_reason !== "tool_use" && !toolCalls.length)) {
      return { text: texts.map(b => b.text).join("\n\n"), usage: data.usage, iterations: iter };
    }

    // Send full content back (preserves citations)
    msgs.push({ role: "assistant", content: data.content });

    // Execute custom tools
    const toolResults = [];
    for (const tc of toolCalls) {
      if (CUSTOM_TOOLS.includes(tc.name)) {
        onStep({ step: "executing", tool: tc.name });
        const result = await executeTool(tc.name, tc.input);
        if (result.success && result.file) {
          onArtifact({
            tool: tc.name,
            title: result.message,
            download_url: result.file.url,
            filename: result.file.name,
          });
        }
        onStep({ step: "tool_result", tool: tc.name, success: result.success, message: result.message });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: JSON.stringify({ success: result.success, message: result.message }),
        });
      } else {
        const hasResult = searchBlocks.some(b => b.tool_use_id === tc.id);
        if (!hasResult) {
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: "Search completed." });
        }
      }
    }

    if (toolResults.length) msgs.push({ role: "user", content: toolResults });
  }

  return { text: "Max iterations reached.", usage: null, iterations: iter };
}

module.exports = { runAgentLoop };
