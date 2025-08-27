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

// --- Who am I (debug)
app.get("/whoami", checkKey, async (_req, res) => {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    res.json({ login: data.login, id: data.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Create GitHub issue
app.post("/create-issue", checkKey, async (req, res) => {
  try {
    const { owner, repo, title, body, assignees } = req.body;
    if (!owner || !repo || !title)
      return res.status(400).json({ error: "owner, repo, title are required" });
    const { data } = await octokit.rest.issues.create({ owner, repo, title, body, assignees });
    res.json({ url: data.html_url, number: data.number });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Comment on PR (issues.createComment uses PR number as issue_number)
app.post("/comment-pr", checkKey, async (req, res) => {
  try {
    const { owner, repo, pull_number, body } = req.body;
    if (!owner || !repo || !pull_number || !body)
      return res.status(400).json({ error: "owner, repo, pull_number, body are required" });
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body
    });
    res.json({ url: data.html_url, id: data.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Add labels to issue/PR
app.post("/label-issue", checkKey, async (req, res) => {
  try {
    const { owner, repo, issue_number, labels } = req.body;
    if (!owner || !repo || !issue_number || !labels)
      return res.status(400).json({ error: "owner, repo, issue_number, labels are required" });
    const { data } = await octokit.rest.issues.addLabels({ owner, repo, issue_number, labels });
    res.json({ labels: data.map((l) => l.name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Open PR from a branch
app.post("/open-pr", checkKey, async (req, res) => {
  try {
    const { owner, repo, title, body, head, base = "main", draft = false } = req.body;
    if (!owner || !repo || !title || !head)
      return res.status(400).json({ error: "owner, repo, title, head are required" });
    const { data } = await octokit.rest.pulls.create({ owner, repo, title, body, head, base, draft });
    res.json({ url: data.html_url, number: data.number });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Create a branch from another branch (default main)
app.post("/create-branch", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch, from = "main" } = req.body;
    if (!owner || !repo || !branch)
      return res.status(400).json({ error: "owner, repo, branch required" });
    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${from}` });
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: ref.object.sha
    });
    res.json({ ok: true, branch, from });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Create or update a single file on a branch (works on 'main' too)
app.post("/upsert-file", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch, path, message, content } = req.body;
    if (!owner || !repo || !branch || !path || !message || !content) {
      return res
        .status(400)
        .json({ error: "owner, repo, branch, path, message, content required" });
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
      owner,
      repo,
      path,
      message,
      content: contentB64,
      branch,
      sha
    });
    res.json({ url: data.content.html_url, sha: data.content.sha, commit: data.commit.sha });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- List repo tree (optionally under subfolder)
app.post("/list-tree", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch = "main", path = "", recursive = true } = req.body;
    if (!owner || !repo) return res.status(400).json({ error: "owner, repo required" });

    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const { data: commit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: ref.object.sha
    });
    const { data: tree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: commit.tree.sha,
      recursive: recursive ? "true" : undefined
    });

    const prefix = path ? (path.endsWith("/") ? path : path + "/") : "";
    const files = tree.tree
      .filter((t) => t.type === "blob" && (!prefix || t.path.startsWith(prefix)))
      .map((t) => ({ path: t.path, size: t.size, sha: t.sha }));

    res.json({ branch, count: files.length, files });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Get a single file (decoded UTF-8)
app.post("/get-file", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch = "main", path } = req.body;
    if (!owner || !repo || !path)
      return res.status(400).json({ error: "owner, repo, path required" });
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(data)) return res.status(400).json({ error: "Path is a directory, not a file" });
    const content = Buffer.from(data.content, data.encoding).toString("utf8");
    res.json({ path: data.path, sha: data.sha, size: data.size, content });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Bulk upsert (multiple files, single commit on a branch)
app.post("/bulk-upsert", checkKey, async (req, res) => {
  try {
    const { owner, repo, branch, message, files } = req.body;
    // files: [{ path, content }]
    if (!owner || !repo || !branch || !message || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "owner, repo, branch, message, files[] required" });
    }

    // 1) Current commit on branch
    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: ref.object.sha
    });

    // 2) Create blobs
    const blobs = await Promise.all(
      files.map(async (f) => {
        const { data } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: f.content,
          encoding: "utf-8"
        });
        return { path: f.path, sha: data.sha, mode: "100644", type: "blob" };
      })
    );

    // 3) Create a tree based on base tree
    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: blobs
    });

    // 4) Create a commit
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [baseCommit.sha]
    });

    // 5) Update the ref
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
      force: false
    });

    res.json({ commit: newCommit.sha, files: files.map((f) => f.path) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK on :${PORT}`));
