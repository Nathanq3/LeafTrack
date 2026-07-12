const CLIENT_ID = "435235707519-u343hakanceffng43k67plhr8de5ti93.apps.googleusercontent.com";

const DEFAULT_HEADERS = [
  "Job Title",
  "Location",
  "Company",
  "Salary",
  "Date Submitted",
  "Resume Used",
  "Notes",
  "Initial Status",
  "Secondary Status",
  "Third Status",
  "Link",
  "Current Status"
];

const DEFAULT_RESUMES = [];

async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, token => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("No auth token"));
      } else {
        resolve(token);
      }
    });
  });
}

async function googleFetch(url, options = {}, interactive = true) {
  const token = await getAuthToken(interactive);

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  return response;
}

async function getSettings() {
  const settings = await chrome.storage.sync.get([
    "spreadsheetId",
    "spreadsheetUrl",
    "tabNames",
    "defaultTab",
    "resumeNames",
    "gmailSyncEnabled",
    "lastGmailSync"
  ]);

  return {
    spreadsheetId: settings.spreadsheetId || "",
    spreadsheetUrl: settings.spreadsheetUrl || "",
    tabNames: settings.tabNames || ["Applications"],
    defaultTab: settings.defaultTab || "Applications",
    resumeNames: settings.resumeNames || DEFAULT_RESUMES,
    gmailSyncEnabled: settings.gmailSyncEnabled === true,
    lastGmailSync: settings.lastGmailSync || ""
  };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
}

function todayMDY() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function escapeSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function createLeafTrackSpreadsheet(tabNames, resumeNames) {
  const body = {
    properties: { title: "LeafTrack Applications" },
    sheets: tabNames.map(name => ({
      properties: { title: name }
    }))
  };

  const createResponse = await googleFetch(
    "https://sheets.googleapis.com/v4/spreadsheets",
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );

  const spreadsheet = await createResponse.json();

  for (const tab of tabNames) {
    await setupSheetTab(spreadsheet.spreadsheetId, tab);
  }

  await saveSettings({
    spreadsheetId: spreadsheet.spreadsheetId,
    spreadsheetUrl: spreadsheet.spreadsheetUrl,
    tabNames,
    defaultTab: tabNames[0],
    resumeNames
  });

  return spreadsheet;
}

async function ensureSheetColumnOrder(spreadsheetId, tabName) {
  const sheetName = escapeSheetName(tabName);
  const range = `${sheetName}!A12:L`;
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`
  );

  const data = await response.json();
  const rows = data.values || [];
  const currentHeaders = rows[0] || [];

  const alreadyCorrect = DEFAULT_HEADERS.every(
    (header, index) => currentHeaders[index] === header
  );

  if (alreadyCorrect) return;

  const headerIndex = new Map(
    currentHeaders.map((header, index) => [header, index])
  );

  const reordered = [DEFAULT_HEADERS];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const sourceRow = rows[rowIndex] || [];
    const sheetRowNumber = rowIndex + 12;

    const targetRow = DEFAULT_HEADERS.map(header => {
      if (header === "Current Status") {
        return `=IF(J${sheetRowNumber}<>"",J${sheetRowNumber},IF(I${sheetRowNumber}<>"",I${sheetRowNumber},H${sheetRowNumber}))`;
      }

      const sourceIndex = headerIndex.get(header);
      return sourceIndex === undefined ? "" : (sourceRow[sourceIndex] || "");
    });

    reordered.push(targetRow);
  }

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    { method: "POST", body: JSON.stringify({}) }
  );

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A12:L${11 + reordered.length}`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: reordered })
    }
  );
}

