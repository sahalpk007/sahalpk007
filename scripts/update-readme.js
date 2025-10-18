const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const README = path.join(__dirname, "..", "README.md");
const START = "<!-- START_GITHUB_STATS -->";
const END = "<!-- END_GITHUB_STATS -->";

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: token
      ? {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        }
      : { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok)
    throw new Error(`Failed ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  const repoEnv = process.env.REPO || process.env.GITHUB_REPOSITORY || "";
  const username = repoEnv.split("/")[0] || "sahalpk007";

  // Fetch user
  const user = await fetchJson(
    `https://api.github.com/users/${username}`,
    token
  );

  // If we have a token, fetch the authenticated user to detect whether the token
  // belongs to the same username. If so, we can safely call /user/repos to include
  // private repositories (visibility=all). If not, fall back to public listing.
  let authedLogin = null;
  if (token) {
    try {
      const authed = await fetchJson(`https://api.github.com/user`, token);
      authedLogin = authed.login;
    } catch (e) {
      // ignore — proceed without authed login
      authedLogin = null;
    }
  }

  // Fetch repos to count stars and commits. If the token belongs to the same
  // user, use /user/repos?visibility=all to include private repos. Otherwise
  // fall back to /users/:username/repos which only returns public repos.
  let page = 1;
  const per_page = 100;
  let repos = [];
  const useUserRepos =
    authedLogin && authedLogin.toLowerCase() === username.toLowerCase();
  while (true) {
    const url = useUserRepos
      ? `https://api.github.com/user/repos?visibility=all&per_page=${per_page}&page=${page}`
      : `https://api.github.com/users/${username}/repos?per_page=${per_page}&page=${page}`;
    const batch = await fetchJson(url, token);
    repos = repos.concat(batch);
    if (batch.length < per_page) break;
    page++;
  }

  // Total stars across repos
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);

  // Count public repos
  const publicRepos = user.public_repos || repos.length;

  // Followers
  const followers = user.followers || 0;

  // Following
  const following = user.following || 0;

  // Contributions last year: use events or the GraphQL API — fallback to 0 if not available
  let contributions = "N/A";
  try {
    // Use GraphQL API to fetch contributionsCollection
    const gql = JSON.stringify({
      query: `query($login:String!){ user(login:$login){ contributionsCollection { contributionCalendar { totalContributions } } } }`,
      variables: { login: username },
    });
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: token ? `bearer ${token}` : "",
        "Content-Type": "application/json",
      },
      body: gql,
    });
    if (res.ok) {
      const data = await res.json();
      contributions =
        data.data.user.contributionsCollection.contributionCalendar
          .totalContributions || "0";
    }
  } catch (e) {
    contributions = "N/A";
  }

  // Commits total: fetch via Search API (may be approximate and limited). We'll search for commits authored by user across all repos.
  let totalCommits = "N/A";
  try {
    // The Search API for commits requires the preview media type
    const searchUrl = `https://api.github.com/search/commits?q=author:${username}&per_page=1`;
    const res = await fetch(searchUrl, {
      headers: token
        ? {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.cloak-preview",
          }
        : { Accept: "application/vnd.github.cloak-preview" },
    });
    if (res.ok) {
      const data = await res.json();
      totalCommits = data.total_count || "0";
    }
  } catch (e) {
    totalCommits = "N/A";
  }

  // Build an HTML table (centered) so it aligns visually with the widget images above.
  const html = [];
  html.push('<table align="center">');
  html.push("  <thead>");
  html.push(
    '    <tr><th style="padding:6px 12px; text-align:left">Metric</th><th style="padding:6px 12px; text-align:right">Value</th></tr>'
  );
  html.push("  </thead>");
  html.push("  <tbody>");
  html.push(
    `    <tr><td style="padding:6px 12px">Commits (total)</td><td style="padding:6px 12px; text-align:right">${totalCommits}</td></tr>`
  );
  html.push(
    `    <tr><td style="padding:6px 12px">Contributions (last year)</td><td style="padding:6px 12px; text-align:right">${contributions}</td></tr>`
  );
  html.push(
    `    <tr><td style="padding:6px 12px">Public repos</td><td style="padding:6px 12px; text-align:right">${publicRepos}</td></tr>`
  );
  html.push(
    `    <tr><td style="padding:6px 12px">Stars (received)</td><td style="padding:6px 12px; text-align:right">${totalStars}</td></tr>`
  );
  html.push(
    `    <tr><td style="padding:6px 12px">Followers</td><td style="padding:6px 12px; text-align:right">${followers}</td></tr>`
  );
  html.push(
    `    <tr><td style="padding:6px 12px">Following</td><td style="padding:6px 12px; text-align:right">${following}</td></tr>`
  );
  html.push("  </tbody>");
  html.push("</table>");

  const content = fs.readFileSync(README, "utf8");
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    console.error("Markers not found in README.md");
    process.exit(1);
  }

  const before = content.slice(0, startIdx + START.length);
  const after = content.slice(endIdx);
  const newBlock =
    "\n<!-- The contents between these markers are updated automatically -->\n\n" +
    html.join("\n") +
    "\n\n";
  const newContent = before + newBlock + after;
  fs.writeFileSync(README, newContent, "utf8");
  console.log("README.md updated with latest GitHub stats");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
