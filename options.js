function parseCommaList(value) {
  return value.split(",").map(v => v.trim()).filter(Boolean);
}

function parseLineList(value) {
  return value.split("\n").map(v => v.trim()).filter(Boolean);
}

async function showSignedInEmail(interactive = false) {
  const emailElement = document.getElementById("signedInEmail");
  const box = document.getElementById("signedInBox");
  const status = document.getElementById("signInStatus");
  const signInButton = document.getElementById("signIn");
  const signOutButton = document.getElementById("signOut");

  try {
    // Use the Gmail profile attached to LeafTrack's OAuth token.
    // chrome.identity.getProfileUserInfo() reports the Chrome profile account,
    // which may be different from the Google account authorized for LeafTrack.
    const response = await googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {},
      interactive
    );
    const profile = await response.json();
    const email = profile.emailAddress || "Google account connected";

    emailElement.innerText = email;
    box.hidden = false;
    box.classList.add("connected-account");
    status.innerText = "✓ Signed in to LeafTrack";
    status.classList.add("signed-in-status");
    signInButton.hidden = true;
    signOutButton.hidden = false;
    return email;
  } catch (error) {
    emailElement.innerText = "";
    box.hidden = true;
    box.classList.remove("connected-account");
    status.innerText = "Not signed in to LeafTrack.";
    status.classList.remove("signed-in-status");
    signInButton.hidden = false;
    signOutButton.hidden = true;
    return "";
  }
}

function makeSimulatedEmail(company, title, type) {
  if (type === "interview") {
    return `Subject: Interview invitation for ${title}

Hi,

Thank you for applying to ${company} for the ${title} position. We would like to schedule an interview with you.

Best,
${company} Recruiting`;
  }

  if (type === "screening") {
    return `Subject: Phone screen for ${title}

Hi,

Thank you for your interest in ${company}. We would like to schedule a phone screen for the ${title} position.

Best,
${company} Recruiting`;
  }

  if (type === "offer") {
    return `Subject: Offer for ${title}

Hi,

We are excited to offer you the ${title} position at ${company}.

Best,
${company} Recruiting`;
  }

  return `Subject: Application update for ${title}

Hi,

Thank you for applying to ${company} for the ${title} position. Unfortunately, we have decided to move forward with other candidates.

Thank you for your interest in ${company}.`;
}


