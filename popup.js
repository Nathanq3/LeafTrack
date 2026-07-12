
function setResumeSelectorState(resumeNames) {
  const select = document.getElementById("resumeUsed");
  const saveButton = document.getElementById("saveJob");

  if (!select) return;

  select.innerHTML = "";

  if (!Array.isArray(resumeNames) || resumeNames.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Create a resume name in Settings";
    option.selected = true;
    select.appendChild(option);
    select.disabled = true;

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.title = "Add at least one resume name in Settings.";
    }
    return;
  }

  select.disabled = false;

  for (const name of resumeNames) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }

  if (saveButton) {
    saveButton.disabled = false;
    saveButton.title = "";
  }
}


async function applyPopupTheme() {
  const stored = await chrome.storage.sync.get(["leafTrackDarkMode"]);
  const enabled = Boolean(stored.leafTrackDarkMode);
  document.documentElement.classList.toggle("dark-mode", enabled);
  document.body.classList.toggle("dark-mode", enabled);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.leafTrackDarkMode) {
    const enabled = Boolean(changes.leafTrackDarkMode.newValue);
    document.documentElement.classList.toggle("dark-mode", enabled);
    document.body.classList.toggle("dark-mode", enabled);
  }
});


function safeFileName(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function fillSelect(id, values, selected) {
  const select = document.getElementById(id);
  select.innerHTML = "";
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    if (value === selected) option.selected = true;
    select.appendChild(option);
  });
}

async function loadPopupSettings() {
  const settings = await getSettings();
  setResumeSelectorState(settings.resumeNames || []);

  fillSelect("sheet", settings.tabNames, settings.defaultTab);
  fillSelect("resumeUsed", settings.resumeNames, settings.resumeNames[0]);

  if (!settings.spreadsheetId) {
    document.getElementById("setupWarning").hidden = false;
  }
}

