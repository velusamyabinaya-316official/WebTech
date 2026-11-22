// =====================================================
// LifeFlow Blood Bank – page scripts (DOM manipulation)
// =====================================================

/* ---------- Small helpers ---------- */
const $ = id => document.getElementById(id);

// Escape user text before putting it into innerHTML (prevents HTML injection)
function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// Toast notification: created, appended, then removed from the DOM
function toast(text, type = "success") {
  let box = $("toastBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "toastBox";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.setAttribute("role", "status");
  t.textContent = text;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------- Form date limits & validation helpers ---------- */
const today = new Date().toISOString().split("T")[0];
$("date").min = today;
$("dob").max = today;
$("lastdonation").max = today;

const pw = $("password");
const cf = $("confirm");
function checkMatch() {
  cf.setCustomValidity(pw.value !== cf.value ? "Passwords do not match" : "");
}
pw.addEventListener("input", checkMatch);
cf.addEventListener("input", checkMatch);

// "None of the above" should not be combined with other conditions
const boxes = document.querySelectorAll("input[name='conditions']");
boxes.forEach(b => b.addEventListener("change", () => {
  if (b.value === "none" && b.checked) {
    boxes.forEach(o => { if (o !== b) o.checked = false; });
  } else if (b.checked) {
    $("c5").checked = false;
  }
}));

/* =====================================================
   1. BLOOD STOCK  –  modify table cells dynamically
   ===================================================== */
const stockRows = document.querySelectorAll("#availability tbody tr");
const stockGroup = $("stockGroup");

// Fill the dropdown from the table itself (createElement + appendChild)
stockRows.forEach(row => {
  const group = row.cells[0].textContent.trim();
  const opt = document.createElement("option");
  opt.setAttribute("value", group);
  opt.textContent = group;
  stockGroup.appendChild(opt);
});

function getRow(group) {
  return Array.from(stockRows).find(r => r.cells[0].textContent.trim() === group);
}
function getStock(group) {
  return parseInt(getRow(group).cells[1].textContent, 10);
}
function statusFor(units) {
  if (units <= 5)  return ["critical", "Critical"];
  if (units <= 15) return ["low", "Low"];
  return ["high", "Adequate"];
}

function setStock(group, units) {
  const row = getRow(group);
  units = Math.max(0, units);
  row.cells[1].textContent = units;                    // modify units
  const [cls, label] = statusFor(units);               // modify status
  row.cells[2].className = cls;
  row.cells[2].textContent = label;

  row.classList.add("flash");                          // highlight changed row
  setTimeout(() => row.classList.remove("flash"), 1200);

  const now = new Date();                              // update "as of" date
  const time = $("stockTime");
  time.setAttribute("datetime", now.toISOString());
  time.textContent = now.toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  updateAlertBanner();                                 // keep the emergency banner in sync
}

// Emergency banner: lists critical groups from the stock table (visible only if the setting is on)
function updateAlertBanner() {
  const banner = $("alertBanner");
  const critical = Array.from(stockRows)
    .filter(r => statusFor(parseInt(r.cells[1].textContent, 10))[0] === "critical")
    .map(r => r.cells[0].textContent.trim());
  $("alertText").textContent = critical.length
    ? `Urgent: ${critical.join(", ")} ${critical.length > 1 ? "are" : "is"} critically low. Please donate if you can.`
    : "";
  const enabled = typeof settingsState !== "undefined" && settingsState.alert;
  banner.classList.toggle("hidden", !(enabled && critical.length));
}

function readUnits() {
  const n = parseInt($("stockUnits").value, 10);
  if (isNaN(n) || n < 0) { toast("Enter a valid number of units.", "error"); return null; }
  return n;
}

$("stockAdd").addEventListener("click", () => {
  const n = readUnits(); if (n === null) return;
  const g = stockGroup.value;
  setStock(g, getStock(g) + n);
  toast(`Added ${n} unit(s) to ${g}.`);
});
$("stockIssue").addEventListener("click", () => {
  const n = readUnits(); if (n === null) return;
  const g = stockGroup.value;
  if (n > getStock(g)) { toast(`Only ${getStock(g)} unit(s) of ${g} in stock.`, "error"); return; }
  setStock(g, getStock(g) - n);
  toast(`Issued ${n} unit(s) of ${g}.`, "info");
});
$("stockSet").addEventListener("click", () => {
  const n = readUnits(); if (n === null) return;
  const g = stockGroup.value;
  setStock(g, n);
  toast(`${g} stock set to ${n}.`, "info");
});

/* =====================================================
   2. DONORS  –  add, display, modify, remove
   ===================================================== */
const STORE_KEY = "lifeflowDonors";
let donors = [];
try { donors = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { donors = []; }
function saveDonors() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(donors)); } catch (e) { /* storage unavailable */ }
}

const donorList = $("donorList");

// Returns a list of reasons why the donor needs a review (empty = eligible)
function eligibilityIssues(d) {
  const issues = [];
  if (d.weight < 50) issues.push("weight below 50 kg");
  if (d.haemoglobin !== null && d.haemoglobin < 12.5) issues.push("haemoglobin below 12.5");
  if (d.conditions.includes("surgery")) issues.push("recent surgery");
  if (d.conditions.includes("tattoo")) issues.push("recent tattoo/piercing");
  if (d.conditions.includes("diabetes") || d.conditions.includes("bp")) issues.push("medical condition to review");
  if (d.lastdonation) {
    const months = (Date.now() - new Date(d.lastdonation)) / (1000 * 60 * 60 * 24 * 30.44);
    const needed = d.gender === "female" ? 4 : 3;
    if (months < needed) issues.push(`last donation under ${needed} months ago`);
  }
  return issues;
}