async function setupSheetTab(spreadsheetId, tabName) {
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const sheet = metadata.sheets.find(s => s.properties.title === tabName);
  if (!sheet) throw new Error("Could not find sheet tab: " + tabName);

  const sheetId = sheet.properties.sheetId;

  await ensureSheetColumnOrder(spreadsheetId, tabName);

  const dashboard = [
    ["LeafTrack", "", "Summary", ""],
    ["", "", "Applied", '=COUNTIF(L13:L,"Applied")'],
    ["", "", "Not Applied", '=COUNTIF(L13:L,"Not Applied")'],
    ["", "", "Gov Resume Required", '=COUNTIF(L13:L,"Gov Resume Required")'],
    ["", "", "Pending", '=COUNTIF(L13:L,"Pending")'],
    ["", "", "Rejected", '=COUNTIF(L13:L,"Rejected")'],
    ["", "", "Screening", '=COUNTIF(L13:L,"Screening")'],
    ["", "", "Interview", '=COUNTIF(L13:L,"Interview")'],
    ["", "", "Offer Extended", '=COUNTIF(L13:L,"Offer Extended")'],
    ["", "", "Closed", '=COUNTIF(L13:L,"Closed")']
  ];

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${escapeSheetName(tabName)}!A1:D10`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: dashboard })
    }
  );

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${escapeSheetName(tabName)}!A12:L12`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [DEFAULT_HEADERS] })
    }
  );



  const requests = [
  {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 2
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            bold: true,
            fontSize: 26,
            foregroundColor: { red: 0.31, green: 0.36, blue: 0.23 }
          },
          horizontalAlignment: "LEFT"
        }
      },
      fields: "userEnteredFormat(textFormat,horizontalAlignment)"
    }
  },

  {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 2,
        endColumnIndex: 4
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.55, green: 0.75, blue: 0.28 },
          textFormat: { bold: true },
          horizontalAlignment: "CENTER",
          borders: {
            top: { style: "SOLID" },
            bottom: { style: "SOLID" },
            left: { style: "SOLID" },
            right: { style: "SOLID" }
          }
        }
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,borders)"
    }
  },
  {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 10,
        startColumnIndex: 2,
        endColumnIndex: 4
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.90, green: 0.95, blue: 0.85 },
          textFormat: { bold: true },
          horizontalAlignment: "CENTER",
          borders: {
            top: { style: "SOLID" },
            bottom: { style: "SOLID" },
            left: { style: "SOLID" },
            right: { style: "SOLID" }
          }
        }
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,borders)"
    }
  },

  {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 11,
        endRowIndex: 12,
        startColumnIndex: 0,
        endColumnIndex: 12
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.65, green: 0.65, blue: 0.65 },
          textFormat: { bold: true },
          horizontalAlignment: "CENTER"
        }
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
    }
  },

  {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 12,
        endRowIndex: 500,
        startColumnIndex: 0,
        endColumnIndex: 12
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { bold: false },
          horizontalAlignment: "LEFT"
        }
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
    }
  },

  {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 12,
        endRowIndex: 500,
        startColumnIndex: 7,
        endColumnIndex: 8
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: [
            { userEnteredValue: "Applied" },
            { userEnteredValue: "Gov Resume Required" },
            { userEnteredValue: "Not Applied" },
            { userEnteredValue: "Closed" }
          ]
        },
        showCustomUi: true,
        strict: false
      }
    }
  },
  {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 12,
        endRowIndex: 500,
        startColumnIndex: 8,
        endColumnIndex: 9
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: [
            { userEnteredValue: "Pending" },
            { userEnteredValue: "Rejected" },
            { userEnteredValue: "Screening" },
            { userEnteredValue: "Interview" }
          ]
        },
        showCustomUi: true,
        strict: false
      }
    }
  },
  {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 12,
        endRowIndex: 500,
        startColumnIndex: 9,
        endColumnIndex: 10
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: [
            { userEnteredValue: "Pending" },
            { userEnteredValue: "Rejected" },
            { userEnteredValue: "Interview" },
            { userEnteredValue: "Offer Extended" }
          ]
        },
        showCustomUi: true,
        strict: false
      }
    }
  },

  ...makeStatusColorRules(sheetId),

  {
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          frozenRowCount: 12
        }
      },
      fields: "gridProperties.frozenRowCount"
    }
  },
  {
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: 11,
          startColumnIndex: 0,
          endColumnIndex: 12
        }
      }
    }
  },
  {
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 0,
        endIndex: 12
      }
    }
  },
  {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 10,
        endIndex: 11
      },
      properties: {
        pixelSize: 1000
      },
      fields: "pixelSize"
    }
  },
  {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 11,
        endIndex: 12
      },
      properties: {
        pixelSize: 160
      },
      fields: "pixelSize"
    }
  },
  {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: 3,
        endIndex: 4
      },
      properties: {
        pixelSize: 170
      },
      fields: "pixelSize"
    }
  }
];

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests })
    }
  );
}