async function autofillJobInfo() {
  const tab = await getActiveTab();

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: () => {
        function clean(text) {
          return String(text || "")
            .replace(/\s+/g, " ")
            .replace(/Promoted/gi, "")
            .replace(/Easy Apply/gi, "")
            .replace(/Apply Now/gi, "")
            .replace(/Apply for this job/gi, "")
            .trim();
        }

        function cleanTitle(text) {
          return clean(text)
            .replace(/^apply for\s+/i, "")
            .replace(/^job\s*title\s*:?\s*/i, "")
            .replace(/\s*\|\s*LinkedIn.*$/i, "")
            .replace(/\s*-\s*LinkedIn.*$/i, "")
            .replace(/\s*\|\s*Careers.*$/i, "")
            .replace(/\s*-\s*Careers.*$/i, "")
            .replace(/^[-–—|:]+/, "")
            .trim();
        }

        function cleanCompany(text) {
          return clean(text)
            .replace(/^careers at\s+/i, "")
            .replace(/^company\s*:?\s*/i, "")
            .replace(/\s+careers$/i, "")
            .replace(/\s+jobs$/i, "")
            .trim();
        }

        function cleanLocation(text) {
          let value = clean(text)
            .replace(/^location\s*:?\s*/i, "")
            .replace(/\bUNAVAILABLE\b\s*,?\s*/gi, "")
            .replace(/Remote Work.*$/i, "")
            .replace(/Apply.*$/i, "")
            .replace(/Reposted.*$/i, "")
            .replace(/Posted.*$/i, "")
            .replace(/Applicants.*$/i, "")
            .replace(/\s*,\s*,+/g, ", ")
            .replace(/^\s*,|,\s*$/g, "")
            .trim();

          if (
            !value ||
            /^(unknown|not specified|n\/?a|null|undefined)$/i.test(value) ||
            /^(?:hybrid|remote|on[- ]?site)?\s*work environment$/i.test(value) ||
            /^work environment$/i.test(value)
          ) {
            return "";
          }

          // Reject job-description prose that happens to contain a comma.
          if (
            value.length > 110 ||
            /\b(pursuing|degree|experience|required|requirement|qualification|responsibilit|skills?|computer science|data science|engineering|candidate|ability to|must have|preferred)\b/i.test(value)
          ) {
            return "";
          }

          // A location should resemble a city/state/country, remote label, or a short place name.
          const looksLikeLocation =
            /\b(remote|hybrid|on[- ]?site|onsite)\b/i.test(value) ||
            /,\s*(?:[A-Z]{2}|[A-Za-z][A-Za-z .'-]{2,})(?:,\s*[A-Za-z][A-Za-z .'-]{2,})?$/i.test(value) ||
            /^(?:Washington,?\s*DC|New York,?\s*NY|Los Angeles,?\s*CA|Chicago,?\s*IL)$/i.test(value);

          return looksLikeLocation ? value : "";
        }

        function cleanSalary(text) {
          const isStipend = /\bstipend\b/i.test(String(text || ""));

          let value = clean(text)
            .replace(/^salary\s*:?\s*/i, "")
            .replace(/^compensation\s*:?\s*/i, "")
            .replace(/^pay range\s*:?\s*/i, "")
            .replace(/^stipend\s*:?\s*/i, "")
            .replace(/\s+/g, " ")
            .trim();

          if (!value) return "";

          // Keep the useful pay range and cadence, while removing unrelated trailing text.
          const match = value.match(
            /(?:USD\s*)?(?:\$|US\$)?\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:-|–|—|to)\s*(?:USD\s*)?(?:\$|US\$)?\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:USD)?\s*(?:per\s+)?(?:hour|hr|hourly|year|yr|annually|annual|month|monthly|week|weekly)?|(?:USD\s*)?(?:\$|US\$)\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:USD)?\s*(?:per\s+)?(?:hour|hr|hourly|year|yr|annually|annual|month|monthly|week|weekly)?/i
          );

          const cleaned = clean(match?.[0] || value)
            .replace(/\bper hour\b/i, "/hr")
            .replace(/\bhourly\b/i, "/hr")
            .replace(/\bper year\b/i, "/year")
            .replace(/\bannually\b/i, "/year")
            .replace(/\bannual\b/i, "/year")
            .replace(/\bper month\b/i, "/month")
            .replace(/\bmonthly\b/i, "/month")
            .replace(/\bper week\b/i, "/week")
            .replace(/\bweekly\b/i, "/week")
            .replace(/\s+/g, " ")
            .trim();

          // Some ATS feeds publish placeholder values such as "$0 - $0 YEAR".
          // Ignore them so visible page text can win instead.
          const numbers = [...cleaned.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
            .map(match => Number(match[0].replace(/,/g, "")))
            .filter(Number.isFinite);

          if (!numbers.length || numbers.every(number => number <= 0)) return "";

          const normalized = cleaned
            .replace(/\bHOUR\b/i, "/hr")
            .replace(/\bYEAR\b/i, "/year")
            .replace(/\bMONTH\b/i, "/month")
            .replace(/\bWEEK\b/i, "/week")
            .replace(/\s*\/\s*/g, "/")
            .trim();

          return isStipend && !/\bstipend\b/i.test(normalized)
            ? `${normalized} stipend`
            : normalized;
        }

        function salaryFromStructuredValue(baseSalary) {
          if (!baseSalary) return "";
          if (typeof baseSalary === "string" || typeof baseSalary === "number") {
            return cleanSalary(String(baseSalary));
          }

          const currency = baseSalary.currency || baseSalary.value?.currency || "";
          const unit = baseSalary.value?.unitText || baseSalary.unitText || "";
          const value = baseSalary.value ?? baseSalary;

          if (typeof value === "string" || typeof value === "number") {
            const prefix = currency && currency !== "USD" ? `${currency} ` : "$";
            return cleanSalary(`${prefix}${value} ${unit}`);
          }

          const min = value.minValue ?? value.value;
          const max = value.maxValue;
          if (min == null) return "";

          const symbol = !currency || currency === "USD" ? "$" : `${currency} `;
          const cadence = unit ? ` ${unit}` : "";
          return cleanSalary(
            max != null
              ? `${symbol}${min} - ${symbol}${max}${cadence}`
              : `${symbol}${min}${cadence}`
          );
        }

        function textFromElement(el) {
          if (!el) return "";
          if (el.tagName === "META") return clean(el.getAttribute("content"));
          if (el.tagName === "IMG") return clean(el.getAttribute("alt") || el.getAttribute("title"));
          return clean(el.innerText || el.textContent || el.getAttribute("aria-label"));
        }

        function allText(selectors) {
          const values = [];
          for (const selector of selectors) {
            document.querySelectorAll(selector).forEach(el => {
              const text = textFromElement(el);
              if (text) values.push(text);
            });
          }
          return values;
        }

        function firstText(selectors) {
          return allText(selectors)[0] || "";
        }

        function lineValue(labelPattern) {
          for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            const match = line.match(labelPattern);
            if (match?.[1]) return clean(match[1]);

            // Some sites render the label and value as separate text lines.
            if (labelPattern.test(line) && lines[index + 1]) {
              return clean(lines[index + 1]);
            }
          }
          return "";
        }

        function labeledDomValue(label) {
          const labelRegex = new RegExp(`^${label}\\s*:?\\s*`, "i");
          const elements = Array.from(document.querySelectorAll("body *"));

          for (const element of elements) {
            const directText = Array.from(element.childNodes || [])
              .filter(node => node.nodeType === Node.TEXT_NODE)
              .map(node => node.textContent || "")
              .join(" ")
              .trim();

            if (!labelRegex.test(directText)) continue;

            const sameNodeValue = directText.replace(labelRegex, "").trim();
            if (sameNodeValue) return clean(sameNodeValue);

            const sibling = element.nextElementSibling;
            if (sibling) {
              const siblingText = textFromElement(sibling);
              if (siblingText) return siblingText;
            }

            const fullText = textFromElement(element);
            const stripped = fullText.replace(labelRegex, "").trim();
            if (stripped && stripped !== fullText) return clean(stripped);
          }

          return "";
        }

        function explicitVisibleLabelValue(labelText, cleaner) {
          const labelRegex = new RegExp(`^\\s*${labelText}\\s*:?\\s*$`, "i");
          const inlineRegex = new RegExp(`^\\s*${labelText}\\s*:\\s*(.+)$`, "i");
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode(node) {
                const text = String(node.nodeValue || "").replace(/\\s+/g, " ").trim();
                return labelRegex.test(text) || inlineRegex.test(text)
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_SKIP;
              }
            }
          );

          let node;
          while ((node = walker.nextNode())) {
            const text = String(node.nodeValue || "").replace(/\\s+/g, " ").trim();
            const inline = text.match(inlineRegex)?.[1];
            if (inline) {
              const cleaned = cleaner(inline);
              if (cleaned) return cleaned;
            }

            const element = node.parentElement;
            if (!element) continue;

            const siblingCandidates = [
              element.nextElementSibling,
              element.parentElement?.nextElementSibling,
              element.parentElement?.querySelector(':scope > :last-child')
            ].filter(Boolean);

            for (const sibling of siblingCandidates) {
              const cleaned = cleaner(sibling.innerText || sibling.textContent || "");
              if (cleaned) return cleaned;
            }

            // Some ATS pages put the label and value in separate text nodes inside one row.
            const row = element.closest('li, p, div, tr, section') || element.parentElement;
            if (row) {
              const rowLines = String(row.innerText || row.textContent || "")
                .split(/\\n+/)
                .map(v => v.replace(/\\s+/g, " ").trim())
                .filter(Boolean);

              for (let i = 0; i < rowLines.length; i++) {
                if (!labelRegex.test(rowLines[i])) continue;
                const cleaned = cleaner(rowLines[i + 1] || "");
                if (cleaned) return cleaned;
              }
            }

            // Last resort: inspect the next few visible text nodes after the label.
            let next = node;
            for (let i = 0; i < 8; i++) {
              next = nextTextNode(next);
              if (!next) break;
              const cleaned = cleaner(next.nodeValue || "");
              if (cleaned) return cleaned;
            }
          }

          return "";
        }

        function nextTextNode(node) {
          let current = node;
          while (current) {
            if (current.firstChild) {
              current = current.firstChild;
            } else {
              while (current && !current.nextSibling) current = current.parentNode;
              current = current?.nextSibling || null;
            }
            if (current?.nodeType === Node.TEXT_NODE) return current;
          }
          return null;
        }

        function addCandidate(list, value, score, type) {
          value = clean(value);
          if (!value || value.length < 2 || value.length > 220) return;

          if (/privacy|cookie|terms|sign in|login|create alert|similar jobs|saved jobs|job alert/i.test(value)) score -= 40;

          if (type === "title") {
            if (/careers at|all jobs|home|job search|open positions/i.test(value)) score -= 80;
            if (/intern|engineer|analyst|developer|technician|specialist|associate|consultant|administrator|manager|coordinator|assistant|cyber|security|data|software|information systems|support/i.test(value)) score += 25;
          }

          if (type === "location") {
            if (/\bUNAVAILABLE\b/i.test(value)) score -= 220;
            if (/,\s?[A-Z]{2}\b|remote|hybrid|on-site|onsite/i.test(value)) score += 35;
            if (/^location\s*:/i.test(value)) score += 55;
            if (/careers at|company|job title|salary/i.test(value)) score -= 90;
          }

          if (type === "salary") {
            if (/salary|compensation|pay range|base pay|hourly rate|stipend/i.test(value)) score += 45;
            if (/(?:\$|US\$|USD)\s*\d/i.test(value)) score += 55;
            if (/\b(hour|hr|hourly|year|yr|annual|annually|month|week)\b/i.test(value)) score += 30;
            if (/^salary\s*:/i.test(value)) score += 80;
            if (/\$?\s*0(?:\.0+)?\s*(?:-|–|—|to)\s*\$?\s*0(?:\.0+)?/i.test(value)) score -= 300;
            if (!/(?:\$|US\$|USD)\s*\d|\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*(?:\$|US\$|USD)?\s*\d/i.test(value)) score -= 100;
          }

          list.push({ value, score });
        }

        function bestCandidate(list, cleaner) {
          const seen = new Set();
          return list
            .map(item => ({ value: cleaner(item.value), score: item.score }))
            .filter(item => item.value)
            .filter(item => {
              const key = item.value.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort((a, b) => b.score - a.score)[0]?.value || "";
        }

        function findJobPosting(obj) {
          if (!obj || typeof obj !== "object") return null;
          if (Array.isArray(obj)) {
            for (const item of obj) {
              const found = findJobPosting(item);
              if (found) return found;
            }
          }
          if (obj["@graph"]) return findJobPosting(obj["@graph"]);
          const type = obj["@type"];
          return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")) ? obj : null;
        }

        function parseLocation(loc) {
          if (!loc) return "";
          const locations = Array.isArray(loc) ? loc : [loc];
          return locations.map(item => {
            const addr = item.address || item;
            if (typeof addr === "string") return cleanLocation(addr);
            return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
          }).filter(Boolean).join("; ");
        }

        const host = location.hostname.toLowerCase();
        const pageTitle = document.title || "";
        const bodyText = document.body?.innerText || "";
        const lines = bodyText.split("\n").map(clean).filter(Boolean);

        const titleCandidates = [];
        const companyCandidates = [];
        const locationCandidates = [];
        const salaryCandidates = [];

        // Prefer explicit visible label/value text over incomplete ATS metadata.
        addCandidate(locationCandidates, lineValue(/^Location\s*:\s*(.+)$/i), 310, "location");
        addCandidate(locationCandidates, labeledDomValue("Location"), 320, "location");
        addCandidate(locationCandidates, explicitVisibleLabelValue("Location", cleanLocation), 500, "location");

        const bodyLocationMatch = bodyText.match(/(?:^|\n)\s*Location\s*:\s*([^\n\r]+)/i);
        addCandidate(locationCandidates, bodyLocationMatch?.[1], 315, "location");

        addCandidate(salaryCandidates, lineValue(/^Salary\s*:\s*(.+)$/i), 280, "salary");
        addCandidate(salaryCandidates, lineValue(/^(?:Compensation|Pay Range|Base Pay|Hourly Rate)\s*:\s*(.+)$/i), 270, "salary");
        addCandidate(salaryCandidates, lineValue(/^Stipend\s*:\s*(.+)$/i), 300, "salary");

        const stipendMatch = bodyText.match(/\bstipend\s+of\s+((?:USD\s*)?(?:\$|US\$)?\s*\d[\d,]*(?:\.\d{1,2})?)/i);
        if (stipendMatch?.[1]) {
          addCandidate(salaryCandidates, `${stipendMatch[1]} stipend`, 330, "salary");
        }

        document.querySelectorAll("script[type='application/ld+json']").forEach(script => {
          try {
            const json = JSON.parse(script.textContent);
            const job = findJobPosting(json);
            if (job) {
              addCandidate(titleCandidates, job.title, 170, "title");
              addCandidate(companyCandidates, job.hiringOrganization?.name, 170, "company");
              addCandidate(locationCandidates, parseLocation(job.jobLocation), 170, "location");
              addCandidate(salaryCandidates, salaryFromStructuredValue(job.baseSalary), 220, "salary");
              addCandidate(salaryCandidates, salaryFromStructuredValue(job.estimatedSalary), 205, "salary");
            }
          } catch (e) {}
        });

        allText(["h1", "[data-automation-id='jobPostingHeader']", "[data-testid='job-title']", "[class*='job-title']", "[class*='posting-title']", "meta[property='og:title']", "meta[name='title']"])
          .forEach(v => addCandidate(titleCandidates, v, 100, "title"));

        allText(["[data-automation-id='company']", "[data-testid='company-name']", "[class*='company-name']", "[class*='employer']", "meta[property='og:site_name']", "meta[name='author']"])
          .forEach(v => addCandidate(companyCandidates, v, 95, "company"));

        allText(["[data-automation-id='locations']", "[data-automation-id='location']", "[data-testid='location']", "[class*='location']", "[class*='job-location']", "[class*='posting-location']"])
          .forEach(v => addCandidate(locationCandidates, v, 95, "location"));


        allText([
          "[data-automation-id='salary']",
          "[data-automation-id='compensation']",
          "[data-testid*='salary']",
          "[data-testid*='compensation']",
          "[class*='salary']",
          "[class*='compensation']",
          "[class*='pay-range']",
          "[class*='payRange']",
          "[aria-label*='salary' i]",
          "[aria-label*='compensation' i]"
        ]).forEach(v => addCandidate(salaryCandidates, v, 145, "salary"));

        if (host.includes("careers.aarp.org")) {
          const aarpLocation = bodyText.match(/Location\s*:\s*([^\n\r]+)/i)?.[1];
          addCandidate(locationCandidates, aarpLocation, 400, "location");
        }

        if (host.includes("jobs.gusto.com")) {
          addCandidate(companyCandidates, lines.find(line => /^careers at/i.test(line)), 190, "company");
          addCandidate(titleCandidates, firstText(["h1"]), 190, "title");
          addCandidate(locationCandidates, lines.find(line => /,\s?[A-Z]{2}\s*[·-]\s*(part time|full time|internship|contract)/i.test(line)), 190, "location");
        }

        if (host.includes("linkedin.com")) {
          allText([".job-details-jobs-unified-top-card__job-title h1", ".jobs-unified-top-card__job-title"]).forEach(v => addCandidate(titleCandidates, v, 180, "title"));
          allText([".job-details-jobs-unified-top-card__company-name a", ".jobs-unified-top-card__company-name a"]).forEach(v => addCandidate(companyCandidates, v, 180, "company"));
          firstText([".job-details-jobs-unified-top-card__primary-description-container", ".jobs-unified-top-card__primary-description"]).split("·").forEach(p => {
            if (/,\s?[A-Z]{2}\b|remote|hybrid|on-site/i.test(p)) addCandidate(locationCandidates, p, 180, "location");
          });
        }

        if (host.includes("myworkdayjobs.com")) {
          addCandidate(titleCandidates, firstText(["[data-automation-id='jobPostingHeader']", "h1"]), 175, "title");
          addCandidate(locationCandidates, firstText(["[data-automation-id='locations']", "[data-automation-id='location']"]), 175, "location");
          addCandidate(companyCandidates, pageTitle.split("-")[0], 110, "company");
          allText(["[data-automation-id='salary']", "[data-automation-id='compensation']", "[data-automation-id='jobPostingDescription']"])
            .forEach(v => addCandidate(salaryCandidates, v, 150, "salary"));
        }

        if (host.includes("greenhouse.io") || host.includes("boards.greenhouse")) {
          addCandidate(titleCandidates, firstText(["h1", ".app-title"]), 175, "title");
          addCandidate(companyCandidates, firstText(["meta[property='og:site_name']", ".company-name"]), 160, "company");
          addCandidate(locationCandidates, firstText([".location", "[class*='location']"]), 160, "location");
        }

        if (host.includes("lever.co")) {
          addCandidate(titleCandidates, firstText([".posting-headline h2", "h1"]), 175, "title");
          addCandidate(companyCandidates, firstText([".main-header-logo img", ".posting-company", "meta[property='og:site_name']"]), 160, "company");
          addCandidate(locationCandidates, firstText([".posting-categories .location", ".sort-by-location"]), 160, "location");
        }

        if (host.includes("ashbyhq.com") || host.includes("smartrecruiters.com") || host.includes("icims.com") || host.includes("oraclecloud.com") || host.includes("taleo.net")) {
          addCandidate(titleCandidates, firstText(["h1", "[class*='job-title']", "[class*='title']"]), 165, "title");
          addCandidate(companyCandidates, firstText(["meta[property='og:site_name']", "[class*='company']"]), 130, "company");
          addCandidate(locationCandidates, firstText(["[class*='location']", "[class*='job-location']", "[data-testid*='location']"]), 140, "location");
        }

        if (host.includes("boozallen.com")) {
          addCandidate(companyCandidates, "Booz Allen", 190, "company");
        }

        for (const line of lines.slice(0, 120)) {
          if (line.length >= 5 && line.length <= 140 && /intern|engineer|analyst|developer|technician|specialist|associate|consultant|administrator|manager|coordinator|assistant|cyber|security|data|software|information systems|support/i.test(line) && !/apply|sign in|login|privacy|cookie|similar jobs|job alert|saved jobs/i.test(line)) {
            addCandidate(titleCandidates, line, 60, "title");
          }
          if (/,\s?[A-Z]{2}\b|remote|hybrid|on-site|onsite/i.test(line)) {
            addCandidate(locationCandidates, line, 55, "location");
          }
          if (/^careers at/i.test(line)) {
            addCandidate(companyCandidates, line, 120, "company");
          }
          if (
            /(?:salary|compensation|pay range|base pay|hourly rate|stipend)/i.test(line) &&
            /(?:\$|US\$|USD)\s*\d/i.test(line)
          ) {
            addCandidate(salaryCandidates, line, 125, "salary");
          } else if (
            /(?:\$|US\$|USD)\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:-|–|—|to)\s*(?:\$|US\$|USD)?\s*\d[\d,]*(?:\.\d{1,2})?.*(?:hour|hr|year|yr|annual|month|week)/i.test(line)
          ) {
            addCandidate(salaryCandidates, line, 105, "salary");
          }
        }

        addCandidate(titleCandidates, pageTitle, 25, "title");

        let jobTitle = bestCandidate(titleCandidates, cleanTitle);
        let company = bestCandidate(companyCandidates, cleanCompany);
        let jobLocation = bestCandidate(locationCandidates, cleanLocation);
        let salary = bestCandidate(salaryCandidates, cleanSalary);

        // AARP pages include unrelated text such as "Hybrid Work Environment".
        // Always prefer the actual visible Location label/value pair.
        if (host.includes("careers.aarp.org")) {
          const explicitFromDom = explicitVisibleLabelValue("Location", cleanLocation);
          const explicitFromLine = cleanLocation(
            lines.find(line => /^Location\s*:/i.test(line))?.replace(/^Location\s*:\s*/i, "") || ""
          );
          const explicitFromText = cleanLocation(
            (document.body?.textContent || "").match(
              /Location\s*:\s*([A-Za-z][A-Za-z .'-]*,\s*(?:[A-Z]{2}|District of Columbia)(?:,\s*[A-Za-z][A-Za-z .'-]*)?)/i
            )?.[1] || ""
          );

          const explicitAarpLocation = explicitFromDom || explicitFromLine || explicitFromText;
          if (explicitAarpLocation) jobLocation = explicitAarpLocation;
        }

        if (company && jobTitle.toLowerCase().startsWith(company.toLowerCase())) {
          jobTitle = cleanTitle(jobTitle.slice(company.length));
        }

        return { jobTitle, company, location: jobLocation, salary };
      }
    },
    (results) => {
      const data = results?.[0]?.result;
      if (!data) return;
      document.getElementById("jobTitle").value = data.jobTitle || "";
      document.getElementById("company").value = data.company || "";
      document.getElementById("location").value = data.location || "";
      document.getElementById("salary").value = data.salary || "";
    }
  );
}