function fillDetails(panel, d) {
  panel.innerHTML =
    `<p><strong>Email:</strong> ${esc(d.email)}</p>` +
    `<p><strong>Phone:</strong> ${esc(d.phone)}</p>` +
    `<p><strong>Weight:</strong> ${esc(String(d.weight))} kg &nbsp; <strong>Haemoglobin:</strong> ${d.haemoglobin !== null ? esc(String(d.haemoglobin)) + " g/dL" : "not given"}</p>` +
    `<p><strong>Preferred date:</strong> ${esc(d.donationdate)}</p>` +
    `<p><strong>Last donation:</strong> ${d.lastdonation ? esc(d.lastdonation) : "First-time donor"}</p>` +
    `<p><strong>Conditions:</strong> ${d.conditions.length ? esc(d.conditions.join(", ")) : "None"}</p>` +
    `<p><strong>Address:</strong> ${d.address ? esc(d.address) : "—"}</p>` +
    (d.notes ? `<p><strong>Notes:</strong> ${esc(d.notes)}</p>` : "");
}

function makeButton(text, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (cls) b.className = cls;
  return b;
}

// Build one donor card (<li>) with createElement / appendChild
function buildCard(d) {
  const li = document.createElement("li");
  li.className = "donor-card";
  li.setAttribute("data-id", d.id);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = d.bloodgroup;

  const info = document.createElement("div");
  info.className = "donor-info";

  const name = document.createElement("strong");
  name.className = "donor-name";
  name.textContent = d.name;

  const meta = document.createElement("span");
  meta.className = "donor-meta";
  meta.textContent = `${d.age} yrs • ${d.gender} • `;
  const phone = document.createElement("span");
  phone.textContent = d.phone;
  meta.appendChild(phone);

  const issues = eligibilityIssues(d);
  const tag = document.createElement("span");
  tag.className = "tag " + (d.donated ? "done" : issues.length ? "review" : "ok");
  tag.textContent = d.donated ? "Donated ✓" : issues.length ? "Review needed" : "Eligible";
  if (issues.length && !d.donated) tag.setAttribute("title", issues.join(", "));

  info.append(name, meta, tag);

  // Buttons
  const actions = document.createElement("div");
  actions.className = "donor-actions";
  const btnDetails = makeButton("Details", "btn-outline");
  const btnEdit    = makeButton("Edit", "btn-outline");
  const btnDonated = makeButton(d.donated ? "Donated ✓" : "Mark Donated");
  const btnRemove  = makeButton("Remove", "btn-dark");
  if (d.donated) btnDonated.setAttribute("disabled", "");
  actions.append(btnDetails, btnEdit, btnDonated, btnRemove);

  // Hidden details panel
  const panel = document.createElement("div");
  panel.className = "donor-details";
  panel.setAttribute("hidden", "");
  fillDetails(panel, d);

  const top = document.createElement("div");
  top.className = "donor-top";
  top.append(badge, info, actions);
  li.append(top, panel);

  // --- DISPLAY: show / hide details
  btnDetails.addEventListener("click", () => {
    const hidden = panel.hasAttribute("hidden");
    if (hidden) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
    btnDetails.textContent = hidden ? "Hide" : "Details";
  });

  // --- MODIFY: edit name and phone in place
  btnEdit.addEventListener("click", () => {
    if (btnEdit.textContent === "Edit") {
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = d.name;
      nameInput.className = "edit-input";
      nameInput.setAttribute("aria-label", "Edit name");
      const phoneInput = document.createElement("input");
      phoneInput.type = "tel";
      phoneInput.value = d.phone;
      phoneInput.className = "edit-input";
      phoneInput.setAttribute("aria-label", "Edit phone");
      name.replaceWith(nameInput);
      phone.replaceWith(phoneInput);
      btnEdit.textContent = "Save";
      nameInput.focus();
    } else {
      const nameInput = li.querySelector("input[aria-label='Edit name']");
      const phoneInput = li.querySelector("input[aria-label='Edit phone']");
      const newName = nameInput.value.trim();
      const newPhone = phoneInput.value.trim();
      if (!/^[A-Za-z .]{3,50}$/.test(newName)) { toast("Name: 3–50 letters, spaces or dots.", "error"); return; }
      if (!/^[6-9][0-9]{9}$/.test(newPhone))  { toast("Enter a valid 10-digit mobile number.", "error"); return; }
      d.name = newName;
      d.phone = newPhone;
      name.textContent = newName;
      phone.textContent = newPhone;
      nameInput.replaceWith(name);
      phoneInput.replaceWith(phone);
      fillDetails(panel, d);
      btnEdit.textContent = "Edit";
      saveDonors();
      toast("Donor details updated.");
    }
  });

  // --- MODIFY: mark donated -> also adds 1 unit to the stock table
  btnDonated.addEventListener("click", () => {
    d.donated = true;
    btnDonated.setAttribute("disabled", "");
    btnDonated.textContent = "Donated ✓";
    tag.className = "tag done";
    tag.textContent = "Donated ✓";
    tag.removeAttribute("title");
    setStock(d.bloodgroup, getStock(d.bloodgroup) + 1);
    saveDonors();
    toast(`Thank you, ${d.name}! +1 unit added to ${d.bloodgroup} stock.`);
  });

  // --- REMOVE: delete from array and from the DOM
  btnRemove.addEventListener("click", () => {
    if (!confirm(`Remove ${d.name} from the donor list?`)) return;
    donors = donors.filter(x => x.id !== d.id);
    saveDonors();
    li.classList.add("removing");
    setTimeout(() => { li.remove(); updateCount(); }, 250);
    toast("Donor removed.", "info");
  });

  return li;
}

