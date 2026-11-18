import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("JobsTrackerPanel reads from collections.list('job-tracker') without client-side route changes", () => {
  const panel = read("src/components/JobsTrackerPanel.jsx");
  assert.match(panel, /collections\.list\("job-tracker"\)/);
  assert.match(panel, /data-evidence="jobs-tracker-panel"/);
  assert.match(panel, /data-evidence="jobs-export-csv"/);
});

test("JobsTrackerPanel columns match operational lifecycle requirements", () => {
  const panel = read("src/components/JobsTrackerPanel.jsx");
  for (const col of ["Job / Quote", "Client & Site", "Stage", "PO Status", "Dispatch", "Actual Hours"]) {
    assert.ok(panel.includes(`"${col}"`), `Missing column: ${col}`);
  }
});

test("JobsTrackerPanel strictly omits monetary figures and rates from display and export", () => {
  const panel = read("src/components/JobsTrackerPanel.jsx");
  assert.doesNotMatch(panel, /formatMoney/);
  assert.doesNotMatch(panel, /formatSignedMoney/);
  assert.doesNotMatch(panel, /total_amount/);
  assert.doesNotMatch(panel, /rate/i);
});

test("ReportsPage embeds Jobs tab with correct role permissions", () => {
  const page = read("src/pages/ReportsPage.jsx");
  assert.match(page, /key:\s*"jobs",\s*label:\s*"Jobs",\s*roles:\s*\["Admin",\s*"Management",\s*"Sales",\s*"Operations",\s*"Finance"\]/);
  assert.match(page, /<JobsTrackerPanel user=\{user\} \/>/);
});
