const express = require('express');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = 'abc@123'; // keep in sync with main.js

function getDataDir() {
  const docsDir = path.join(os.homedir(), 'Documents', 'CanteenTimeIn');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
    console.log('Created data folder: ' + docsDir);
  }
  return docsDir;
}

const DATA_DIR    = getDataDir();
const EXCEL_FILE  = path.join(DATA_DIR, 'canteen_log.xlsx');
const ROSTER_FILE = path.join(DATA_DIR, 'employee.csv');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function ensureRoster() {
  if (!fs.existsSync(ROSTER_FILE)) {
    const bundledRoster = path.join(__dirname, 'employee.csv');
    if (fs.existsSync(bundledRoster)) {
      fs.copyFileSync(bundledRoster, ROSTER_FILE);
      console.log('Copied default employee.csv to: ' + ROSTER_FILE);
    } else {
      throw new Error('employee.csv not found. Please place it in: ' + DATA_DIR);
    }
  }
}

function loadRoster() {
  ensureRoster();
  const content = fs.readFileSync(ROSTER_FILE, 'utf8');
  const records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
  const roster = {};
  records.forEach(function(r) {
    const id   = (r.EmployeeID   || r.employeeid   || r['Employee ID']   || '').trim();
    const name = (r.EmployeeName || r.employeename || r['Employee Name'] || '').trim();
    if (id && name) roster[id] = name;
  });
  return roster;
}

function readExcel() {
  if (!fs.existsSync(EXCEL_FILE)) return [];
  try {
    const wb = xlsx.readFile(EXCEL_FILE);
    const ws = wb.Sheets['Canteen Log'];
    if (!ws) return [];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    if (data.length <= 1) return [];
    return data.slice(1).map(function(row) {
      return {
        id:   String(row[1] || ''),
        name: String(row[2] || ''),
        time: String(row[3] || ''),
        date: String(row[4] || '')
      };
    }).filter(function(e) { return e.id; });
  } catch (e) {
    console.error('Error reading Excel:', e.message);
    return [];
  }
}

function writeExcel(entries) {
  const header = ['#', 'Employee ID', 'Full Name', 'Time In', 'Date'];
  const rows   = entries.map(function(e, i) { return [i + 1, e.id, e.name, e.time, e.date]; });
  const wb     = xlsx.utils.book_new();
  const ws     = xlsx.utils.aoa_to_sheet([header].concat(rows));
  ws['!cols']  = [{ wch: 5 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 14 }];
  xlsx.utils.book_append_sheet(wb, ws, 'Canteen Log');
  xlsx.writeFile(wb, EXCEL_FILE);
}

function buildWorkbook(subset) {
  const header = ['#', 'Employee ID', 'Full Name', 'Time In', 'Date'];
  const rows   = subset.map(function(e, i) { return [i + 1, e.id, e.name, e.time, e.date]; });
  const wb     = xlsx.utils.book_new();
  const ws     = xlsx.utils.aoa_to_sheet([header].concat(rows));
  ws['!cols']  = [{ wch: 5 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 14 }];
  xlsx.utils.book_append_sheet(wb, ws, 'Canteen Log');
  return wb;
}

function todayString() {
  return new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
}

// Convert YYYY-MM-DD → display format used when saving (e.g. "Apr 22, 2025")
function isoToDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return d.toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC'
  });
}

// Build a Set of all display-format dates between from and to (inclusive)
function buildDateSet(fromIso, toIso) {
  const set    = new Set();
  const cursor = new Date(fromIso + 'T12:00:00Z');
  const end    = new Date(toIso   + 'T12:00:00Z');
  while (cursor <= end) {
    set.add(cursor.toLocaleDateString('en-PH', {
      year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC'
    }));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return set;
}

let entries = readExcel();
console.log('Data folder: ' + DATA_DIR);
console.log('Loaded ' + entries.length + ' existing entries from: ' + EXCEL_FILE);

// ── GET /api/entries ───────────────────────────────────────────────────────
app.get('/api/entries', function(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ entries: entries.slice().reverse() });
});

// ── GET /api/dates ─────────────────────────────────────────────────────────
app.get('/api/dates', function(req, res) {
  const dateSet = new Set();
  entries.forEach(function(e) { if (e.date) dateSet.add(e.date); });
  res.json({ dates: Array.from(dateSet).sort() });
});

// ── POST /api/verify-password ──────────────────────────────────────────────
app.post('/api/verify-password', function(req, res) {
  const { password } = req.body;
  res.json({ ok: password === PASSWORD });
});

