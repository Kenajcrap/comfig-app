import { parse } from "vdf-parser";

import { JSDOM } from 'jsdom';

let hudDb = null;

const ghApi = async (path) => {
  let headers = {
    "User-Agent": "comfig app",
    Accept: "application/vnd.github.v3+json",
  };

  if (import.meta.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${import.meta.env.GITHUB_TOKEN}`
  }

  const resp = await fetch(`https://api.github.com/${path}`, {
    headers,
  });
  return await resp.json();
}

const hudApi = async (path) => {
  return await ghApi(`repos/mastercomfig/hud-db/${path}`);
}

const getHudDb = async () => {
  if (!hudDb) {
    hudDb = await hudApi("git/trees/main?recursive=1");
  }

  return hudDb;
};

const getHudResource = (id, name) => {
  if (name.startsWith("https://youtu.be/")) {
    return name.replace("https://youtu.be", "https://youtube.com/embed");
  }
  if (name.startsWith("https://")) {
    return name;
  }
  return `https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-resources/${id}/${name}.webp`
}

let hudMap = null;

// TODO: Sync with tf_ui_version
const CURRENT_HUD_VERSION = 3;

const getHuds = async () => {
  if (!hudMap) {
    const db = await getHudDb();
    // Filter to only hud-data JSON files
    const huds = db.tree.filter((item) => item.path.startsWith("hud-data/"));
    const hudEntries = await Promise.all(huds.map(async (hud) => {
      // Fetch and parse JSON from db
      const data = await fetch(`https://raw.githubusercontent.com/mastercomfig/hud-db/main/${hud.path}`);
      const hudData = JSON.parse(await data.text());

      // Get HUD ID from json basename
      const hudId = hud.path.split("/")[1].split(".")[0];
      hudData.id = hudId;

      // Query markdown
      const markdownData = await fetch(`https://raw.githubusercontent.com/mastercomfig/hud-db/main/hud-pages/${hudId}.md`);
      hudData.content = await markdownData.text();
      
      // Just the user/repo
      const ghRepo = hudData.repo.replace("https://github.com/", "");

      // Query the info.vdf in the repo to get the UI version
      const infoVdf = await fetch(`https://raw.githubusercontent.com/${ghRepo}/${hudData.hash}/info.vdf`);
      if (infoVdf.ok) {
        const infoVdfJson = parse(await infoVdf.text());
        const tfUiVersion = parseInt(Object.entries(infoVdfJson)[0][1].ui_version, 10);
        hudData.outdated = tfUiVersion !== CURRENT_HUD_VERSION;
      } else if (infoVdf.status == 404) {
        // info.vdf doesn't exist at all, this is a very old HUD
        hudData.outdated = true;
      }

      // Add download link
      hudData.downloadUrl = `https://github.com/${ghRepo}/archive/${hudData.hash}.zip`

      // Query the tag
      const branchTags = await fetch(`https://github.com/${ghRepo}/branch_commits/${hudData.hash}`);
      const dom = new JSDOM(await branchTags.text());
      const tagList = dom.window.document.querySelector(".branches-tag-list");
      if (tagList) {
        // Get the oldest tag associated with this commit
        hudData.versionName = tagList.lastChild.textContent;
      }

      // Query the commit
      const commit = await ghApi(`repos/${ghRepo}/git/commits/${hudData.hash}`);
      hudData.publishDate = new Date(commit.author.date);

      // Remap resources to full URLs
      hudData.resourceUrls = hudData.resources.map((name) => getHudResource(hudId, name));
      hudData.bannerUrl = hudData.resourceUrls[0];

      return [hudId, hudData];
    }));
    hudMap = new Map(hudEntries);
  }

  return hudMap;
}

const load = async function () {
  const huds = await getHuds();

  const results = Array.from(huds.values())
    .sort((a, b) => b.publishDate.valueOf() - a.publishDate.valueOf())
    .filter((hud) => !hud.outdated);

  return results;
};

let _hudPages = null;

/** */
export const fetchHuds = async () => {
  if (!_hudPages) {
    _hudPages = await load();
  }

  return _hudPages;
};