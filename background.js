importScripts("shared.js");

chrome.runtime.onInstalled.addListener(async () => {
  await updateGmailAlarm();
});


chrome.runtime.onStartup.addListener(() => {
  updateGmailAlarm().catch(error => {
    console.error("Could not restore Gmail alarm on startup:", error);
  });
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

function chooseStatusColumn(secondaryStatus, thirdStatus) {
  const secondary = normalizeText(secondaryStatus || "");
  const third = normalizeText(thirdStatus || "");

  if (!secondary || secondary === "pending") return "H";
  if (!third || third === "pending") return "I";

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
    const secondaryCol = headers.indexOf("Secondary Status");
    const thirdCol = headers.indexOf("Third Status");
    if ([titleCol, companyCol, secondaryCol, thirdCol].some(index => index === -1)) continue;

    for (let i = 12; i < rows.length; i++) {
      const row = rows[i] || [];
      const title = row[titleCol] || "";
      const company = row[companyCol] || "";
      if (!title && !company) continue;

      const companyResult = companyMatchScore(emailText, company);
      const titleResult = titleMatchScore(emailText, title);
      const domainResult = senderDomainScore(emailText, company);
      const score = companyResult.score + titleResult.score + domainResult.score;
      const statusColumn = chooseStatusColumn(row[secondaryCol] || "", row[thirdCol] || "");

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