function updateCount() {
  const shown = donorList.children.length;
  $("donorCount").textContent = donors.length;
  const empty = $("emptyMsg");
  if (shown === 0) {
    empty.textContent = donors.length ? "No donors match your search." : "No donors registered yet. Fill in the form above to add the first one.";
    empty.removeAttribute("hidden");
  } else {
    empty.setAttribute("hidden", "");
  }
}

function renderList() {
  const q = $("donorSearch").value.trim().toLowerCase();
  donorList.innerHTML = "";                          // clear old cards
  donors
    .filter(d => !q || d.name.toLowerCase().includes(q) || d.bloodgroup.toLowerCase().includes(q))
    .forEach(d => donorList.appendChild(buildCard(d)));
  updateCount();
}

// Live search
$("donorSearch").addEventListener("input", renderList);

// Clear all
$("clearAll").addEventListener("click", () => {
  if (!donors.length) { toast("The donor list is already empty.", "info"); return; }
  if (!confirm("Remove ALL registered donors?")) return;
  donors = [];
  saveDonors();
  renderList();
  toast("All donors removed.", "info");
});

/* ---------- ADD: registration form -> new donor card ---------- */
const form = $("donorForm");
const msg = $("msg");

form.addEventListener("submit", e => {
  e.preventDefault();
  const fd = new FormData(form);
  const phoneVal = fd.get("phone").trim();

  if (donors.some(x => x.phone === phoneVal)) {
    msg.textContent = "";
    toast("A donor with this phone number is already registered.", "error");
    return;
  }

  const donor = {
    id: Date.now(),
    name: fd.get("name").trim(),
    age: fd.get("age"),
    gender: fd.get("gender"),
    bloodgroup: fd.get("bloodgroup"),
    weight: parseFloat(fd.get("weight")),
    haemoglobin: fd.get("haemoglobin") ? parseFloat(fd.get("haemoglobin")) : null,
    lastdonation: fd.get("lastdonation"),
    conditions: fd.getAll("conditions"),
    notes: fd.get("notes").trim(),
    phone: phoneVal,
    email: fd.get("email").trim(),
    address: fd.get("address").trim(),
    donationdate: fd.get("donationdate"),
    donated: false
  };

  donors.push(donor);
  saveDonors();
  $("donorSearch").value = "";
  renderList();

  form.reset();                                      // reset first, then show message
  msg.textContent = `Thank you, ${donor.name}! Your registration was received.`;
  toast(`${donor.name} registered successfully.`);

  const card = donorList.lastElementChild;
  card.classList.add("new");
  $("donors").scrollIntoView({ behavior: "smooth", block: "start" });
});
form.addEventListener("reset", () => { msg.textContent = ""; });

renderList();                                        // show saved donors on load


/* =====================================================
   3. API INTEGRATION  –  fetch JSON, show loading / errors
   ===================================================== */
const API_URL = "blood-stock.json";      // change to a real endpoint URL if you have one

// Used only when the endpoint cannot be reached (e.g. page opened without a server)
const SAMPLE_DATA = {
  bank: "LifeFlow Blood Bank (sample data)",
  updated: new Date().toISOString(),
  stock: [
    { group: "A+", units: 45, capacity: 100, canDonateTo: "A+, AB+" },
    { group: "A−", units: 12, capacity: 60, canDonateTo: "A+, A−, AB+, AB−" },
    { group: "B+", units: 38, capacity: 100, canDonateTo: "B+, AB+" },
    { group: "B−", units: 8, capacity: 60, canDonateTo: "B+, B−, AB+, AB−" },
    { group: "AB+", units: 20, capacity: 60, canDonateTo: "AB+" },
    { group: "AB−", units: 4, capacity: 40, canDonateTo: "AB+, AB−" },
    { group: "O+", units: 60, capacity: 120, canDonateTo: "All positive groups" },
    { group: "O−", units: 5, capacity: 80, canDonateTo: "All blood groups" }
  ],
  camps: [
    { id: 1, venue: "PSG College of Technology", city: "Coimbatore", date: "2026-12-05", time: "09:00 – 15:00", slotsLeft: 42 },
    { id: 2, venue: "Gandhipuram Community Hall", city: "Coimbatore", date: "2026-12-12", time: "10:00 – 16:00", slotsLeft: 25 }
  ]
};

let apiData = null;                       // last data received

function showLoading(on) {
  const box = $("apiLoading");
  if (on) box.removeAttribute("hidden"); else box.setAttribute("hidden", "");
  $("live").setAttribute("aria-busy", on);
  $("apiRefresh").disabled = on;
}
function showError(text) {
  $("apiErrorText").textContent = text;
  $("apiError").removeAttribute("hidden");
}
function hideError() { $("apiError").setAttribute("hidden", ""); }

// Helper: create <tag> with text and append it to parent
function addCell(row, text, tag = "td") {
  const c = document.createElement(tag);
  c.textContent = text;
  row.appendChild(c);
  return c;
}

function friendlyError(err) {
  if (err.name === "AbortError") return "The server took too long to respond (timeout after 8 seconds).";
  if (err instanceof SyntaxError) return "The server replied, but the data was not valid JSON.";
  if (err instanceof TypeError)
    return "Network error – the data file could not be fetched. If you opened index.html by double-clicking, " +
           "run it through a local server (e.g. VS Code “Live Server”) so fetch() can read blood-stock.json.";
  return err.message;
}

