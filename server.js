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

// Accept x-api-key or Authorization: Bearer <key>
function checkKey(req, res, next) {
  const candidate =
    req.get("x-api-key") ||
    req.get("api-key") ||
    req.get("x-api_key") ||
    req.get("apikey") ||
    req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!candidate || candidate !== process.env.ACTIONS_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// --- Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// --- Issues/PRs you already had
app.post("/create-issue", checkKey, async (req, res) => {
  try {
    const { owner, repo, title, body, assignees } = req.body;
    if (!owner || !repo || !title) return res.status(400).json({ error: "owner, repo, title are required" });
    const { data } = await octokit.rest.issues.create({ owner, repo, title, body, assignees });
    res.json({ url: data.html_url, number: data.number });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/comment-pr", checkKey, async (req, res) => {
  try {
    const { owner, repo, pull_number, body } = req.body;
    if (!owner || !repo || !pull_number || !body) return res.status(400).json({ error: "owner, repo, pull_number, body are required" });
    const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: pull_number, body });
    res.json({ url: data.html_url, id: data.id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/label-issue", checkKey, async (req, res) => {
  try {
    const { owner, repo, issue_number, labels } = req.body;
    if (!owner || !repo || !issue_number || !labels) return res.status(400).json({ error: "owner, repo, issue_number, labels are required" });
    const { data } = await octokit.rest.issues.addLabels({ owner, repo, issue_number, labels });
    res.json({ labels: data.map(l => l.name) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/open-pr", checkKey, async (req, res) => {
  try {
    const { owner, repo, title, body, head, base = "main", draft = false } = req.body;
    if (!owner || !repo || !title || !head) return res.status(400).json({ error: "owner, repo, title, head are required" });
    const { data } = await octokit.rest.pulls.create({ owner, repo, title, body, head, base, draft });
    res.json({ url: data.html_url, number: data.number });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- NEW: create a branch from another branch (default main)
app.post("/create-branch", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch, from = "main" } = req.body;
    if (!owner || !repo || !branch) return res.status(400).json({ error: "owner, repo, branch required" });
    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${from}` });
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: ref.object.sha });
    res.json({ ok: true, branch, from });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- NEW: create or update a file on a branch (works on 'main' too)
app.post("/upsert-file", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch, path, message, content } = req.body;
    if (!owner || !repo || !branch || !path || !message || !content) {
      return res.status(400).json({ error: "owner, repo, branch, path, message, content required" });
    }

    // Is there an existing file? Grab its SHA if so.
    let sha;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
      if (!Array.isArray(data)) sha = data.sha;
    } catch (err) {
      if (err.status !== 404) throw err; // 404 means "new file" — fine
    }

    const contentB64 = Buffer.from(content, "utf8").toString("base64");
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner, repo, path, message, content: contentB64, branch, sha
    });
    res.json({ url: data.content.html_url, sha: data.content.sha, commit: data.commit.sha });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK on :${PORT}`));
