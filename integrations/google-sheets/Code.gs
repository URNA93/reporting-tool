function doGet() {
  return json_({ ok: true, service: "GFS Reporting → Google Sheets" });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    const expected = PropertiesService.getScriptProperties().getProperty("GFS_SECRET");
    if (!expected || payload.secret !== expected) {
      return json_({ ok: false, error: "unauthorized" });
    }
    if (payload.action === "report") {
      writeReport_(payload.report, payload.user, payload.items || []);
    } else if (payload.action === "delete_item") {
      deleteByKey_(spreadsheet_().getSheetByName("Položky"), payload.itemId, 2);
    } else if (payload.action === "delete_report") {
      const spreadsheet = spreadsheet_();
      deleteByKey_(spreadsheet.getSheetByName("Reporty"), payload.reportId, 1);
      deleteByKey_(spreadsheet.getSheetByName("Položky"), payload.reportId, 1);
    } else {
      return json_({ ok: false, error: "unknown_action" });
    }
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function writeReport_(report, user, items) {
  const spreadsheet = spreadsheet_();
  upsert_(spreadsheet.getSheetByName("Reporty"), report.id, [
    report.id,
    new Date(report.createdAt),
    asDate_(report.periodStart),
    asDate_(report.periodEnd),
    user.email,
    user.name,
    report.summary || "",
    "Odesláno",
    new Date(report.updatedAt),
  ]);

  const itemSheet = spreadsheet.getSheetByName("Položky");
  items.forEach(function (item) {
    upsert_(itemSheet, item.id, [
      report.id,
      item.id,
      typeLabel_(item.type),
      item.personName,
      item.description || "",
      item.amount === null ? "" : item.amount,
      item.unit || "",
      item.dueDate ? asDate_(item.dueDate) : "",
      item.dueTime || "",
      statusLabel_(item.status),
      item.note || "",
      user.email,
      new Date(item.createdAt),
    ], 2);
  });

  upsert_(spreadsheet.getSheetByName("Lidé"), user.email, [
    user.email,
    user.name,
    user.role === "admin" ? "správce" : user.role === "manager" ? "manažer" : user.role === "viewer" ? "čtenář" : "uživatel",
    true,
    new Date(),
    new Date(),
  ]);
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("GFS_SPREADSHEET_ID");
  if (!id) throw new Error("Chybí vlastnost skriptu GFS_SPREADSHEET_ID.");
  return SpreadsheetApp.openById(id);
}

function upsert_(sheet, key, values, keyColumn) {
  keyColumn = keyColumn || 1;
  const lastRow = sheet.getLastRow();
  const keys = lastRow > 1
    ? sheet.getRange(2, keyColumn, lastRow - 1, 1).getDisplayValues().flat()
    : [];
  const found = keys.indexOf(String(key));
  const row = found >= 0 ? found + 2 : lastRow + 1;
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
}

function deleteByKey_(sheet, key, keyColumn) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const keys = sheet.getRange(2, keyColumn, lastRow - 1, 1).getDisplayValues().flat();
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    if (keys[index] === String(key)) sheet.deleteRow(index + 2);
  }
}

function asDate_(yyyyMmDd) {
  const parts = String(yyyyMmDd).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
}

function typeLabel_(value) {
  return ({ project: "Projekt", fall: "Přepad", analysis: "Analýza", consulting: "Poradenství", intro: "Úvodní rozhovor" })[value] || value;
}

function statusLabel_(value) {
  return ({
    new: "Nové",
    in_progress: "Rozpracováno",
    active: "Aktivní",
    completed: "Dokončeno",
    scheduled: "Domluveno",
    done: "Hotovo",
    cancelled: "Zrušeno",
  })[value] || value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
