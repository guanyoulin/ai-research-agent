const path = require("path");
const fs = require("fs");
const { v4: uuid } = require("uuid");
const { generatePPTX } = require("./file-generators/pptx-generator");
const { generateXLSX } = require("./file-generators/xlsx-generator");

const OUTPUT_DIR = path.join(__dirname, "..", "output");

function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

async function executeTool(name, input) {
  try {
    switch (name) {
      case "create_presentation": {
        const filename = `presentation-${uuid().slice(0, 8)}.pptx`;
        const filepath = path.join(OUTPUT_DIR, filename);
        await generatePPTX(input, filepath);
        return {
          success: true, type: "ppt",
          message: `Created ${input.title || "Presentation"} (${toArr(input.slides).length + 1} slides)`,
          file: { name: filename, url: `/files/${filename}` },
        };
      }
      case "create_spreadsheet": {
        const filename = `spreadsheet-${uuid().slice(0, 8)}.xlsx`;
        const filepath = path.join(OUTPUT_DIR, filename);
        await generateXLSX(input, filepath);
        return {
          success: true, type: "xlsx",
          message: `Created ${input.title || "Spreadsheet"} (${toArr(input.sheets).length} sheets)`,
          file: { name: filename, url: `/files/${filename}` },
        };
      }
      case "create_report": {
        const sections = toArr(input.sections);
        let md = `# ${input.title || "Report"}\n*Generated ${new Date().toISOString().slice(0, 10)}*\n\n---\n\n`;
        sections.forEach(s => {
          if (s && typeof s === "object") md += `## ${s.heading || "Section"}\n\n${s.content || ""}\n\n`;
        });
        const filename = `report-${uuid().slice(0, 8)}.md`;
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), md, "utf-8");
        return {
          success: true, type: "report",
          message: `Created ${input.title || "Report"} (${sections.length} sections)`,
          file: { name: filename, url: `/files/${filename}` },
        };
      }
      case "create_chart": {
        // Export chart data as JSON (could add chartjs-node-canvas for PNG rendering)
        const filename = `chart-${uuid().slice(0, 8)}.json`;
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(input, null, 2), "utf-8");
        return {
          success: true, type: "chart",
          message: `Created chart: ${input.title || "Chart"}`,
          file: { name: filename, url: `/files/${filename}` },
        };
      }
      case "send_email": {
        // Placeholder — in production, use Gmail MCP server
        return {
          success: true, type: "email",
          message: `Email drafted to ${input.to}: "${input.subject}"`,
          file: null,
        };
      }
      default:
        return { success: false, message: `Unknown tool: ${name}`, file: null };
    }
  } catch (err) {
    return { success: false, message: `Tool error: ${err.message}`, file: null };
  }
}

module.exports = { executeTool };
