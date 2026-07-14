importScripts("shared.js");


const LEAFTRACK_UPDATE_ALARM = "leafTrackUpdateCheck";
const LEAFTRACK_RELEASE_API =
  "https://api.github.com/repos/Nathanq3/LeafTrack/releases/latest";
const LEAFTRACK_RELEASES_PAGE =
  "https://github.com/Nathanq3/LeafTrack/releases/latest";
const LEAFTRACK_UPDATE_CACHE_MS = 30 * 60 * 1000;

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split(".").map(value => Number(value) || 0);
  const b = normalizeVersion(right).split(".").map(value => Number(value) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

async function setUpdateBadge(updateAvailable) {
  await chrome.action.setBadgeText({
    text: updateAvailable ? "1" : ""
  });

  if (updateAvailable) {
    await chrome.action.setBadgeBackgroundColor({
      color: "#6f8454"
    });
  }
}

async function checkGitHubRelease(force = false) {
  const currentVersion = chrome.runtime.getManifest().version;
  const cached = await chrome.storage.local.get(["leafTrackUpdateResult"]);
  const prior = cached.leafTrackUpdateResult;

  if (
    !force &&
    prior?.checkedAt &&
    Date.now() - new Date(prior.checkedAt).getTime() < LEAFTRACK_UPDATE_CACHE_MS
  ) {
    await setUpdateBadge(Boolean(prior.updateAvailable));
    return prior;
  }

  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(LEAFTRACK_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          "No public GitHub release was found. Make sure the repository is public and a release is published."
        );
      }

      throw new Error(`GitHub returned HTTP ${response.status}.`);
    }

    const release = await response.json();

    const downloadAsset = (release.assets || []).find(asset => {
      const name = String(asset.name || "").toLowerCase();

      return (
        name.endsWith(".zip") ||
        name.endsWith(".crx") ||
        name.includes("leaftrack")
      );
    });

    const downloadUrl =
      downloadAsset?.browser_download_url ||
      release.html_url ||
      LEAFTRACK_RELEASES_PAGE;

    const latestVersion = normalizeVersion(release.tag_name);
    const updateAvailable =
      compareVersions(latestVersion, currentVersion) > 0;

    const result = {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseNotes: release.body || "",
      releaseUrl: release.html_url || LEAFTRACK_RELEASES_PAGE,
      downloadUrl,
      assetName: downloadAsset?.name || "",
      releaseName: release.name || release.tag_name || "",
      checkedAt
    };

    await chrome.storage.local.set({
      leafTrackUpdateResult: result
    });

    await setUpdateBadge(updateAvailable);
    return result;
  } catch (error) {
    const result = {
      currentVersion,
      latestVersion: prior?.latestVersion || "",
      updateAvailable: Boolean(prior?.updateAvailable),
      releaseNotes: prior?.releaseNotes || "",
      releaseUrl: prior?.releaseUrl || LEAFTRACK_RELEASES_PAGE,
      checkedAt,
      error: error.message || String(error)
    };

    await chrome.storage.local.set({
      leafTrackUpdateResult: result
    });

    await setUpdateBadge(Boolean(result.updateAvailable));
    return result;
  }
}

async function configureUpdateAlarm() {
  chrome.alarms.create(LEAFTRACK_UPDATE_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 12 * 60
  });
}


chrome.runtime.onInstalled.addListener(async () => {
  await updateGmailAlarm();
  await configureUpdateAlarm();
  await checkGitHubRelease(true);
});