let pendingDuplicateSave = null;

function spreadsheetRowUrl(duplicate) {
  return `https://docs.google.com/spreadsheets/d/${duplicate.spreadsheetId}/edit#range=A${duplicate.rowNumber}:L${duplicate.rowNumber}`;
}

function showDuplicateModal(duplicate, saveAction) {
  pendingDuplicateSave = saveAction;

  const details = document.getElementById("duplicateDetails");
  details.innerHTML = "";

  const values = [
    ["Company", duplicate.company || "Unknown company"],
    ["Job Title", duplicate.jobTitle || "Unknown role"],
    ["Saved", duplicate.dateSubmitted || "Unknown date"],
    ["Row", String(duplicate.rowNumber || "Unknown")]
  ];

  for (const [label, value] of values) {
    const row = document.createElement("div");
    row.className = "duplicate-detail-row";

    const labelEl = document.createElement("span");
    labelEl.className = "duplicate-detail-label";
    labelEl.textContent = `${label}:`;

    const valueEl = document.createElement("span");
    valueEl.className = "duplicate-detail-value";
    valueEl.textContent = value;

    row.append(labelEl, valueEl);
    details.appendChild(row);
  }

  document.getElementById("duplicateModal").hidden = false;
  document.getElementById("openDuplicate").focus();
}