async function loadStock() {
  showLoading(true);
  hideError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(API_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Server responded with ${response.status} ${response.statusText}.`);

    const data = await response.json();
    if (!Array.isArray(data.stock) || !Array.isArray(data.camps))
      throw new Error("The data is missing the 'stock' or 'camps' list.");

    apiData = data;
    renderApi();
    $("apiStatus").textContent = `Live data from ${data.bank} • updated ` +
      new Date(data.updated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    $("apiStatus").className = "api-status live";
  } catch (err) {
    showError(friendlyError(err));
    if (!apiData) {                       // nothing shown yet -> fall back to sample data
      apiData = SAMPLE_DATA;
      renderApi();
    }
    $("apiStatus").textContent = "Offline – showing sample data (not live).";
    $("apiStatus").className = "api-status offline";
  } finally {
    clearTimeout(timer);
    showLoading(false);
  }
}

function renderApi() {
  renderSummary();
  renderStockTable();
  renderCampTable();
}

function renderSummary() {
  const box = $("apiSummary");
  box.textContent = "";                   // clear old cards
  const total = apiData.stock.reduce((sum, s) => sum + s.units, 0);
  const critical = apiData.stock.filter(s => statusFor(s.units)[0] === "critical").map(s => s.group);
  const items = [
    ["Total units", total],
    ["Critical groups", critical.length ? critical.join(", ") : "None"],
    ["Upcoming camps", apiData.camps.length]
  ];
  items.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "summary-card";
    const v = document.createElement("strong");
    v.textContent = value;
    const l = document.createElement("span");
    l.textContent = label;
    card.appendChild(v);
    card.appendChild(l);
    box.appendChild(card);
  });
}

function renderStockTable() {
  const body = document.querySelector("#apiStockTable tbody");
  body.textContent = "";
  const filter = $("apiFilter").value;
  const rows = apiData.stock.filter(s => filter === "all" || statusFor(s.units)[0] === filter);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = addCell(tr, "No blood groups match this filter.");
    td.setAttribute("colspan", "5");
    td.className = "empty-cell";
    body.appendChild(tr);
    return;
  }

  rows.forEach(s => {
    const tr = document.createElement("tr");
    const [cls, label] = statusFor(s.units);
    addCell(tr, s.group);
    addCell(tr, s.units);

    // progress bar showing units / capacity
    const barCell = document.createElement("td");
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill " + cls;
    fill.style.width = Math.min(100, Math.round((s.units / s.capacity) * 100)) + "%";
    bar.appendChild(fill);
    bar.setAttribute("title", `${s.units} of ${s.capacity} units`);
    barCell.appendChild(bar);
    tr.appendChild(barCell);

    addCell(tr, label).className = cls;
    addCell(tr, s.canDonateTo);
    body.appendChild(tr);
  });
}

function renderCampTable() {
  const body = document.querySelector("#apiCampTable tbody");
  body.textContent = "";
  apiData.camps.forEach(c => {
    const tr = document.createElement("tr");
    addCell(tr, c.venue);
    addCell(tr, c.city);
    addCell(tr, new Date(c.date + "T00:00").toLocaleDateString("en-IN", { dateStyle: "medium" }));
    addCell(tr, c.time);
    const slots = addCell(tr, c.slotsLeft);
    if (c.slotsLeft <= 10) slots.className = "critical";

    const btnCell = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.slotsLeft ? "Book" : "Full";
    if (!c.slotsLeft) btn.setAttribute("disabled", "");
    btn.addEventListener("click", () => {
      $("date").value = c.date;           // pre-fill the registration form
      toast(`Date set to ${c.date}. Please complete the form.`, "info");
      $("register").scrollIntoView({ behavior: "smooth" });
    });
    btnCell.appendChild(btn);
    tr.appendChild(btnCell);
    body.appendChild(tr);
  });
}

$("apiRefresh").addEventListener("click", loadStock);
$("apiRetry").addEventListener("click", loadStock);
$("apiFilter").addEventListener("change", () => { if (apiData) renderStockTable(); });

loadStock();                              // fetch automatically when the page opens

/* =====================================================
   4. STAFF TASK MANAGER  –  CRUD + Local Storage
   ===================================================== */
const TASK_KEY = "lifeflowTasks";
const STATUSES = ["Pending", "In Progress", "Completed"];
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

let tasks = [];
let editingId = null;                      // id of the task being edited (null = adding)

// ---- Load from Local Storage (getItem + JSON.parse)
try { tasks = JSON.parse(localStorage.getItem(TASK_KEY)) || []; } catch (e) { tasks = []; }
if (!Array.isArray(tasks)) tasks = [];

// ---- Save to Local Storage (setItem + JSON.stringify)
function saveTasks() {
  try { localStorage.setItem(TASK_KEY, JSON.stringify(tasks)); }
  catch (e) { toast("Could not save tasks in this browser.", "error"); }
}

// ---- A few starter tasks the very first time the page is opened
function isoDay(offset) { return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10); }
let seeded = null;
try { seeded = localStorage.getItem(TASK_KEY + "Seeded"); } catch (e) { seeded = "1"; }
if (!seeded && tasks.length === 0) {
  tasks.push(
    { id: 1, title: "Call O− donors for the urgent camp", category: "Donor Follow-up", blood: "O−", priority: "High", due: isoDay(1), status: "In Progress", notes: "Stock is critical. Use the donor list.", created: new Date().toISOString() },
    { id: 2, title: "Screen and test last week's collections", category: "Blood Testing & Screening", blood: "", priority: "Medium", due: isoDay(3), status: "Pending", notes: "", created: new Date().toISOString() },
    { id: 3, title: "Deliver 6 units of A+ to City Hospital", category: "Delivery to Hospital", blood: "A+", priority: "High", due: isoDay(-1), status: "Pending", notes: "Hospital is waiting for confirmation.", created: new Date().toISOString() }
  );
  saveTasks();
  try { localStorage.setItem(TASK_KEY + "Seeded", "1"); } catch (e) { /* ignore */ }
}

const taskForm = $("taskForm");
const taskList = $("taskList");

// ---- CREATE / UPDATE
taskForm.addEventListener("submit", e => {
  e.preventDefault();
  const data = {
    title: $("taskTitle").value.trim(),
    category: $("taskCategory").value,
    blood: $("taskBlood").value,
    priority: $("taskPriority").value,
    due: $("taskDue").value,
    status: $("taskStatus").value,
    notes: $("taskNotes").value.trim()
  };

  if (editingId !== null) {
    const task = tasks.find(t => t.id === editingId);         // find()
    if (task) Object.assign(task, data);
    toast("Task updated.");
  } else {
    tasks.push({ id: Date.now(), created: new Date().toISOString(), ...data });   // push()
    toast("Task added.");
  }
  saveTasks();
  resetTaskForm();
  renderTasks();
});

function resetTaskForm() {
  editingId = null;
  taskForm.reset();
  $("taskFormTitle").textContent = "Add a New Task";
  $("taskSubmit").textContent = "Add Task";
  $("taskCancel").setAttribute("hidden", "");
  taskForm.classList.remove("editing");
}
$("taskCancel").addEventListener("click", resetTaskForm);

// ---- UPDATE: load a task into the form
function startEdit(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  $("taskTitle").value = t.title;
  $("taskCategory").value = t.category;
  $("taskBlood").value = t.blood;
  $("taskPriority").value = t.priority;
  $("taskDue").value = t.due;
  $("taskStatus").value = t.status;
  $("taskNotes").value = t.notes;
  $("taskFormTitle").textContent = "Edit Task";
  $("taskSubmit").textContent = "Update Task";
  $("taskCancel").removeAttribute("hidden");
  taskForm.classList.add("editing");
  taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
  $("taskTitle").focus();
}

// ---- DELETE
function deleteTask(id, li) {
  const t = tasks.find(x => x.id === id);
  if (!t || !confirm(`Delete the task "${t.title}"?`)) return;
  tasks = tasks.filter(x => x.id !== id);                     // filter()
  saveTasks();
  if (editingId === id) resetTaskForm();
  li.classList.add("removing");
  setTimeout(() => { li.remove(); renderTasks(); }, 250);    // remove()
  toast("Task deleted.", "info");
}

$("taskClearDone").addEventListener("click", () => {
  const done = tasks.filter(t => t.status === "Completed").length;
  if (!done) { toast("No completed tasks to clear.", "info"); return; }
  if (!confirm(`Remove ${done} completed task(s)?`)) return;
  tasks = tasks.filter(t => t.status !== "Completed");
  if (editingId !== null && !tasks.some(t => t.id === editingId)) resetTaskForm();
  saveTasks();
  renderTasks();
  toast("Completed tasks cleared.", "info");
});

// ---- READ: build the list
function isOverdue(t) { return t.status !== "Completed" && t.due && t.due < today; }

function buildTaskCard(t) {
  const li = document.createElement("li");
  li.className = "task-card priority-" + t.priority.toLowerCase();
  if (t.status === "Completed") li.classList.add("is-done");
  li.setAttribute("data-id", t.id);

  const head = document.createElement("div");
  head.className = "task-head";
  const title = document.createElement("strong");
  title.className = "task-title";
  title.textContent = t.title;
  head.appendChild(title);
  if (t.blood) {
    const b = document.createElement("span");
    b.className = "badge small";
    b.textContent = t.blood;
    head.appendChild(b);
  }

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const cat = document.createElement("span");
  cat.className = "chip";
  cat.textContent = t.category;
  const pri = document.createElement("span");
  pri.className = "chip pri-" + t.priority.toLowerCase();
  pri.textContent = t.priority + " priority";
  const due = document.createElement("span");
  due.className = "chip" + (isOverdue(t) ? " overdue" : "");
  due.textContent = (isOverdue(t) ? "Overdue • " : "Due ") +
    new Date(t.due + "T00:00").toLocaleDateString("en-IN", { dateStyle: "medium" });
  meta.append(cat, pri, due);

  li.append(head, meta);

  if (t.notes) {
    const notes = document.createElement("p");
    notes.className = "task-notes";
    notes.textContent = t.notes;
    li.appendChild(notes);
  }

  const actions = document.createElement("div");
  actions.className = "task-actions";

  // status dropdown (UPDATE status without opening the form)
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Change status");
  sel.className = "status-select st-" + t.status.replace(" ", "").toLowerCase();
  STATUSES.forEach(s => {
    const o = document.createElement("option");
    o.textContent = s;
    if (s === t.status) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => {
    const task = tasks.find(x => x.id === t.id);
    task.status = sel.value;
    saveTasks();
    renderTasks();
    toast(`Status changed to "${sel.value}".`, "info");
  });

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn-outline";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => startEdit(t.id));

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn-dark";
  del.textContent = "Delete";
  del.addEventListener("click", () => deleteTask(t.id, li));

  actions.append(sel, edit, del);
  li.appendChild(actions);
  return li;
}

function renderTasks() {
  const q = $("taskSearch").value.trim().toLowerCase();
  const f = $("taskFilter").value;

  const visible = tasks
    .filter(t => f === "all" || t.status === f)
    .filter(t => !q || t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) ||
                      t.blood.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))
    .sort((a, b) =>
      (a.status === "Completed") - (b.status === "Completed") ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.due.localeCompare(b.due));

  taskList.textContent = "";
  visible.forEach(t => taskList.appendChild(buildTaskCard(t)));

  const empty = $("taskEmpty");
  if (visible.length) empty.setAttribute("hidden", "");
  else {
    empty.textContent = tasks.length ? "No tasks match your search or filter." : "No tasks yet. Add your first task above.";
    empty.removeAttribute("hidden");
  }
  renderTaskSummary();
}

function renderTaskSummary() {
  const body = document.querySelector("#taskSummary tbody");
  body.textContent = "";
  const rows = STATUSES.map(s => {
    const list = tasks.filter(t => t.status === s);
    return [s, list.length, list.filter(t => t.priority === "High").length, list.filter(isOverdue).length];
  });
  rows.push(["Total", tasks.length,
    tasks.filter(t => t.priority === "High").length, tasks.filter(isOverdue).length]);

  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (i === rows.length - 1) tr.className = "total-row";
    r.forEach(v => addCell(tr, v));
    body.appendChild(tr);
  });

  const done = tasks.filter(t => t.status === "Completed").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  $("taskProgress").style.width = pct + "%";
  $("taskProgressText").textContent = `${pct}% completed (${done} of ${tasks.length})`;
}

$("taskSearch").addEventListener("input", renderTasks);
$("taskFilter").addEventListener("change", renderTasks);

renderTasks();                              // show saved tasks when the page loads

/* =====================================================
   5. INTERACTIVE TOOLS  –  tabs, compatibility, eligibility, FAQ, gallery
   ===================================================== */

/* ---------- Tabs ---------- */
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function openTab(name) {
  tabBtns.forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
    b.setAttribute("tabindex", on ? "0" : "-1");
  });
  tabPanels.forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
}
tabBtns.forEach((b, i) => {
  b.addEventListener("click", () => openTab(b.dataset.tab));
  b.addEventListener("keydown", e => {                       // arrow-key navigation
    let next = null;
    if (e.key === "ArrowRight") next = tabBtns[(i + 1) % tabBtns.length];
    if (e.key === "ArrowLeft")  next = tabBtns[(i - 1 + tabBtns.length) % tabBtns.length];
    if (next) { next.focus(); openTab(next.dataset.tab); }
  });
});

/* ---------- Compatibility checker ---------- */
const GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const disp = g => g.replace("-", "\u2212");                   // show a proper minus sign
const COMPAT = {                                              // who each group can donate to
  "O-":  ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+":  ["O+", "A+", "B+", "AB+"],
  "A-":  ["A-", "A+", "AB-", "AB+"],
  "A+":  ["A+", "AB+"],
  "B-":  ["B-", "B+", "AB-", "AB+"],
  "B+":  ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"]
};

function makeGroupList(titleText, groups) {
  const wrap = document.createElement("div");
  wrap.className = "compat-col";
  const h = document.createElement("h4");
  h.textContent = titleText;
  const ul = document.createElement("ul");
  ul.className = "chip-list";
  groups.forEach(g => {
    const units = getStock(disp(g));                          // live stock from the table
    const [cls, label] = statusFor(units);
    const li = document.createElement("li");
    li.className = "chip st-" + cls;
    li.textContent = disp(g);
    li.setAttribute("title", `${units} units in stock (${label})`);
    ul.appendChild(li);
  });
  wrap.append(h, ul);
  return wrap;
}

function showCompat(group) {
  document.querySelectorAll("#groupButtons button").forEach(b =>
    b.classList.toggle("active", b.dataset.group === group));

  const box = $("compatResult");
  box.textContent = "";
  const donateTo = COMPAT[group];
  const receiveFrom = GROUPS.filter(g => COMPAT[g].includes(group));

  const title = document.createElement("p");
  title.className = "compat-title";
  title.textContent = `Blood group ${disp(group)}`;
  if (group === "O-")  title.textContent += " – the universal donor";
  if (group === "AB+") title.textContent += " – the universal recipient";

  const cols = document.createElement("div");
  cols.className = "compat-cols";
  cols.append(makeGroupList(`${disp(group)} can donate to`, donateTo),
              makeGroupList(`${disp(group)} can receive from`, receiveFrom));
  box.append(title, cols);
}

GROUPS.forEach(g => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "group-btn";
  b.textContent = disp(g);
  b.dataset.group = g;
  b.addEventListener("click", () => showCompat(g));
  $("groupButtons").appendChild(b);

  ["pairDonor", "pairRecipient"].forEach(id => {
    const o = document.createElement("option");
    o.value = g;
    o.textContent = disp(g);
    $(id).appendChild(o);
  });
});
$("pairRecipient").value = "AB+";

$("pairBtn").addEventListener("click", () => {
  const d = $("pairDonor").value;
  const r = $("pairRecipient").value;
  const ok = COMPAT[d].includes(r);
  const out = $("pairResult");
  out.textContent = ok
    ? `✓ Yes – ${disp(d)} blood can be given to a ${disp(r)} patient.`
    : `✗ No – ${disp(d)} blood cannot be given to a ${disp(r)} patient.`;
  out.classList.toggle("yes", ok);
  out.classList.toggle("no", !ok);
});

/* ---------- Eligibility calculator ---------- */
$("ecForm").addEventListener("submit", e => {
  e.preventDefault();
  const age = parseFloat($("ecAge").value);
  const weight = parseFloat($("ecWeight").value);
  const hb = $("ecHb").value ? parseFloat($("ecHb").value) : null;
  const female = $("ecGender").value === "female";
  const lastVal = $("ecLast").value;
  const gapMonths = female ? 4 : 3;

  const checks = [
    { ok: age >= 18 && age <= 65, text: `Age ${age} (must be 18–65)` },
    { ok: weight >= 50, text: `Weight ${weight} kg (minimum 50 kg)` },
    { ok: !$("ecFever").checked, text: "No fever, cold or infection" },
    { ok: !$("ecTattoo").checked, text: "No tattoo or piercing in the last 6 months" },
    { ok: !$("ecSurgery").checked, text: "No major surgery in the last 6 months" },
    { ok: !$("ecPregnant").checked, text: "Not pregnant or breastfeeding" }
  ];
  if (hb !== null) checks.splice(2, 0, { ok: hb >= 12.5, text: `Haemoglobin ${hb} g/dL (minimum 12.5)` });

  let nextText = "";
  if (lastVal) {
    const next = new Date(lastVal);
    next.setMonth(next.getMonth() + gapMonths);
    const waitOk = next <= new Date();
    checks.push({ ok: waitOk, text: `At least ${gapMonths} months since the last donation` });
    if (!waitOk) nextText = "You can donate again from " +
      next.toLocaleDateString("en-IN", { dateStyle: "long" }) + ".";
  }

  const failed = checks.filter(c => !c.ok);
  const list = $("ecChecks");
  list.textContent = "";
  checks.forEach(c => {
    const li = document.createElement("li");
    li.className = c.ok ? "ok" : "no";
    li.textContent = (c.ok ? "✓ " : "✗ ") + c.text;
    list.appendChild(li);
  });

  const verdict = $("ecVerdict");
  const result = $("ecResult");
  result.classList.toggle("pass", failed.length === 0);
  result.classList.toggle("fail", failed.length > 0);
  verdict.textContent = failed.length === 0
    ? "Great news – you are likely eligible to donate!"
    : "You may not be able to donate right now.";

  const next = $("ecNext");
  next.textContent = "";
  if (failed.length === 0) {
    const a = document.createElement("a");
    a.href = "#register";
    a.className = "btn";
    a.textContent = "Register as a donor";
    next.appendChild(a);
  } else {
    next.textContent = nextText;
  }
  result.removeAttribute("hidden");
});

/* ---------- FAQ accordion + search ---------- */
const faqItems = document.querySelectorAll("#faqList details");

$("faqSearch").addEventListener("input", () => {
  const q = $("faqSearch").value.trim().toLowerCase();
  faqItems.forEach(d => d.classList.toggle("hidden", !d.textContent.toLowerCase().includes(q)));
  const visible = Array.from(faqItems).filter(d => !d.classList.contains("hidden"));
  if (visible.length) $("faqEmpty").setAttribute("hidden", "");
  else $("faqEmpty").removeAttribute("hidden");
});
$("faqExpand").addEventListener("click", () =>
  faqItems.forEach(d => { if (!d.classList.contains("hidden")) d.open = true; }));
$("faqCollapse").addEventListener("click", () => faqItems.forEach(d => { d.open = false; }));

faqItems.forEach(d => d.addEventListener("toggle", () => {   // optional one-at-a-time mode
  if (d.open && $("faqSingle").checked) faqItems.forEach(o => { if (o !== d) o.open = false; });
}));

/* ---------- Gallery: filter + lightbox ---------- */
function svgUri(svg) { return "data:image/svg+xml;utf8," + encodeURIComponent(svg); }

function dropPicture(label) {
  return svgUri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#ffebee'/>` +
    `<path d='M100 20 C100 20 40 90 40 130 a60 60 0 0 0 120 0 C160 90 100 20 100 20Z' fill='#c62828'/>` +
    `<text x='100' y='142' font-size='38' font-weight='bold' text-anchor='middle' fill='white' font-family='Arial'>${label}</text></svg>`);
}
function stepPicture(num, label) {
  return svgUri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#e3f2fd'/>` +
    `<circle cx='100' cy='80' r='46' fill='#1565c0'/>` +
    `<text x='100' y='96' font-size='48' font-weight='bold' text-anchor='middle' fill='white' font-family='Arial'>${num}</text>` +
    `<text x='100' y='170' font-size='26' font-weight='bold' text-anchor='middle' fill='#0d47a1' font-family='Arial'>${label}</text></svg>`);
}
function messagePicture(icon, line1, line2) {
  return svgUri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#fff3e0'/>` +
    `<text x='100' y='95' font-size='64' text-anchor='middle' font-family='Arial'>${icon}</text>` +
    `<text x='100' y='135' font-size='22' font-weight='bold' text-anchor='middle' fill='#e65100' font-family='Arial'>${line1}</text>` +
    `<text x='100' y='165' font-size='22' text-anchor='middle' fill='#555' font-family='Arial'>${line2}</text></svg>`);
}