chrome.runtime.onStartup.addListener(() => {
  updateGmailAlarm().catch(error => {
    console.error("Could not restore Gmail alarm on startup:", error);
  });

  configureUpdateAlarm().catch(error => {
    console.error("Could not restore update alarm:", error);
  });

  checkGitHubRelease(false).catch(error => {
    console.error("Could not check LeafTrack updates on startup:", error);
  });
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_FOR_UPDATES") {
    checkGitHubRelease(Boolean(message.force))
      .then(result => sendResponse({ ok: !result.error, result, error: result.error }))
      .catch(error => {
        console.error("LeafTrack update check failed:", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "UPDATE_GMAIL_ALARM") {
    updateGmailAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch(error => {
        console.error("Could not update Gmail alarm:", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "RUN_GMAIL_SYNC_NOW") {
    runGmailSync()
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => {
        console.error(error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "SIMULATE_EMAIL") {
    getSettings()
      .then(settings => {
        const selectedType = message.emailType || "rejection";
        const forcedType = selectedType === "custom" ? null : selectedType;

        const emailText = buildSimulatedEmail(
          message.company,
          message.title,
          selectedType,
          message.customBody
        );

        return updateMatchingRowsForEmail(settings, emailText, true, {
          source: "simulator",
          forcedType
        });
      })
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => {
        console.error(error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message.type === "SIMULATE_REJECTION_EMAIL") {
    getSettings()
      .then(settings =>
        updateMatchingRowsForEmail(
          settings,
          message.emailText ||
            "Thank you for applying to Test Company for the Test Role position. Unfortunately, we have decided to move forward with other candidates.",
          true,
          { source: "legacy-simulator", forcedType: "rejection" }
        )
      )
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => {
        console.error(error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "gmailSync") {
    try {
      await runGmailSync(false);
    } catch (error) {
      console.error("Gmail sync failed", error);
    }
    return;
  }

  if (alarm.name === LEAFTRACK_UPDATE_ALARM) {
    try {
      await checkGitHubRelease(true);
    } catch (error) {
      console.error("LeafTrack update check failed:", error);
    }
  }
});

async function updateGmailAlarm() {
  const settings = await getSettings();

  if (settings.gmailSyncEnabled) {
    chrome.alarms.create("gmailSync", { periodInMinutes: 180 });
  } else {
    chrome.alarms.clear("gmailSync");
  }
}

function chooseStatusColumn(
  initialStatus,
  secondaryStatus,
  thirdStatus,
  initialCol,
  secondaryCol,
  thirdCol
) {
  const initial = normalizeText(initialStatus || "");
  const secondary = normalizeText(secondaryStatus || "");
  const third = normalizeText(thirdStatus || "");

  // Use the actual header positions instead of hard-coded letters.
  // This keeps the logic correct when columns such as Salary are moved.
  if (!initial || initial === "pending") return columnLetter(initialCol + 1);
  if (!secondary || secondary === "pending") return columnLetter(secondaryCol + 1);
  if (!third || third === "pending") return columnLetter(thirdCol + 1);

  return null;
}

function buildSimulatedEmail(company, title, emailType, customBody) {
  if (emailType === "custom" && customBody) {
    return customBody;
  }

  const safeCompany = company || "Test Company";
  const safeTitle = title || "Test Role";

  const templates = {
    rejection: `Subject: Application Update - ${safeTitle}

Thank you for applying to ${safeCompany} for the ${safeTitle} position.

Unfortunately, we have decided to move forward with other candidates.`,
    screening: `Subject: Recruiter Screen - ${safeTitle}

Thank you for applying to ${safeCompany} for the ${safeTitle} position.

We would like to schedule an initial recruiter screening call with you.`,
    interview: `Subject: Interview Invitation - ${safeTitle}

Thank you for applying to ${safeCompany} for the ${safeTitle} position.

We would like to invite you to interview with our team.`,
    assessment: `Subject: Assessment for ${safeTitle}

Thank you for applying to ${safeCompany} for the ${safeTitle} position.

The next step is a technical assessment.`,
    offer: `Subject: Offer for ${safeTitle}

Congratulations. We are excited to offer you the ${safeTitle} position at ${safeCompany}.`
  };

  return templates[emailType] || templates.rejection;
}

async function runGmailSync(interactive = true) {
  const settings = await getSettings();
  if (!settings.gmailSyncEnabled && !interactive) return { updated: 0, logs: ["Gmail sync disabled."] };
  if (!settings.spreadsheetId) return { updated: 0, logs: ["No spreadsheet connected."] };

  const query = [
    "newer_than:60d",
    "(",
    "unfortunately",
    "OR \"not selected\"",
    "OR \"not moving forward\"",
    "OR \"move forward with other candidates\"",
    "OR \"no longer under consideration\"",
    "OR \"position has been filled\"",
    "OR \"unable to offer\"",
    "OR \"schedule an interview\"",
    "OR \"interview invitation\"",
    "OR \"phone screen\"",
    "OR \"recruiter call\"",
    "OR \"assessment\"",
    "OR \"coding challenge\"",
    "OR \"offer you\"",
    "OR \"excited to offer\"",
    ")"
  ].join(" ");

  const searchUrl =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=25`;

  const searchResponse = await googleFetch(searchUrl, {}, interactive);
  const searchData = await searchResponse.json();
  const messages = searchData.messages || [];

  let updated = 0;
  const logs = [`Gmail sync read ${messages.length} candidate message(s).`];

  for (const msg of messages) {
    const msgResponse = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      {},
      interactive
    );

    const data = await msgResponse.json();
    const emailText = extractEmailText(data);
    const emailType = classifyEmail(emailText);

    if (!emailType) {
      logs.push("Skipped email: no supported status detected.");
      continue;
    }

    const result = await updateMatchingRowsForEmail(settings, emailText, interactive, {
      source: "gmail",
      forcedType: emailType
    });

    updated += result.updated;
    logs.push(...result.logs);
  }

  await saveSettings({ lastGmailSync: new Date().toISOString() });
  return { updated, logs };
}

function extractEmailText(message) {
  const headers = message.payload?.headers || [];
  const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "";
  const from = headers.find(h => h.name.toLowerCase() === "from")?.value || "";
  const snippets = [subject, from, message.snippet || ""];

  function walk(part) {
    if (!part) return;

    if (part.body?.data) {
      try {
        snippets.push(atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/")));
      } catch (e) {}
    }

    (part.parts || []).forEach(walk);
  }

  walk(message.payload);
  return snippets.join(" ");
}

function titleMatchScore(emailText, title) {
  const normalizedEmail = normalizeText(emailText);
  const titleText = normalizeText(title);
  if (!titleText) return { score: 0, reason: "No title available." };
  if (normalizedEmail.includes(titleText)) return { score: 35, reason: "Exact title match (+35)." };

  const importantWords = getImportantWords(title);
  if (!importantWords.length) return { score: 5, reason: "Generic title (+5)." };
  const matchedWords = importantWords.filter(word => normalizedEmail.includes(word));
  const ratio = matchedWords.length / importantWords.length;
  return {
    score: Math.round(ratio * 30),
    reason: `${matchedWords.length}/${importantWords.length} title keywords (+${Math.round(ratio * 30)}).`
  };
}

function companyMatchScore(emailText, company) {
  const emailCompanyText = normalizeCompany(emailText);
  const rowCompany = normalizeCompany(company);
  if (!rowCompany) return { score: 0, reason: "No company available." };
  if (emailCompanyText.includes(rowCompany)) return { score: 45, reason: "Company matched (+45)." };

  const tokens = rowCompany.split(" ").filter(token => token.length >= 4);
  const matched = tokens.filter(token => emailCompanyText.includes(token));
  const ratio = tokens.length ? matched.length / tokens.length : 0;
  return {
    score: Math.round(ratio * 35),
    reason: `${matched.length}/${tokens.length} company tokens (+${Math.round(ratio * 35)}).`
  };
}

function senderDomainScore(emailText, company) {
  const normalized = normalizeText(emailText);
  const companyTokens = normalizeCompany(company).split(" ").filter(token => token.length >= 4);
  const matched = companyTokens.some(token => normalized.includes(token));
  return matched
    ? { score: 10, reason: "Sender/domain context matched (+10)." }
    : { score: 0, reason: "No sender/domain boost." };
}

async function updateMatchingRowsForEmail(settings, emailText, interactive, options = {}) {
  const logs = [];
  const emailType = options.forcedType || classifyEmail(emailText);
  const newStatus = emailTypeToStatus(emailType);

  if (!newStatus) return { updated: 0, logs: ["No supported email type detected."] };
  logs.push(`${options.forcedType ? "Selected" : "Detected"} email type: ${emailType} → ${newStatus}`);

  const candidates = [];

  for (const tab of settings.tabNames) {
    const range = `${escapeSheetName(tab)}!A:L`;
    const response = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(range)}`,
      {}, interactive
    );
    const data = await response.json();
    const rows = data.values || [];
    if (rows.length < 13) continue;

    const headers = rows[11] || [];
    const titleCol = headers.indexOf("Job Title");
    const companyCol = headers.indexOf("Company");
    const initialCol = headers.indexOf("Initial Status");
    const secondaryCol = headers.indexOf("Secondary Status");
    const thirdCol = headers.indexOf("Third Status");
    if ([titleCol, companyCol, initialCol, secondaryCol, thirdCol].some(index => index === -1)) continue;

    for (let i = 12; i < rows.length; i++) {
      const row = rows[i] || [];
      const title = row[titleCol] || "";
      const company = row[companyCol] || "";
      if (!title && !company) continue;

      const companyResult = companyMatchScore(emailText, company);
      const titleResult = titleMatchScore(emailText, title);
      const domainResult = senderDomainScore(emailText, company);
      const score = companyResult.score + titleResult.score + domainResult.score;
      const statusColumn = chooseStatusColumn(
        row[initialCol] || "",
        row[secondaryCol] || "",
        row[thirdCol] || "",
        initialCol,
        secondaryCol,
        thirdCol
      );

      candidates.push({
        tab, rowNumber: i + 1, title, company, score, statusColumn,
        reasons: [companyResult.reason, titleResult.reason, domainResult.reason]
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];

  if (!best || best.score < 60) {
    logs.push(`No confident match. Best score: ${best?.score || 0}/90.`);
    return { updated: 0, logs };
  }

  if (runnerUp && best.score - runnerUp.score < 8 && options.source !== "simulator") {
    logs.push(`Ambiguous match: top scores ${best.score} and ${runnerUp.score}. No row updated.`);
    return { updated: 0, logs };
  }

  if (!best.statusColumn) {
    logs.push(`Matched ${best.company} — ${best.title}, but no empty status slot remains.`);
    return { updated: 0, logs };
  }

  const cell = `${escapeSheetName(best.tab)}!${best.statusColumn}${best.rowNumber}`;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(cell)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [[newStatus]] }) },
    interactive
  );

  logs.push(`Updated ${best.tab} row ${best.rowNumber}: ${best.company} — ${best.title}.`);
  logs.push(`Confidence ${best.score}/90. ${best.reasons.join(" ")}`);
  logs.push(`${best.statusColumn} = ${newStatus}. Only the best match was updated.`);
  return { updated: 1, logs };
}

function columnLetter(col) {
  let letter = "";

  while (col > 0) {
    const temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }

  return letter;
}
