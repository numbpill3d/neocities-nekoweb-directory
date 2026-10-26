"use strict";

const CATEGORIES = ["personal","blog","portfolio","art","tools","games","zine","resources","other"];

function field(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body || "").match(new RegExp(`(?:^|\\n)### ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`));
  const value = match ? match[1].trim() : "";
  return value === "_No response_" ? "" : value;
}

function parseSubmission(body) {
  const tagsRaw = field(body, "Tags");
  return {
    name: field(body, "Site name"),
    url: field(body, "Site URL"),
    description: field(body, "Description"),
    category: field(body, "Category"),
    tags: tagsRaw.split(",").map(t => t.trim()).filter(Boolean),
    platform: field(body, "Platform"),
    confirmed: /- \[[xX]\]\s+This is a real/.test(field(body, "Confirm")),
  };
}

function labelNames(issue) { return (issue.labels || []).map(l => typeof l === "string" ? l : l.name); }

function isSubmissionIssue(issue) {
  if (labelNames(issue).includes("site-submission")) return true;
  const body = String(issue.body || "");
  return /^\[Site\]\s+/i.test(String(issue.title || "")) &&
    body.includes("### Site name") && body.includes("### Site URL") && body.includes("### Description");
}

function normalizeUrl(u) { return String(u || "").trim().replace(/\/+$/, "").toLowerCase(); }

function validate(s) {
  const errors = [];
  if (!s.name) errors.push("Site name is required.");
  else if (s.name.length > 100) errors.push("Site name must be 100 characters or fewer.");
  if (!s.url) errors.push("Site URL is required.");
  else {
    try { const u = new URL(s.url); if (u.protocol !== "https:") errors.push("Site URL must be https."); }
    catch { errors.push("Site URL must be a valid URL."); }
  }
  if (!s.description) errors.push("Description is required.");
  else if (s.description.length > 2000) errors.push("Description must be 2,000 characters or fewer.");
  if (!s.category) errors.push("Category is required.");
  else if (!CATEGORIES.includes(s.category)) errors.push(`Category must be one of: ${CATEGORIES.join(", ")}.`);
  if (!s.tags.length) errors.push("At least one tag is required.");
  else if (s.tags.length > 20) errors.push("No more than 20 tags.");
  if (!s.confirmed) errors.push("The confirmation checkbox must be checked.");
  return errors;
}

function statusMarker(n) { return `<!-- retro-site-submission-status:${n} -->`; }

async function setStatus(github, repo, issueNumber, body) {
  const marker = statusMarker(issueNumber);
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: issueNumber, per_page: 100 });
  const prior = comments.find(c => c.user?.type === "Bot" && String(c.body||"").includes(marker));
  const complete = `${marker}\n${body}`;
  if (prior) await github.rest.issues.updateComment({ ...repo, comment_id: prior.id, body: complete });
  else await github.rest.issues.createComment({ ...repo, issue_number: issueNumber, body: complete });
}

async function readJson(github, repo, path, ref, fallback) {
  try {
    const r = await github.rest.repos.getContent({ ...repo, path, ref });
    if (Array.isArray(r.data) || r.data.type !== "file") throw new Error(`${path} is not a file`);
    return { value: JSON.parse(Buffer.from(r.data.content, "base64").toString()), sha: r.data.sha };
  } catch (e) {
    if (e.status === 404 && fallback !== undefined) return { value: fallback, sha: null };
    throw e;
  }
}

async function ensureLabel(github, repo, name, color, desc) {
  try { await github.rest.issues.getLabel({ ...repo, name }); }
  catch (e) {
    if (e.status !== 404) throw e;
    try { await github.rest.issues.createLabel({ ...repo, name, color, description: desc }); }
    catch (ce) { if (ce.status !== 422) throw ce; }
  }
}

async function run({ github, context, core }) {
  const issue = context.payload.issue;
  if (!issue || !isSubmissionIssue(issue)) { core.info("Not a site submission; nothing to do."); return; }
  const repo = context.repo;
  const issueNumber = issue.number;
  const base = context.payload.repository?.default_branch || "main";
  const branch = `submission/issue-${issueNumber}`;

  await ensureLabel(github, repo, "site-submission", "0e8a16", "community site submission");
  if (!labelNames(issue).includes("site-submission")) {
    await github.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels: ["site-submission"] });
  }

  const submission = parseSubmission(issue.body);
  const errors = validate(submission);
  const reject = async (msgs) => {
    await ensureLabel(github, repo, "invalid", "d93f0b", "submission rejected");
    await github.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels: ["invalid"] }).catch(()=>{});
    await setStatus(github, repo, issueNumber, `❌ Submission needs changes:\n\n${msgs.map(m=>"- "+m).join("\n")}\n\nEdit the issue to re-run validation.`);
  };
  if (errors.length) { await reject(errors); return; }

  const [sitesRes, suppRes] = await Promise.all([
    readJson(github, repo, "data/sites.json", base, { sites: [] }),
    readJson(github, repo, "data/supplemental_sites.json", base, []),
  ]);
  const all = [...(sitesRes.value.sites || []), ...(Array.isArray(suppRes.value) ? suppRes.value : [])];
  const dup = all.find(s => normalizeUrl(s.url) === normalizeUrl(submission.url));
  if (dup) { await reject([`\`${submission.url}\` is already in the directory.`]); return; }

  if (labelNames(issue).includes("invalid")) {
    await github.rest.issues.removeLabel({ ...repo, issue_number: issueNumber, name: "invalid" }).catch(e => { if (e.status !== 404) throw e; });
  }

  const entry = {
    name: submission.name,
    url: submission.url,
    description: submission.description,
    category: submission.category,
    tags: submission.tags,
    source: "supplemental",
  };

  // ensure branch exists
  let branchSha = null;
  try {
    const ref = await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` });
    branchSha = ref.data.object.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  if (!branchSha) {
    const baseRef = await github.rest.git.getRef({ ...repo, ref: `heads/${base}` });
    await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: baseRef.data.object.sha });
  }

  // read current supplemental on branch
  const current = await readJson(github, repo, "data/supplemental_sites.json", branch, []);
  const list = Array.isArray(current.value) ? current.value : [];
  // remove any previous entry from this issue? keep simple: append if not present
  if (!list.find(s => normalizeUrl(s.url) === normalizeUrl(submission.url))) {
    list.push(entry);
  }
  const content = Buffer.from(JSON.stringify(list, null, 2) + "\n").toString("base64");
  await github.rest.repos.createOrUpdateFileContents({
    ...repo,
    path: "data/supplemental_sites.json",
    message: `feat: add site submission #${issueNumber}`,
    content,
    branch,
    sha: current.sha || undefined,
  });

  // create or update PR
  const pulls = await github.paginate(github.rest.pulls.list, { ...repo, state: "open", base, per_page: 100 });
  const existingPr = pulls.find(p => p.head.ref === branch);
  if (existingPr) {
    await setStatus(github, repo, issueNumber, `✅ Submission updated. PR: #${existingPr.number}`);
  } else {
    const pr = await github.rest.pulls.create({
      ...repo,
      title: `[Site] ${submission.name}`,
      head: branch,
      base,
      body: `Closes #${issueNumber}\n\nSubmitted via issue form.`,
    });
    await setStatus(github, repo, issueNumber, `✅ Submission accepted. PR opened: #${pr.data.number}\n\nA maintainer will review and merge.`);
  }
}

module.exports = { run };