function closeDuplicateModal() {
  document.getElementById("duplicateModal").hidden = true;
  pendingDuplicateSave = null;
}

async function saveCurrentJob({ skipDuplicateCheck = false } = {}) {
  const tab = await getActiveTab();
  const settings = await getSettings();
  const status = document.getElementById("status");

  if (!settings.spreadsheetId) {
    status.innerText = "Connect a Google Sheet in settings first.";
    chrome.runtime.openOptionsPage();
    return;
  }

  const jobTitle = document.getElementById("jobTitle").value.trim();
  const company = document.getElementById("company").value.trim();
  const location = document.getElementById("location").value.trim();
  const salary = document.getElementById("salary").value.trim();
  const sheet = document.getElementById("sheet").value;
  const resumeUsed = document.getElementById("resumeUsed").value;
  const notes = document.getElementById("notes").value.trim();

  if (!jobTitle || !company) {
    status.innerText = "Add a job title and company first.";
    return;
  }

  if (!skipDuplicateCheck) {
    status.innerText = "Checking for duplicates...";
    const duplicate = await findDuplicateApplication(jobTitle, company, tab.url, sheet);
    if (duplicate) {
      status.innerText = "Duplicate found. Choose what to do.";
      showDuplicateModal(duplicate, () => saveCurrentJob({ skipDuplicateCheck: true }));
      document.getElementById("openDuplicate").dataset.url = spreadsheetRowUrl(duplicate);
      return;
    }
  }

  const row = [
    jobTitle,
    location,
    company,
    salary,
    todayMDY(),
    resumeUsed,
    notes,
    "Applied",
    "",
    "",
    tab.url,
    ""
  ];

  try {
    status.innerText = "Saving...";
    await appendApplication(row, sheet);

    const fileName = safeFileName(`${company} - ${jobTitle}`);
    status.innerText = `Saved ${company} — ${jobTitle}`;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [fileName],
      func: (fileName) => {
        const oldTitle = document.title;
        document.title = fileName;
        window.print();
        setTimeout(() => { document.title = oldTitle; }, 5000);
      }
    });
  } catch (error) {
    console.error(error);
    status.innerText = `Error saving: ${error.message || error}`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await applyPopupTheme();
  await loadPopupSettings();
  await autofillJobInfo();

  document.getElementById("settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("openSheet").addEventListener("click", async () => {
    const settings = await getSettings();
    if (!settings.spreadsheetId) {
      chrome.runtime.openOptionsPage();
      return;
    }
    chrome.tabs.create({
      url: settings.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}`
    });
  });

  document.getElementById("save").addEventListener("click", () => {
    saveCurrentJob().catch(error => {
      console.error(error);
      document.getElementById("status").innerText = `Error: ${error.message || error}`;
    });
  });

  document.getElementById("openDuplicate").addEventListener("click", event => {
    const url = event.currentTarget.dataset.url;
    if (url) chrome.tabs.create({ url });
    closeDuplicateModal();
  });

  document.getElementById("saveDuplicateAnyway").addEventListener("click", async () => {
    const action = pendingDuplicateSave;
    closeDuplicateModal();
    if (action) await action();
  });

  document.getElementById("cancelDuplicate").addEventListener("click", () => {
    closeDuplicateModal();
    document.getElementById("status").innerText = "Save cancelled.";
  });
});
