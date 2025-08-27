import express from "express";
import cors from "cors";
import { Octokit } from "octokit";

const app = express();
app.use(cors());
app.use(express.json());

// --- Env checks ---
if (!process.env.GH_TOKEN) console.error("Missing GH_TOKEN");
if (!process.env.ACTIONS_API_KEY) console.error("Missing ACTIONS_API_KEY");

const octokit = new Octokit({ auth: process.env.GH_TOKEN });

// API-key gate: only callers with your secret key can use actions
function checkKey(req, res, next) {
  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = req.get("x-api-key") || bearer;
  if (!key || key !== process.env.ACTIONS_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Create issue
app.post("/create-issue", checkKey, async (req, res) => {
  try {
    const { owner, repo, title, body, assignees } = req.body;
    if (!owner || !repo || !title) {
      return res.status(400).json({ error: "owner, repo, title are required" });
    }
    const { data } = await octokit.rest.issues.create({ owner, repo, title, body, assignees });
    res.json({ url: data.html_url, number: data.number });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Comment on PR
app.post("/comment-pr", checkKey, async (req, res) => {
  try {
    const { owner, repo, pull_number, body } = req.body;
    if (!owner || !repo || !pull_number || !body) {
      return res.status(400).json({ error: "owner, repo, pull_number, body are required" });
    }
    const { data } = await octokit.rest.issues.createComment({
      owner, repo, issue_number: pull_number, body
    });
    res.json({ url: data.html_url, id: data.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Add labels
app.post("/label-issue", checkKey, async (req, res) => {
  try {
    const { owner, repo, issue_number, labels } = req.body;
    if (!owner || !repo || !issue_number || !labels) {
      return res.status(400).json({ error: "owner, repo, issue_number, labels are required" });
    }
    const { data } = await octokit.rest.issues.addLabels({ owner, repo, issue_number, labels });
    res.json({ labels: data.map(l => l.name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Open PR
app.post("/open-pr", checkKey, async (req, res) => {
  try {
    const { owner, repo, title, body, head, base = "main", draft = false } = req.body;
    if (!owner || !repo || !title || !head) {
      return res.status(400).json({ error: "owner, repo, title, head are required" });
    }
    const { data } = await octokit.rest.pulls.create({ owner, repo, title, body, head, base, draft });
    res.json({ url: data.html_url, number: data.number });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK on :${PORT}`));