const GALLERY = [];
GROUPS.forEach(g => GALLERY.push({
  cat: "groups", title: `Blood group ${disp(g)}`, alt: `Red blood drop labelled ${disp(g)}`, src: dropPicture(disp(g))
}));
[["1", "Register"], ["2", "Screening"], ["3", "Donate"], ["4", "Refresh"]].forEach(([n, name]) => GALLERY.push({
  cat: "process", title: `Step ${n}: ${name}`, alt: `Step ${n} of the donation process: ${name}`, src: stepPicture(n, name)
}));
GALLERY.push(
  { cat: "awareness", title: "Give the gift of life", alt: "Heart symbol with the text Give Life", src: messagePicture("❤️", "Give Life", "Donate blood") },
  { cat: "awareness", title: "One donation, three lives", alt: "Drop symbol with the text One donation saves three lives", src: messagePicture("🩸", "1 donation", "saves 3 lives") },
  { cat: "awareness", title: "Safe and tested blood", alt: "Shield symbol with the text Safe tested blood", src: messagePicture("🛡️", "Safe blood", "Every unit tested") }
);
GALLERY.forEach((item, i) => { item.id = i + 1; });

let galleryCat = "all";
let lbId = null;
const galleryGrid = $("galleryGrid");

function visibleGallery() { return GALLERY.filter(g => galleryCat === "all" || g.cat === galleryCat); }