function makeStatusColorRules(sheetId) {
  const colors = {
    Applied: {
      bg: { red: 0.78, green: 0.89, blue: 1.00 },
      fg: { red: 0.05, green: 0.32, blue: 0.68 }
    },
    "Gov Resume Required": {
      bg: { red: 0.94, green: 0.86, blue: 0.70 },
      fg: { red: 0.45, green: 0.28, blue: 0.05 }
    },
    "Not Applied": {
      bg: { red: 1.00, green: 0.80, blue: 0.80 },
      fg: { red: 0.72, green: 0.00, blue: 0.00 }
    },
    Closed: {
      bg: { red: 0.88, green: 0.78, blue: 0.96 },
      fg: { red: 0.35, green: 0.16, blue: 0.55 }
    },
    Pending: {
      bg: { red: 1.00, green: 0.89, blue: 0.55 },
      fg: { red: 0.45, green: 0.28, blue: 0.00 }
    },
    Rejected: {
      bg: { red: 0.82, green: 0.05, blue: 0.05 },
      fg: { red: 1.00, green: 1.00, blue: 1.00 }
    },
    Screening: {
      bg: { red: 0.80, green: 0.90, blue: 1.00 },
      fg: { red: 0.00, green: 0.32, blue: 0.60 }
    },
    Interview: {
      bg: { red: 0.80, green: 0.92, blue: 0.78 },
      fg: { red: 0.12, green: 0.42, blue: 0.12 }
    },
    "Offer Extended": {
      bg: { red: 0.88, green: 0.78, blue: 0.96 },
      fg: { red: 0.35, green: 0.16, blue: 0.55 }
    }
  };

  const ranges = [
    { startColumnIndex: 7, endColumnIndex: 8 },
    { startColumnIndex: 8, endColumnIndex: 9 },
    { startColumnIndex: 9, endColumnIndex: 10 },
    { startColumnIndex: 11, endColumnIndex: 12 }
  ];

  const rules = [];

  for (const [status, color] of Object.entries(colors)) {
    for (const range of ranges) {
      rules.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 12,
                endRowIndex: 500,
                startColumnIndex: range.startColumnIndex,
                endColumnIndex: range.endColumnIndex
              }
            ],
            booleanRule: {
              condition: {
                type: "TEXT_EQ",
                values: [{ userEnteredValue: status }]
              },
              format: {
                backgroundColor: color.bg,
                textFormat: {
                  foregroundColor: color.fg,
                  bold: true
                }
              }
            }
          },
          index: 0
        }
      });
    }
  }

  return rules;
}

async function getSpreadsheetMetadata(spreadsheetId) {
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,spreadsheetUrl,sheets.properties.title,sheets.properties.sheetId`
  );

  return await response.json();
}

async function connectExistingSpreadsheet(spreadsheetId) {
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const tabNames = metadata.sheets.map(s => s.properties.title);

  await saveSettings({
    spreadsheetId,
    spreadsheetUrl: metadata.spreadsheetUrl,
    tabNames,
    defaultTab: tabNames[0]
  });

  return metadata;
}

async function appendApplication(row, tabName) {
  const settings = await getSettings();

  if (!settings.spreadsheetId) {
    throw new Error("No spreadsheet connected.");
  }

  const sheetName = escapeSheetName(tabName);

  await ensureSheetColumnOrder(settings.spreadsheetId, tabName);

  const readResponse = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A13:A`)}`
  );

  const readData = await readResponse.json();
  const existingRows = readData.values || [];

  const rowNumber = 13 + existingRows.length;


  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A${rowNumber}:L${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [row] })
    }
  );

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(`${sheetName}!L${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({
        values: [[`=IF(J${rowNumber}<>"",J${rowNumber},IF(I${rowNumber}<>"",I${rowNumber},H${rowNumber}))`]]
      })
    }
  );

  const metadata = await getSpreadsheetMetadata(settings.spreadsheetId);
  const sheet = metadata.sheets.find(s => s.properties.title === tabName);
  const sheetId = sheet.properties.sheetId;
  const rowIndex = rowNumber - 1;

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 0,
                endColumnIndex: 12
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 1, green: 1, blue: 1 },
                  textFormat: { bold: false },
                  horizontalAlignment: "LEFT"
                }
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
            }
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: 12
              }
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: 10,
                endIndex: 11
              },
              properties: {
                pixelSize: 1000
              },
              fields: "pixelSize"
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: 3,
                endIndex: 4
              },
              properties: {
                pixelSize: 170
              },
              fields: "pixelSize"
            }
          }
        ]
      })
    }
  );
}


