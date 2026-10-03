/**
 * github.js — poller for GITHUB_ORG repos (ETag caching, ARCHITECTURE.md §3.3).
 * Emits git_push events when pushed_at changes on a watched repo.
 */
import { config } from "./config.js";

const API = "https://api.github.com";

export function createGithubPoller(ingest) {
  let timer = null;
  let running = false;
  // state per repo full_name: { pushedAt, etag }
  const repoState = new Map();
  let orgEtag = null;

  async function gh(path, etag) {
    const headers = {
      "User-Agent": "hermes-office-poller",
      Accept: "application/vnd.github+json",
    };
    if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
    if (etag) headers["If-None-Match"] = etag;
    const resp = await fetch(`${API}${path}`, { headers });
    if (resp.status === 304) return { notModified: true };
    if (!resp.ok) throw new Error(`github ${resp.status} on ${path}`);
    return { data: await resp.json(), etag: resp.headers.get("etag") };
  }

  async function poll() {
    if (running) return;
    running = true;
    try {
      const org = await gh(
        `/orgs/${config.githubOrg}/repos?sort=pushed&per_page=100`,
        orgEtag
      );
      if (org.notModified) return;
      orgEtag = org.etag;

      for (const repo of org.data || []) {
        const prev = repoState.get(repo.full_name);
        if (prev && prev.pushedAt !== repo.pushed_at) {
          // New push(es) — fetch recent commits since last poll
          let author = null;
          let commits = 1;
          try {
            const cl = await gh(
              `/repos/${repo.full_name}/commits?since=${encodeURIComponent(prev.pushedAt)}&per_page=50`
            );
            if (!cl.notModified && Array.isArray(cl.data) && cl.data.length) {
              commits = cl.data.length;
              author = cl.data[0]?.commit?.author?.name || null;
            }
          } catch {}
          ingest({
            type: "git_push",
            repo: repo.name,
            privat: !!repo.private,
            author: author || repo.owner?.login || "unknown",
            commits,
            message: (repo.default_branch ? `push to ${repo.default_branch}` : "").slice(0, 500),
            url: repo.html_url,
            source: "github",
          });
        }
        repoState.set(repo.full_name, { pushedAt: repo.pushed_at });
      }
    } catch (err) {
      // Rate limit / network error — log quietly, retry next interval
      console.error("[github] poll failed:", err.message);
    } finally {
      running = false;
    }
  }

  return {
    start(intervalMs = 60_000) {
      if (timer) return;
      poll(); // initial
      timer = setInterval(poll, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    poll,
  };
}