function renderGallery() {
  galleryGrid.textContent = "";
  visibleGallery().forEach(item => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gallery-item";
    btn.setAttribute("aria-label", "Enlarge: " + item.title);
    const img = document.createElement("img");
    img.src = item.src;
    img.alt = item.alt;
    img.width = 200;
    img.height = 200;
    img.loading = "lazy";
    const cap = document.createElement("span");
    cap.textContent = item.title;
    btn.append(img, cap);
    btn.addEventListener("click", () => openLightbox(item.id));
    li.appendChild(btn);
    galleryGrid.appendChild(li);
  });
}

$("galleryFilters").querySelectorAll(".filter-btn").forEach(b => b.addEventListener("click", () => {
  galleryCat = b.dataset.cat;
  document.querySelectorAll("#galleryFilters .filter-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  renderGallery();
}));

const lightbox = $("lightbox");
function openLightbox(id) {
  const item = GALLERY.find(g => g.id === id);
  if (!item) return;
  lbId = id;
  $("lbImg").src = item.src;
  $("lbImg").alt = item.alt;
  $("lbCap").textContent = item.title;
  lightbox.classList.add("open");
  document.body.classList.add("no-scroll");
  $("lbClose").focus();
}
function closeLightbox() {
  lightbox.classList.remove("open");
  document.body.classList.remove("no-scroll");
  lbId = null;
}
function stepLightbox(dir) {
  const list = visibleGallery();
  const i = list.findIndex(g => g.id === lbId);
  if (i === -1) return;
  openLightbox(list[(i + dir + list.length) % list.length].id);
}
$("lbClose").addEventListener("click", closeLightbox);
$("lbPrev").addEventListener("click", () => stepLightbox(-1));
$("lbNext").addEventListener("click", () => stepLightbox(1));
lightbox.addEventListener("click", e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener("keydown", e => {
  if (!lightbox.classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLightbox(-1);
  if (e.key === "ArrowRight") stepLightbox(1);
});

renderGallery();

/* =====================================================
   6. SETTINGS  –  custom toggle switches + Local Storage
   ===================================================== */
const SETTINGS_KEY = "lifeflowSettings";
const prefersDark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
const prefersCalm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Each setting: checkbox id, storage key, default value, and what it does when switched
const SETTING_DEFS = [
  { id: "setAlert",     key: "alert",     def: true,
    apply: () => updateAlertBanner(),
    msg: on => on ? "Emergency alerts turned on." : "Emergency alerts turned off." },
  { id: "setReminders", key: "reminders", def: false,
    apply: on => { $("updates").checked = on; },
    msg: on => on ? "Reminders will be pre-selected on the form." : "Reminders will no longer be pre-selected." },
  { id: "setDark",      key: "dark",      def: prefersDark,
    apply: on => document.body.classList.toggle("dark", on),
    msg: on => on ? "Dark mode on." : "Dark mode off." },
  { id: "setLarge",     key: "large",     def: false,
    apply: on => document.documentElement.classList.toggle("large-text", on),
    msg: on => on ? "Large text on." : "Large text off." },
  { id: "setMotion",    key: "calm",      def: prefersCalm,
    apply: on => document.body.classList.toggle("calm", on),
    msg: on => on ? "Animations reduced." : "Animations restored." }
];

// ---- Load saved choices (getItem + JSON.parse), fall back to defaults
let settingsState = {};
let savedSettings = {};
try { savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { savedSettings = {}; }
SETTING_DEFS.forEach(s => {
  settingsState[s.key] = typeof savedSettings[s.key] === "boolean" ? savedSettings[s.key] : s.def;
});

// ---- Save choices (setItem + JSON.stringify)
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsState)); } catch (e) { /* storage unavailable */ }
}

