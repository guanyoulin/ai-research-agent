// ═══════════════════════════════════════════════════════
// SKILLS MANAGER — Modular skill loading for the agent
//
// This module handles two types of skills:
//
// 1. ANTHROPIC PRE-BUILT SKILLS (pptx, xlsx, docx, pdf)
//    → Run in Anthropic's code execution VM
//    → Added via container.skills in the API call
//    → Generate real files returned via Files API
//
// 2. CUSTOM SKILLS (uploaded via /v1/skills endpoint)
//    → Your own SKILL.md instruction folders
//    → Uploaded once, referenced by skill_id
//    → Also run in the code execution VM
//
// USAGE:
//   const { getSkillsConfig, uploadSkill, listSkills } = require("./skills-manager");
//
//   // In your API call, merge skills config:
//   const body = {
//     ...getSkillsConfig(),  // adds container, tools, headers
//     model, messages, system,
//   };
//
// This is fully modular — enable/disable skills without
// touching agent-loop.js or tool-executors.js.
// ═══════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const API_URL = "https://api.anthropic.com/v1";
const API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── Which skills to enable ───
// Set these in Railway environment variables:
//   ENABLE_SKILLS=pptx,xlsx,docx,pdf
//   CUSTOM_SKILL_IDS=skill_01abc,skill_02def
//
// Or leave empty to use no skills (agent works fine without them)

function getEnabledAnthropicSkills() {
  const env = process.env.ENABLE_SKILLS || "";
  if (!env.trim()) return [];
  return env.split(",").map(s => s.trim()).filter(Boolean);
}

function getCustomSkillIds() {
  const env = process.env.CUSTOM_SKILL_IDS || "";
  if (!env.trim()) return [];
  return env.split(",").map(s => s.trim()).filter(Boolean);
}

// ─── Build the skills config for API calls ───
// Returns { container, tools, betas } to merge into your API request
function getSkillsConfig() {
  const anthropicSkills = getEnabledAnthropicSkills();
  const customSkillIds = getCustomSkillIds();

  // No skills enabled — return empty (agent uses its own tools)
  if (!anthropicSkills.length && !customSkillIds.length) {
    return { container: null, skillTools: [], betas: [] };
  }

  const skills = [];

  // Add Anthropic pre-built skills
  for (const skillId of anthropicSkills) {
    skills.push({
      type: "anthropic",
      skill_id: skillId,
      version: "latest",
    });
  }

  // Add custom uploaded skills
  for (const skillId of customSkillIds) {
    skills.push({
      type: "custom",
      skill_id: skillId,
      version: "latest",
    });
  }

  return {
    container: { skills },
    // Skills require the code_execution tool
    skillTools: [
      { type: "code_execution_20250825", name: "code_execution" },
    ],
    // Required beta headers
    betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  };
}

// ─── Upload a custom skill to Anthropic ───
// skillDir should contain a SKILL.md file
// Returns the skill_id to use in future API calls
async function uploadSkill(skillDir, displayTitle) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`SKILL.md not found in ${skillDir}`);
  }

  // Read all files in the skill directory
  const files = [];
  const dirName = path.basename(skillDir);

  function readDir(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        const filePath = path.join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        files.push({
          path: `${dirName}/${relativePath}`,
          content: fs.readFileSync(filePath),
        });
      } else if (entry.isDirectory()) {
        readDir(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  }
  readDir(skillDir, "");

  // Upload via multipart form
  const FormData = (await import("node-fetch")).default ? require("form-data") : globalThis.FormData;
  const formData = new FormData();
  if (displayTitle) formData.append("display_title", displayTitle);

  for (const file of files) {
    formData.append("files[]", file.content, { filename: file.path });
  }

  const res = await fetch(`${API_URL}/skills?beta=true`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "skills-2025-10-02",
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  console.log(`Skill uploaded: ${data.id} (${data.display_title})`);
  return data;
}

// ─── List all available skills ───
async function listSkills(source) {
  const params = source ? `?source=${source}&beta=true` : "?beta=true";
  const res = await fetch(`${API_URL}/skills${params}`, {
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "skills-2025-10-02",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── Delete a custom skill ───
async function deleteSkill(skillId) {
  const res = await fetch(`${API_URL}/skills/${skillId}?beta=true`, {
    method: "DELETE",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "skills-2025-10-02",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return { deleted: true, skill_id: skillId };
}

// ─── Download files generated by skills ───
// Skills create files in the code execution container
// They're returned as file_id references in the API response
async function downloadSkillFile(fileId, outputPath) {
  const res = await fetch(`${API_URL}/files/${fileId}/content`, {
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
  });

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = {
  getSkillsConfig,
  getEnabledAnthropicSkills,
  getCustomSkillIds,
  uploadSkill,
  listSkills,
  deleteSkill,
  downloadSkillFile,
};
