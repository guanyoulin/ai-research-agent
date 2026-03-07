# AI Research Agent

Multi-model research agent that searches the web, then generates real `.pptx`, `.xlsx`, and `.md` files.

- **Sonnet 4** for fast web research
- **Opus 4.6** for synthesis and document creation
- Real PowerPoint and Excel file generation (not JSON previews)

## Deploy to Railway (5 minutes)

### Step 1: Push to GitHub

```bash
# Create a new repo on github.com, then:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-research-agent.git
git push -u origin main
```

### Step 2: Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub Repo"**
4. Find and select your `ai-research-agent` repo
5. Railway auto-detects Node.js and starts deploying

### Step 3: Add Your API Key

1. In your Railway project, click on the service
2. Go to the **"Variables"** tab
3. Add these environment variables:

```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
RESEARCH_MODEL=claude-sonnet-4-5-20250929
SYNTHESIS_MODEL=claude-opus-4-6
```

4. Railway will automatically redeploy with the new variables

### Step 4: Get Your URL

1. Go to **"Settings"** tab in your Railway service
2. Under **"Networking"**, click **"Generate Domain"**
3. You'll get a URL like: `ai-research-agent-production.up.railway.app`

### Step 5: Test It

```bash
# Health check
curl https://YOUR-APP.up.railway.app/

# Run the agent
curl -X POST https://YOUR-APP.up.railway.app/api/agent \
  -H "Content-Type: application/json" \
  -d '{"message": "Research the top 5 AI companies in 2025 and create a presentation"}'

# Generate a PPT directly
curl -X POST https://YOUR-APP.up.railway.app/api/generate-pptx \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Deck", "slides": [{"title": "Hello", "bullets": ["This is a real .pptx file"]}]}'

# Download the generated file
curl https://YOUR-APP.up.railway.app/files/presentation-abc123.pptx -o my-deck.pptx
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check and endpoint list |
| `/api/agent` | POST | Run full agent loop (SSE stream) |
| `/api/generate-pptx` | POST | Generate .pptx file directly |
| `/api/generate-xlsx` | POST | Generate .xlsx file directly |
| `/files/:name` | GET | Download a generated file |

### POST /api/agent

Send a natural language command. The agent searches the web, creates documents, and streams progress.

```json
{
  "message": "Research renewable energy trends and create a spreadsheet comparing countries"
}
```

Response: Server-Sent Events stream with steps, artifacts (download URLs), and final text.

### POST /api/generate-pptx

Generate a PowerPoint file directly from structured data.

```json
{
  "title": "Q3 Report",
  "subtitle": "Key Findings",
  "theme_color": "1E2761",
  "slides": [
    {
      "title": "Revenue Growth",
      "bullets": [
        "Total revenue: $4.2B, up 23% YoY",
        "Cloud segment grew 45% to $1.8B",
        "Enterprise contracts: 340 new deals signed"
      ]
    }
  ]
}
```

### POST /api/generate-xlsx

Generate an Excel file directly from structured data.

```json
{
  "title": "Market Data",
  "sheets": [
    {
      "name": "Companies",
      "headers": ["Company", "Revenue ($B)", "Growth (%)"],
      "rows": [
        ["OpenAI", 3.4, 200],
        ["Anthropic", 0.9, 300],
        ["Google DeepMind", 0, 0]
      ],
      "formulas": [
        { "cell": "B5", "formula": "=SUM(B2:B4)" },
        { "cell": "C5", "formula": "=AVERAGE(C2:C4)" }
      ]
    }
  ]
}
```

## Architecture

```
Browser / curl / any client
       │
       ▼ HTTP
┌─────────────────────────────────────────┐
│  Express Server (Railway)               │
│  ├── /api/agent → agent-loop.js         │
│  │   ├── Claude API (Sonnet → Opus)     │
│  │   ├── Web Search (server-side)       │
│  │   └── Custom tool execution          │
│  ├── tool-executors.js                  │
│  │   ├── pptx-generator.js → real .pptx │
│  │   ├── xlsx-generator.js → real .xlsx │
│  │   └── writes .md reports             │
│  └── /files/ → serves downloads         │
└─────────────────────────────────────────┘
```

## Connect the Frontend Agent

To connect the browser-based agent (agent-v4.jsx) to this backend, change the API URL:

```javascript
// In agent-v4.jsx, replace:
const API_URL = "https://api.anthropic.com/v1/messages";

// With your Railway URL:
const BACKEND_URL = "https://YOUR-APP.up.railway.app";
```

Then update the `go()` function to call your backend instead of the Claude API directly. The backend handles the API key, tool execution, and file generation securely.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Your Claude API key |
| `RESEARCH_MODEL` | No | `claude-sonnet-4-5-20250929` | Model for research phase |
| `SYNTHESIS_MODEL` | No | `claude-opus-4-6` | Model for synthesis phase |
| `PORT` | No | `3001` | Server port (Railway sets this automatically) |
