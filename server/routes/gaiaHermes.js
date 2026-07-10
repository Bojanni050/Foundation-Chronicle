const express = require("express");
const { getGaiaHermesConfig } = require("../gaia-backend/gaiaHermesManager");
const {
  getGaiaHermesSkillSettings,
  setGaiaHermesSkillSettings,
  getEnabledGaiaHermesSkills,
} = require("../gaia-backend/gaiaHermesSkills");

const router = express.Router();

router.get("/gaia-hermes-skills", (_req, res) => {
  res.json({ skills: getGaiaHermesSkillSettings() });
});

router.patch("/gaia-hermes-skills", (req, res) => {
  try {
    const skills = setGaiaHermesSkillSettings(req.body?.enabled || {});
    res.json({ skills });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not save Gaia Hermes skills." });
  }
});

router.post("/gaia-hermes/chat/completions", async (req, res) => {
  const { url, key } = getGaiaHermesConfig();
  if (!url || !key) {
    return res.status(503).json({ error: "Gaia's Hermes-backend is not configured yet." });
  }

  const enabledSkills = getEnabledGaiaHermesSkills();
  const skillPolicy = enabledSkills.length
    ? [
        "CHRONICLE SKILL POLICY:",
        `Only these Hermes skills are enabled for this agent: ${enabledSkills.map((skill) => skill.name).join(", ")}.`,
        "Never call skill_view for any other name. Do not call skills_list to discover additional skills.",
        "If an enabled skill cannot be loaded, treat that as recoverable and continue the chat without repeating the same tool call.",
      ].join("\n")
    : [
        "CHRONICLE SKILL POLICY:",
        "No Hermes skills are enabled for this agent.",
        "Do not call skills_list or skill_view. Continue normally without skills.",
      ].join("\n");

  const body = { ...req.body };
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  const systemIndex = messages.findIndex((message) => message?.role === "system");
  if (systemIndex >= 0) {
    messages[systemIndex] = {
      ...messages[systemIndex],
      content: `${messages[systemIndex].content || ""}\n\n${skillPolicy}`,
    };
  } else {
    messages.unshift({ role: "system", content: skillPolicy });
  }
  body.messages = messages;

  try {
    const target = `${url.replace(/\/+$/, "")}/chat/completions`;
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Gaia's Hermes-backend is unreachable.", detail: err.message });
  }
});

module.exports = router;
