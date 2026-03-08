const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { runAgentLoop } = require("./agent-loop");
const { generatePPTX } = require("./file-generators/pptx-generator");
const { generateXLSX } = require("./file-generators/xlsx-generator");
const { v4: uuid } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const OUTPUT_DIR = path.join(__dirname, "..", "output");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Serve generated files
app.use("/files", express.static(OUTPUT_DIR));

// Serve frontend UI
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check (API endpoint)
app.get("/health", (req, res) => {
  res.json({
    status: "running",
    agent: "AI Research Agent v4",
    endpoints: {
      ui: "GET /",
      agent: "POST /api/agent",
      generate_pptx: "POST /api/generate-pptx",
      generate_xlsx: "POST /api/generate-xlsx",
      files: "GET /files/:filename",
    },
  });
});

// ─── Main Agent Endpoint (Server-Sent Events) ───
app.post("/api/agent", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await runAgentLoop(
      message,
      (step) => send({ type: "step", ...step }),
      (artifact) => send({ type: "artifact", ...artifact })
    );
    send({ type: "done", ...result });
  } catch (err) {
    send({ type: "error", message: err.message });
  }
  res.end();
});

// ─── Direct File Generation ───
app.post("/api/generate-pptx", async (req, res) => {
  try {
    const filename = `ppt-${uuid().slice(0, 8)}.pptx`;
    const filepath = path.join(OUTPUT_DIR, filename);
    await generatePPTX(req.body, filepath);
    res.json({ success: true, download_url: `/files/${filename}`, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate-xlsx", async (req, res) => {
  try {
    const filename = `xlsx-${uuid().slice(0, 8)}.xlsx`;
    const filepath = path.join(OUTPUT_DIR, filename);
    await generateXLSX(req.body, filepath);
    res.json({ success: true, download_url: `/files/${filename}`, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
  console.log(`Research model: ${process.env.RESEARCH_MODEL || "claude-sonnet-4-5-20250929"}`);
  console.log(`Synthesis model: ${process.env.SYNTHESIS_MODEL || "claude-opus-4-6"}`);
});