// Update the row look + "On/Off" text for one switch
function syncSwitch(s) {
  const input = $(s.id);
  const row = input.closest(".setting-row");
  row.classList.toggle("is-on", input.checked);
  $(s.id + "State").textContent = input.checked ? "On" : "Off";
  input.setAttribute("aria-checked", input.checked);
}
function updateSettingsCount() {
  const on = SETTING_DEFS.filter(s => settingsState[s.key]).length;
  $("settingsCount").textContent = `${on} of ${SETTING_DEFS.length} settings are on.`;
}

SETTING_DEFS.forEach(s => {
  const input = $(s.id);
  input.checked = settingsState[s.key];              // restore the saved position
  syncSwitch(s);
  s.apply(input.checked);                            // restore the saved behaviour

  input.addEventListener("change", () => {
    settingsState[s.key] = input.checked;            // read the new state
    saveSettings();
    syncSwitch(s);
    s.apply(input.checked);                          // change the page behaviour now
    updateSettingsCount();
    toast(s.msg(input.checked), "info");
  });
});
updateSettingsCount();

// Keep the "reminders" setting applied after the donor form is reset or submitted
$("donorForm").addEventListener("reset", () => {
  setTimeout(() => { $("updates").checked = settingsState.reminders; }, 0);
});

$("settingsReset").addEventListener("click", () => {
  SETTING_DEFS.forEach(s => {
    settingsState[s.key] = s.def;
    $(s.id).checked = s.def;
    syncSwitch(s);
    s.apply(s.def);
  });
  saveSettings();
  updateSettingsCount();
  toast("Settings reset to defaults.", "info");
});

/* =====================================================
   7. RESPONSIVE NAVIGATION  –  hamburger toggle
   ===================================================== */
const navToggle = $("navToggle");
const navMenu = $("navMenu");

navToggle.addEventListener("click", () => {
  const open = navMenu.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", open);
  navToggle.innerHTML = open ? "&times;" : "&#9776;";
});

navMenu.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
  navMenu.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  navToggle.innerHTML = "&#9776;";
}));