// ── GET /api/employees ─────────────────────────────────────────────────────
app.get('/api/employees', function(req, res) {
  try {
    const roster = loadRoster();
    const list = Object.entries(roster).map(function([id, name]) { return { id, name }; });
    res.json({ employees: list });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees ────────────────────────────────────────────────────
app.post('/api/employees', function(req, res) {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required.' });

  try {
    ensureRoster();
    const content = fs.readFileSync(ROSTER_FILE, 'utf8');
    const records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
    const existing = records.find(function(r) {
      return (r.EmployeeID || '').trim().toUpperCase() === id.trim().toUpperCase();
    });
    if (existing) {
      existing.EmployeeName = name.trim();
    } else {
      records.push({ EmployeeID: id.trim().toUpperCase(), EmployeeName: name.trim() });
    }
    const header = 'EmployeeID,EmployeeName\n';
    const rows   = records.map(function(r) {
      return r.EmployeeID + ',' + r.EmployeeName;
    }).join('\n');
    fs.writeFileSync(ROSTER_FILE, header + rows, 'utf8');
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/employees/:id ──────────────────────────────────────────────
app.delete('/api/employees/:id', function(req, res) {
  const targetId = req.params.id.toUpperCase();
  try {
    ensureRoster();
    const content = fs.readFileSync(ROSTER_FILE, 'utf8');
    let records   = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
    records       = records.filter(function(r) {
      return (r.EmployeeID || '').trim().toUpperCase() !== targetId;
    });
    const header = 'EmployeeID,EmployeeName\n';
    const rows   = records.map(function(r) {
      return r.EmployeeID + ',' + r.EmployeeName;
    }).join('\n');
    fs.writeFileSync(ROSTER_FILE, header + rows, 'utf8');
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/download/all ──────────────────────────────────────────────────
app.get('/api/download/all', function(req, res) {
  if (entries.length === 0) {
    return res.status(404).json({ error: 'No logs available to download.' });
  }
  try {
    const wb     = buildWorkbook(entries);
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="canteen_log_all.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate Excel: ' + e.message });
  }
});

// ── GET /api/download/day?date=YYYY-MM-DD ──────────────────────────────────
app.get('/api/download/day', function(req, res) {
  const isoDate = req.query.date;
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return res.status(400).json({ error: 'Please provide a valid date (YYYY-MM-DD).' });
  }
  const displayDate = isoToDisplayDate(isoDate);
  const filtered    = entries.filter(function(e) { return e.date === displayDate; });
  if (filtered.length === 0) {
    return res.status(404).json({ error: 'No logs found for ' + displayDate + '.' });
  }
  try {
    const wb       = buildWorkbook(filtered);
    const buffer   = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="canteen_log_' + isoDate + '.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate Excel: ' + e.message });
  }
});

// ── GET /api/download/range-check ─────────────────────────────────────────
app.get('/api/download/range-check', function(req, res) {
  const fromIso = req.query.from;
  const toIso   = req.query.to;

  if (!fromIso || !toIso ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fromIso) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    return res.status(400).json({ error: 'Invalid date parameters.' });
  }
  if (fromIso > toIso) {
    return res.status(400).json({ error: '"From" must not be after "To".' });
  }

  const datesWithData = new Set(entries.map(function(e) { return e.date; }).filter(Boolean));
  const rangeSet = buildDateSet(fromIso, toIso);
  const missingDates = Array.from(rangeSet).filter(function(d) {
    return !datesWithData.has(d);
  });

  let nearestAvailable = [];
  if (missingDates.length > 0 && datesWithData.size > 0) {
    const sortedAvailable = Array.from(datesWithData).sort(function(a, b) {
      return new Date(a) - new Date(b);
    });
    const fromDisplay = isoToDisplayDate(fromIso);
    const toDisplay   = isoToDisplayDate(toIso);
    const before = sortedAvailable.filter(function(d) { return d < fromDisplay; });
    const after  = sortedAvailable.filter(function(d) { return d > toDisplay; });
    if (before.length > 0) nearestAvailable.push(before[before.length - 1]);
    if (after.length  > 0) nearestAvailable.push(after[0]);
  }

  res.json({ missingDates: missingDates, nearestAvailable: nearestAvailable });
});

// ── GET /api/download/range?from=YYYY-MM-DD&to=YYYY-MM-DD ─────────────────
app.get('/api/download/range', function(req, res) {
  const fromIso = req.query.from;
  const toIso   = req.query.to;

  if (!fromIso || !toIso ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fromIso) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    return res.status(400).json({ error: 'Please provide valid from and to dates (YYYY-MM-DD).' });
  }
  if (fromIso > toIso) {
    return res.status(400).json({ error: '"From" date must not be after "To" date.' });
  }

  const inRange  = buildDateSet(fromIso, toIso);
  const filtered = entries.filter(function(e) { return inRange.has(e.date); });

  if (filtered.length === 0) {
    return res.status(404).json({ error: 'No logs found in the selected date range.' });
  }

  try {
    const wb       = buildWorkbook(filtered);
    const buffer   = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = 'canteen_log_' + fromIso + '_to_' + toIso + '.xlsx';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate Excel: ' + e.message });
  }
});

// ── GET /api/download (backward compat) ───────────────────────────────────
app.get('/api/download', function(req, res) {
  if (!fs.existsSync(EXCEL_FILE)) return res.status(404).json({ error: 'No Excel file yet.' });
  res.download(EXCEL_FILE, 'canteen_log.xlsx');
});

// ── POST /api/scan ─────────────────────────────────────────────────────────
app.post('/api/scan', function(req, res) {
  const employeeId = req.body.employeeId;
  if (!employeeId) return res.status(400).json({ error: 'No employee ID provided.' });

  let roster;
  try   { roster = loadRoster(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const id   = employeeId.trim().toUpperCase();
  const name = roster[id];
  if (!name) return res.status(404).json({ error: 'Employee ID "' + id + '" not found in roster.' });

  const now   = new Date();
  const today = now.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  const alreadyScanned = entries.find(function(e) { return e.id === id && e.date === today; });
  if (alreadyScanned) {
    return res.status(409).json({ error: name + ' already scanned today at ' + alreadyScanned.time + '.' });
  }

  const time  = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const entry = { id: id, name: name, time: time, date: today };
  entries.push(entry);

  try {
    writeExcel(entries);
    console.log('[' + today + ' ' + time + '] Logged: ' + name + ' (' + id + ')');
    res.json({ success: true, entry: entry });
  } catch (e) {
    entries.pop();
    res.status(500).json({ error: 'Failed to save to Excel: ' + e.message });
  }
});

app.listen(PORT, '127.0.0.1', function() {
  console.log('Server running at http://localhost:' + PORT);
});