async function findDuplicateApplication(jobTitle, company, link, tabName) {
  const settings = await getSettings();
  if (!settings.spreadsheetId) return null;

  const range = `${escapeSheetName(tabName)}!A13:L`;
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${settings.spreadsheetId}/values/${encodeURIComponent(range)}`
  );
  const data = await response.json();
  const rows = data.values || [];

  const wantedTitle = normalizeText(jobTitle);
  const wantedCompany = normalizeCompany(company);
  const wantedLink = String(link || "").trim().replace(/\/$/, "");

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] || [];
    const rowTitle = normalizeText(row[0] || "");
    const rowCompany = normalizeCompany(row[2] || "");
    const rowLink = String(row[10] || "").trim().replace(/\/$/, "");

    const sameTitleCompany =
      wantedTitle && wantedCompany && rowTitle === wantedTitle && rowCompany === wantedCompany;
    const sameLink = wantedLink && rowLink && rowLink === wantedLink;

    if (sameTitleCompany || sameLink) {
      return {
        tabName,
        rowNumber: index + 13,
        jobTitle: row[0] || jobTitle,
        company: row[2] || company,
        dateSubmitted: row[4] || "",
        link: row[10] || link,
        spreadsheetId: settings.spreadsheetId
      };
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/&/g, "and")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(value) {
  return normalizeText(value)
    .replace(/\binc\b/g, "")
    .replace(/\bllc\b/g, "")
    .replace(/\bltd\b/g, "")
    .replace(/\bco\b/g, "")
    .replace(/\bcorp\b/g, "")
    .replace(/\bcorporation\b/g, "")
    .replace(/\bcompany\b/g, "")
    .replace(/\bgroup\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyEmail(text) {
  const t = normalizeText(text);

  const patterns = {
    offer: [
      "offer you",
      "offer of employment",
      "offer extended",
      "pleased to offer",
      "excited to offer",
      "we are excited to offer",
      "welcome to the team",
      "congratulations we would like to offer"
    ],
    interview: [
      "schedule an interview",
      "invite you to interview",
      "interview invitation",
      "would like to interview",
      "next step is an interview",
      "meet with the team",
      "availability for an interview"
    ],
    screening: [
      "phone screen",
      "phone screening",
      "recruiter screen",
      "screening call",
      "initial call",
      "hr call",
      "recruiter call",
      "phone interview"
    ],
    assessment: [
      "assessment",
      "coding challenge",
      "technical assessment",
      "technical challenge",
      "hackerrank",
      "take home",
      "take-home",
      "skills test"
    ],
    rejection: [
      "unfortunately",
      "not selected",
      "not moving forward",
      "not move you forward",
      "move forward with other candidates",
      "moving forward with other candidates",
      "decided to move forward with other candidates",
      "no longer under consideration",
      "position has been filled",
      "unable to offer",
      "we regret to inform",
      "not be proceeding",
      "not proceed",
      "not a match"
    ]
  };

  for (const [type, phrases] of Object.entries(patterns)) {
    if (phrases.some(phrase => t.includes(phrase))) {
      return type;
    }
  }

  return null;
}

function emailTypeToStatus(type) {
  const statusMap = {
    rejection: "Rejected",
    interview: "Interview",
    screening: "Screening",
    assessment: "Screening",
    offer: "Offer Extended"
  };

  return statusMap[type] || null;
}

function isRejectionText(text) {
  return classifyEmail(text) === "rejection";
}


function getImportantWords(title) {
  const stopWords = new Set([
    "intern",
    "internship",
    "full",
    "time",
    "fulltime",
    "part",
    "parttime",
    "summer",
    "fall",
    "spring",
    "winter",
    "remote",
    "hybrid",
    "onsite",
    "entry",
    "level",
    "program",
    "year",
    "early",
    "career",
    "associate",
    "position",
    "role"
  ]);

  return normalizeText(title)
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ""))
    .filter(w => w.length >= 4 && !stopWords.has(w));
}