async function readTrackerRows(settings) {
  const allRows = [];

  if (!settings.spreadsheetId) return allRows;

  for (const tab of settings.tabNames) {
    const range = `${escapeSheetName(tab)}!A:L`;
    const response = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(range)}`
    );

    const data = await response.json();
    const rows = data.values || [];
    const headers = rows[11] || rows[0] || [];

    const titleCol = headers.indexOf("Job Title");
    const companyCol = headers.indexOf("Company");
    const locationCol = headers.indexOf("Location");
    const salaryCol = headers.indexOf("Salary");
    const dateCol = headers.indexOf("Date Submitted");
    const linkCol = headers.indexOf("Link");
    const resumeCol = headers.indexOf("Resume Used");
    const currentCol = headers.indexOf("Current Status");
    const secondaryCol = headers.indexOf("Secondary Status");
    const thirdCol = headers.indexOf("Third Status");
    const initialCol = headers.indexOf("Initial Status");

    if (titleCol === -1 || companyCol === -1) continue;

    for (let i = 12; i < rows.length; i++) {
      const row = rows[i] || [];
      const title = row[titleCol] || "";
      const company = row[companyCol] || "";
      if (!title && !company) continue;

      const currentStatus =
        row[currentCol] ||
        row[thirdCol] ||
        row[secondaryCol] ||
        row[initialCol] ||
        "";

      allRows.push({
        tab,
        rowNumber: i + 1,
        title,
        company,
        location: row[locationCol] || "",
        salary: salaryCol === -1 ? "" : (row[salaryCol] || ""),
        dateSubmitted: row[dateCol] || "",
        link: row[linkCol] || "",
        resume: row[resumeCol] || "Unknown Resume",
        initialStatus: row[initialCol] || "",
        secondaryStatus: row[secondaryCol] || "",
        thirdStatus: row[thirdCol] || "",
        status: currentStatus || "Unknown"
      });
    }
  }

  return allRows;
}

function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

function updateStatText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function setProgress(id, percent) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

async function refreshDashboardStats(logDebug) {
  const settings = await getSettings();

  if (!settings.spreadsheetId) {
    updateStatText("statTotal", "0");
    updateStatText("statApplied", "0");
    updateStatText("statPending", "0");
    updateStatText("statScreening", "0");
    updateStatText("statInterview", "0");
    updateStatText("statOffers", "0");
    updateStatText("statRejected", "0");
    updateStatText("statResponseRate", "0%");
    const box = document.getElementById("resumeAnalytics");
    if (box) box.innerText = "Connect a spreadsheet first.";
    return;
  }

  const rows = await readTrackerRows(settings);
  const total = rows.length;

  const hasStatus = (row, status) =>
    [row.initialStatus, row.secondaryStatus, row.thirdStatus].includes(status);

  const applied = countWhere(rows, r => hasStatus(r, "Applied"));
  const pending = countWhere(rows, r => hasStatus(r, "Pending"));
  const screening = countWhere(rows, r => hasStatus(r, "Screening") || hasStatus(r, "Assessment"));
  const interview = countWhere(rows, r => hasStatus(r, "Interview"));
  const offers = countWhere(rows, r => hasStatus(r, "Offer Extended"));
  const rejected = countWhere(rows, r => hasStatus(r, "Rejected"));

  const responded = countWhere(rows, r =>
    hasStatus(r, "Screening") || hasStatus(r, "Assessment") ||
    hasStatus(r, "Interview") || hasStatus(r, "Offer Extended") || hasStatus(r, "Rejected")
  );
  const responseRateNumber = total ? Math.round((responded / total) * 100) : 0;
  const interviewRateNumber = total ? Math.round((interview / total) * 100) : 0;
  const offerRateNumber = total ? Math.round((offers / total) * 100) : 0;
  const responseRate = `${responseRateNumber}%`;

  updateStatText("statTotal", total);
  updateStatText("statApplied", applied);
  updateStatText("statPending", pending);
  updateStatText("statScreening", screening);
  updateStatText("statInterview", interview);
  updateStatText("statOffers", offers);
  updateStatText("statRejected", rejected);
  updateStatText("statResponseRate", responseRate);
  setProgress("responseProgress", responseRateNumber);
  setProgress("interviewProgress", interviewRateNumber);
  setProgress("offerProgress", offerRateNumber);

  const resumeStats = {};
  for (const row of rows) {
    if (!resumeStats[row.resume]) {
      resumeStats[row.resume] = { total: 0, interview: 0, offers: 0, rejected: 0 };
    }

    resumeStats[row.resume].total++;
    if (hasStatus(row, "Interview")) resumeStats[row.resume].interview++;
    if (hasStatus(row, "Offer Extended")) resumeStats[row.resume].offers++;
    if (hasStatus(row, "Rejected")) resumeStats[row.resume].rejected++;
  }

  const lines = Object.entries(resumeStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([resume, s]) => {
      const interviewRate = s.total ? Math.round((s.interview / s.total) * 100) : 0;
      return `${resume}\n  ${s.total} applications • ${s.interview} interviews • ${s.offers} offers • ${s.rejected} rejected • ${interviewRate}% interview rate`;
    });

  const box = document.getElementById("resumeAnalytics");
  if (box) box.innerText = lines.length ? lines.join("\n\n") : "No application rows found yet.";

  logDebug(`Stats refreshed. Total applications: ${total}.`);
}



function statusClassName(status) {
  return `status-${normalizeText(status).replace(/\s+/g, "-") || "blank"}`;
}

function makeTimelineChip(status) {
  const span = document.createElement("span");
  span.className = `timeline-chip ${statusClassName(status)}`;
  span.textContent = status || "Blank";
  return span;
}

function formatSalaryDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/[$£€]|\b(?:hr|hour|year|yr|annual|salary|k)\b/i.test(raw)) return raw;
  const numeric = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return raw;
  if (numeric <= 500) return `$${numeric.toLocaleString()}/hr`;
  return `$${numeric.toLocaleString()}/year`;
}

function renderTimeline(rows, logDebug) {
  const list = document.getElementById("timelineList");
  if (!list) return;

  const query = normalizeText(document.getElementById("timelineSearch")?.value || "");
  const statusFilter = document.getElementById("timelineStatusFilter")?.value || "";
  const resumeFilter = document.getElementById("timelineResumeFilter")?.value || "";

  const filtered = rows
    .filter(row => {
      const haystack = normalizeText(`${row.company} ${row.title} ${row.location} ${row.salary}`);
      const matchesSearch = !query || haystack.includes(query);
      const matchesStatus = !statusFilter || row.status === statusFilter ||
        [row.initialStatus, row.secondaryStatus, row.thirdStatus].includes(statusFilter);
      const matchesResume = !resumeFilter || row.resume === resumeFilter;
      return matchesSearch && matchesStatus && matchesResume;
    })
    .sort((a, b) => b.rowNumber - a.rowNumber)
    .slice(0, 50);

  list.innerHTML = "";

  if (!filtered.length) {
    list.innerHTML = `<div class="timeline-empty">No matching applications found.</div>`;
    return;
  }

  for (const row of filtered) {
    const item = document.createElement("div");
    item.className = "timeline-item";

    const company = document.createElement("div");
    company.className = "timeline-company";
    company.textContent = row.company || "Unknown Company";

    const title = document.createElement("div");
    title.className = "timeline-title";
    title.textContent = row.title || "Untitled Role";

    const salaryValue = formatSalaryDisplay(row.salary);
    const salary = document.createElement("div");
    salary.className = "timeline-salary";
    salary.textContent = `💰 ${salaryValue}`;
    salary.hidden = !salaryValue;

    const meta = document.createElement("div");
    meta.className = "timeline-meta";
    meta.textContent = `📅 ${row.dateSubmitted || "No date"}   •   📍 ${row.location || "No location"}   •   📄 ${row.resume || "Unknown Resume"}`;

    const path = document.createElement("div");
    path.className = "timeline-path";
    const statuses = [];
    if (row.initialStatus) statuses.push(row.initialStatus);
    if (row.secondaryStatus && row.secondaryStatus !== row.initialStatus) statuses.push(row.secondaryStatus);
    if (row.thirdStatus && row.thirdStatus !== row.secondaryStatus) statuses.push(row.thirdStatus);
    if (!statuses.length && row.status) statuses.push(row.status);

    statuses.forEach((status, index) => {
      if (index > 0) {
        const arrow = document.createElement("span");
        arrow.className = "timeline-arrow";
        arrow.textContent = "→";
        path.appendChild(arrow);
      }
      path.appendChild(makeTimelineChip(status));
    });

    item.appendChild(company);
    item.appendChild(title);
    item.appendChild(salary);
    item.appendChild(meta);
    item.appendChild(path);
    if (row.link) {
      item.addEventListener("dblclick", () => window.open(row.link, "_blank"));
      item.title = "Double-click to open job posting";
    }
    list.appendChild(item);
  }

  logDebug(`Timeline refreshed with ${filtered.length} matching item(s).`);
}
let cachedTimelineRows = [];

async function refreshTimeline(logDebug) {
  const settings = await getSettings();
  cachedTimelineRows = await readTrackerRows(settings);

  const resumeFilter = document.getElementById("timelineResumeFilter");
  if (resumeFilter) {
    const selected = resumeFilter.value;
    const resumes = [...new Set(cachedTimelineRows.map(row => row.resume).filter(Boolean))].sort();
    resumeFilter.innerHTML = '<option value="">All resumes</option>';
    resumes.forEach(resume => {
      const option = document.createElement("option");
      option.value = resume;
      option.textContent = resume;
      resumeFilter.appendChild(option);
    });
    resumeFilter.value = resumes.includes(selected) ? selected : "";
  }

  renderTimeline(cachedTimelineRows, logDebug);
}


document.addEventListener("DOMContentLoaded", async () => {
  const settings = await getSettings();
  const uiPreferences = await chrome.storage.sync.get(["leafTrackDarkMode", "leafTrackAdvancedOpen"]);

  function applyTheme(isDark) {
    document.body.classList.toggle("dark", Boolean(isDark));
    const toggle = document.getElementById("themeToggle");
    if (toggle) toggle.checked = Boolean(isDark);
  }

  function logDebug(message) {
    const box = document.getElementById("debugLog");
    if (!box) return;
    const time = new Date().toLocaleTimeString();
    box.value += `[${time}] ${message}\n`;
    box.scrollTop = box.scrollHeight;
  }

  applyTheme(uiPreferences.leafTrackDarkMode);
  const advancedSettings = document.getElementById("advancedSettings");
  if (advancedSettings) {
    advancedSettings.open = Boolean(uiPreferences.leafTrackAdvancedOpen);
    advancedSettings.addEventListener("toggle", () => {
      chrome.storage.sync.set({ leafTrackAdvancedOpen: advancedSettings.open });
    });
  }

  document.getElementById("themeToggle")?.addEventListener("change", event => {
    const enabled = Boolean(event.target.checked);
    applyTheme(enabled);
    chrome.storage.sync.set({ leafTrackDarkMode: enabled });
  });

  let autoRefreshRunning = false;

  async function autoRefreshDashboard() {
    if (autoRefreshRunning || document.hidden) return;

    autoRefreshRunning = true;

    try {
      await refreshDashboardStats(logDebug);

      if (typeof refreshTimeline === "function") {
        await refreshTimeline(logDebug);
      }
    } catch (error) {
      console.error("Dashboard auto-refresh failed:", error);
      logDebug(`Dashboard auto-refresh failed: ${error}`);
    } finally {
      autoRefreshRunning = false;
    }
  }

  logDebug("LeafTrack v4 UI loaded.");

  document.getElementById("tabNames").value = settings.tabNames.join(", ");
  document.getElementById("resumeNames").value = settings.resumeNames.join("\n");
  document.getElementById("gmailSyncEnabled").checked = settings.gmailSyncEnabled === true;

  await showSignedInEmail(false);

  if (settings.spreadsheetId) {
    document.getElementById("spreadsheetId").value = settings.spreadsheetId;
    const link = document.getElementById("sheetLink");
    link.href = settings.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}`;
    link.hidden = false;
    document.getElementById("sheetStatus").innerText = "Spreadsheet connected.";
    logDebug("Connected spreadsheet loaded.");
  } else {
    document.getElementById("sheetStatus").innerText = "No spreadsheet connected.";
  }

  try {
    await refreshDashboardStats(logDebug);
    await refreshTimeline(logDebug);
  } catch (error) {
    console.error(error);
    logDebug(`Initial stats refresh failed: ${error}`);
  }

  document.getElementById("generateSimEmail").addEventListener("click", () => {
    const company = document.getElementById("simCompany").value.trim() || "Test Company";
    const title = document.getElementById("simTitle").value.trim() || "IT Support Intern";
    const type = document.getElementById("simType").value;
    document.getElementById("simEmailBody").value = makeSimulatedEmail(company, title, type);
    logDebug(`Generated simulated ${type} email for ${company} / ${title}.`);
  });

  document.getElementById("simType").addEventListener("change", () => {
    document.getElementById("generateSimEmail").click();
  });

  const runTimelineSearch = () => {
    renderTimeline(cachedTimelineRows, logDebug);
  };

  document.getElementById("timelineSearch")?.addEventListener("input", runTimelineSearch);
  document.getElementById("timelineSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      runTimelineSearch();
    }
  });
  document.getElementById("timelineSearchButton")?.addEventListener("click", runTimelineSearch);
  document.getElementById("timelineStatusFilter")?.addEventListener("change", runTimelineSearch);
  document.getElementById("timelineResumeFilter")?.addEventListener("change", runTimelineSearch);
  document.getElementById("timelineClearButton")?.addEventListener("click", () => {
    const search = document.getElementById("timelineSearch");
    const statusFilter = document.getElementById("timelineStatusFilter");
    const resumeFilter = document.getElementById("timelineResumeFilter");

    if (search) search.value = "";
    if (statusFilter) statusFilter.value = "";
    if (resumeFilter) resumeFilter.value = "";

    runTimelineSearch();
    search?.focus();
  });

  document.getElementById("generateSimEmail").click();

  document.getElementById("simulateRejection").addEventListener("click", async () => {
    const company = document.getElementById("simCompany")?.value.trim() || "";
    const title = document.getElementById("simTitle")?.value.trim() || "";
    const emailTypeSelect = document.getElementById("simType");

    if (!emailTypeSelect) {
      document.getElementById("developerStatus").innerText =
        "Could not find the Email Type dropdown.";
      logDebug("ERROR: simType dropdown not found.");
      return;
    }

    const emailType = emailTypeSelect.value;
    const customBody = document.getElementById("simEmailBody")?.value || "";

    document.getElementById("developerStatus").innerText =
      "Running email simulator...";

    logDebug(
      `Simulator started. Selected type=${emailType}. Company=${company || "(blank)"}. Title=${title || "(blank)"}.`
    );

    chrome.runtime.sendMessage(
      {
        type: "SIMULATE_EMAIL",
        company,
        title,
        emailType,
        customBody
      },
      response => {
        if (response?.ok) {
          const updated = response.updated || 0;

          document.getElementById("developerStatus").innerText =
            `Simulation complete. Updated ${updated} row(s).`;

          (response.logs || []).forEach(logDebug);

          refreshDashboardStats(logDebug).catch(error =>
            logDebug(`Stats refresh after simulation failed: ${error}`)
          );

          if (typeof refreshTimeline === "function") {
            refreshTimeline(logDebug).catch(error =>
              logDebug(`Timeline refresh after simulation failed: ${error}`)
            );
          }
        } else {
          document.getElementById("developerStatus").innerText =
            "Simulation failed.";
          logDebug(`Simulation failed: ${response?.error || "Unknown error"}`);
        }
      }
    );
  });

  document.getElementById("signIn").addEventListener("click", async () => {
    try {
      await getAuthToken(true);
      await showSignedInEmail(true);
      logDebug("Google sign-in successful.");
    } catch (error) {
      console.error(error);
      document.getElementById("signInStatus").innerText = "Sign-in failed.";
      logDebug(`Sign-in failed: ${error}`);
    }
  });

  document.getElementById("signOut").addEventListener("click", async () => {
    try {
      const token = await getAuthToken(false);
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);

      chrome.identity.removeCachedAuthToken({ token }, async () => {
        await chrome.storage.sync.clear();
        document.getElementById("spreadsheetId").value = "";
        document.getElementById("tabNames").value = "Applications";
        document.getElementById("resumeNames").value =
          "";
        document.getElementById("gmailSyncEnabled").checked = false;
        document.getElementById("sheetLink").hidden = true;
        document.getElementById("signedInEmail").innerText = "";
        document.getElementById("signedInBox").hidden = true;
        document.getElementById("signIn").hidden = false;
        document.getElementById("signOut").hidden = true;
        document.getElementById("signInStatus").classList.remove("signed-in-status");
        document.getElementById("signInStatus").innerText =
          "Signed out and cleared LeafTrack settings.";
        logDebug("Signed out and cleared settings.");
      });
    } catch (error) {
      console.error(error);
      await chrome.storage.sync.clear();
      document.getElementById("signIn").hidden = false;
      document.getElementById("signOut").hidden = true;
      document.getElementById("signInStatus").classList.remove("signed-in-status");
      document.getElementById("signInStatus").innerText =
        "Signed out locally and cleared LeafTrack settings.";
      logDebug(`Signed out locally after error: ${error}`);
    }
  });

  document.getElementById("createTracker").addEventListener("click", async () => {
    const tabNames = parseCommaList(document.getElementById("tabNames").value);
    const resumeNames = parseLineList(document.getElementById("resumeNames").value);

    if (!tabNames.length) {
      document.getElementById("sheetStatus").innerText = "Add at least one tab name.";
      return;
    }

    try {
      const spreadsheet = await createLeafTrackSpreadsheet(tabNames, resumeNames);
      document.getElementById("spreadsheetId").value = spreadsheet.spreadsheetId;
      document.getElementById("sheetStatus").innerText = "Tracker created and connected.";
      const link = document.getElementById("sheetLink");
      link.href = spreadsheet.spreadsheetUrl;
      link.hidden = false;
      logDebug("Created and connected new tracker spreadsheet.");
    } catch (error) {
      console.error(error);
      document.getElementById("sheetStatus").innerText =
        "Could not create tracker. Check Google permissions.";
      logDebug(`Create tracker failed: ${error}`);
    }
  });

  document.getElementById("connectTracker").addEventListener("click", async () => {
    const spreadsheetId = document.getElementById("spreadsheetId").value.trim();

    if (!spreadsheetId) {
      document.getElementById("sheetStatus").innerText = "Paste a spreadsheet ID first.";
      return;
    }

    try {
      const metadata = await connectExistingSpreadsheet(spreadsheetId);
      document.getElementById("tabNames").value =
        metadata.sheets.map(s => s.properties.title).join(", ");
      document.getElementById("sheetStatus").innerText = "Existing tracker connected.";
      const link = document.getElementById("sheetLink");
      link.href = metadata.spreadsheetUrl;
      link.hidden = false;
      logDebug("Connected existing spreadsheet.");
    } catch (error) {
      console.error(error);
      document.getElementById("sheetStatus").innerText =
        "Could not connect. Make sure this Google account can edit the Sheet.";
      logDebug(`Connect tracker failed: ${error}`);
    }
  });

  document.getElementById("changeSpreadsheet").addEventListener("click", async () => {
    await chrome.storage.sync.remove([
      "spreadsheetId",
      "spreadsheetUrl",
      "tabNames",
      "defaultTab"
    ]);
    document.getElementById("spreadsheetId").value = "";
    document.getElementById("tabNames").value = "Applications";
    document.getElementById("sheetLink").hidden = true;
    document.getElementById("sheetStatus").innerText =
      "Spreadsheet disconnected. Create or connect a new one.";
    logDebug("Disconnected spreadsheet.");
  });

  document.getElementById("saveResumes").addEventListener("click", async () => {
    const resumeNames = parseLineList(document.getElementById("resumeNames").value);
    if (!resumeNames.length) {
      document.getElementById("resumeStatus").innerText = "Add at least one resume name.";
      return;
    }
    await saveSettings({ resumeNames });
    document.getElementById("resumeStatus").innerText = "Resume list saved.";
    logDebug("Resume list saved.");
  });


  const gmailSyncCheckbox = document.getElementById("gmailSyncEnabled");

  gmailSyncCheckbox.addEventListener("change", async () => {
    const gmailSyncEnabled = gmailSyncCheckbox.checked;

    try {
      await saveSettings({ gmailSyncEnabled });

      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_GMAIL_ALARM"
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not update Gmail alarm.");
      }

      document.getElementById("gmailStatus").innerText = gmailSyncEnabled
        ? "Gmail auto-scan enabled. It will run every 3 hours."
        : "Gmail auto-scan disabled.";

      logDebug(
        gmailSyncEnabled
          ? "Gmail auto-scan preference saved and enabled."
          : "Gmail auto-scan preference saved and disabled."
      );
    } catch (error) {
      console.error(error);

      // Restore the previous state if saving failed.
      gmailSyncCheckbox.checked = !gmailSyncEnabled;

      document.getElementById("gmailStatus").innerText =
        "Could not save Gmail auto-scan setting.";

      logDebug(`Could not save Gmail auto-scan setting: ${error}`);
    }
  });

  document.getElementById("saveGmailSync").addEventListener("click", async () => {
    const gmailSyncEnabled =
      document.getElementById("gmailSyncEnabled").checked;

    try {
      await saveSettings({ gmailSyncEnabled });

      const response = await chrome.runtime.sendMessage({
        type: "UPDATE_GMAIL_ALARM"
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not update Gmail alarm.");
      }

      document.getElementById("gmailStatus").innerText = gmailSyncEnabled
        ? "Gmail auto-scan enabled. It will run every 3 hours."
        : "Gmail auto-scan disabled.";

      logDebug(
        gmailSyncEnabled
          ? "Gmail auto-scan setting saved."
          : "Gmail auto-scan setting disabled."
      );
    } catch (error) {
      console.error(error);
      document.getElementById("gmailStatus").innerText =
        "Could not save Gmail auto-scan setting.";
      logDebug(`Could not save Gmail auto-scan setting: ${error}`);
    }
  });

  document.getElementById("runGmailSync").addEventListener("click", async () => {
    document.getElementById("gmailStatus").innerText = "Running Gmail sync...";
    logDebug("Manual Gmail sync started.");

    chrome.runtime.sendMessage({ type: "RUN_GMAIL_SYNC_NOW" }, response => {
      document.getElementById("gmailStatus").innerText =
        response?.ok
          ? `Gmail sync complete. Updated ${response.updated || 0} row(s).`
          : "Gmail sync failed.";
      logDebug(
        response?.ok
          ? `Gmail sync complete. Updated ${response.updated || 0} row(s).`
          : `Gmail sync failed: ${response?.error || "Unknown error"}`
      );

      (response?.logs || []).forEach(logDebug);
      if (response?.ok) {
        refreshDashboardStats(logDebug).catch(error => logDebug(`Stats refresh after Gmail sync failed: ${error}`));
        refreshTimeline(logDebug).catch(error => logDebug(`Timeline refresh after Gmail sync failed: ${error}`));
      }
    });
  });


  document.getElementById("refreshStats").addEventListener("click", async () => {
    try {
      await refreshDashboardStats(logDebug);
      document.getElementById("developerStatus").innerText = "Dashboard stats refreshed.";
    } catch (error) {
      console.error(error);
      document.getElementById("developerStatus").innerText = "Could not refresh dashboard stats.";
      logDebug(`Stats refresh failed: ${error}`);
    }
  });


  document.getElementById("refreshTimeline").addEventListener("click", async () => {
    try {
      await refreshTimeline(logDebug);
      document.getElementById("developerStatus").innerText = "Timeline refreshed.";
    } catch (error) {
      console.error(error);
      document.getElementById("developerStatus").innerText = "Could not refresh timeline.";
      logDebug(`Timeline refresh failed: ${error}`);
    }
  });

  document.getElementById("formatCurrentTracker").addEventListener("click", async () => {
    const currentSettings = await getSettings();

    if (!currentSettings.spreadsheetId) {
      document.getElementById("developerStatus").innerText = "Connect a spreadsheet first.";
      logDebug("Format blocked: no spreadsheet connected.");
      return;
    }

    try {
      for (const tabName of currentSettings.tabNames) {
        await setupSheetTab(currentSettings.spreadsheetId, tabName);
        logDebug(`Formatted tab: ${tabName}`);
      }
      document.getElementById("developerStatus").innerText = "Current spreadsheet formatted.";
    } catch (error) {
      console.error(error);
      document.getElementById("developerStatus").innerText = "Could not format current spreadsheet.";
      logDebug(`Format failed: ${error}`);
    }
  });

  document.getElementById("generateSimEmail").click();

  const dashboardRefreshTimer = window.setInterval(
    autoRefreshDashboard,
    30 * 1000
  );

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      autoRefreshDashboard();
    }
  });

  window.addEventListener("beforeunload", () => {
    window.clearInterval(dashboardRefreshTimer);
  });
});
