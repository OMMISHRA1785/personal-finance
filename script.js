// Dashboard + Auth script
// - client-side auth (register/login) using localStorage
// - passwords hashed with SHA-256 (Web Crypto) before storing
// - each user has own transactions stored under key: pf_dashboard_v1_<userId>
// - remember-me option persists session in localStorage; otherwise sessionStorage is used
// - Chart.js pie chart, categories, month filter, dark mode, animations, progress bars

// ---------- CONSTANTS & ELEMENTS ----------
const USERS_KEY = "pf_users_v1";
const SESSION_KEY = "pf_current_user_v1"; // stored in either localStorage or sessionStorage depending on remember
let currentUser = null; // {id,name,email}

const el = {
  // auth elements
  authScreen: document.getElementById("authScreen"),
  showLoginBtn: document.getElementById("showLogin"),
  showRegisterBtn: document.getElementById("showRegister"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  doLogin: document.getElementById("doLogin"),
  loginError: document.getElementById("loginError"),
  rememberMe: document.getElementById("rememberMe"),

  regName: document.getElementById("regName"),
  regEmail: document.getElementById("regEmail"),
  regPassword: document.getElementById("regPassword"),
  regConfirm: document.getElementById("regConfirm"),
  doRegister: document.getElementById("doRegister"),
  regError: document.getElementById("regError"),

  // app elements
  topbar: document.getElementById("topbar"),
  mainApp: document.getElementById("mainApp"),
  footer: document.getElementById("footer"),
  currentUserLabel: document.getElementById("currentUserLabel"),
  logoutBtn: document.getElementById("logoutBtn"),
  darkToggle: document.getElementById("darkToggle"),

  // dashboard elements (same as earlier)
  totalIncome: document.getElementById("totalIncome"),
  totalExpense: document.getElementById("totalExpense"),
  balance: document.getElementById("balance"),
  transactionsTbody: document.getElementById("transactions"),
  addForm: document.getElementById("addForm"),
  title: document.getElementById("title"),
  amount: document.getElementById("amount"),
  date: document.getElementById("date"),
  category: document.getElementById("category"),
  monthSelect: document.getElementById("monthSelect"),
  categoryFilter: document.getElementById("categoryFilter"),
  spentProgress: document.getElementById("spentProgress"),
  balanceProgress: document.getElementById("balanceProgress"),
  spentPercent: document.getElementById("spentPercent"),
  balancePercent: document.getElementById("balancePercent"),
  pieChartCanvas: document.getElementById("pieChart") ? document.getElementById("pieChart").getContext("2d") : null,
};

// chart instance
let pieChart = null;

// ---------- UTIL: Web Crypto SHA-256 hashing ----------
async function hashStringSHA256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  // convert to hex
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2,"0")).join("");
}

// ---------- USERS storage helpers ----------
function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  } catch (e) { return []; }
}
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// returns user object or null
function findUserByEmail(email) {
  const users = loadUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

// ---------- SESSION helpers ----------
function setSession(user, remember=false) {
  const payload = { id: user.id, name: user.name, email: user.email };
  const serialized = JSON.stringify(payload);
  if (remember) {
    localStorage.setItem(SESSION_KEY, serialized);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, serialized);
    localStorage.removeItem(SESSION_KEY);
  }
  currentUser = payload;
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  currentUser = null;
}
function loadSession() {
  const s = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!s) return null;
  try {
    currentUser = JSON.parse(s);
    return currentUser;
  } catch (e) { return null; }
}

// ---------- per-user transaction storage ----------
function userLSKey(userId) {
  return `pf_dashboard_v1_${userId}`;
}
function loadTransactionsForCurrentUser() {
  if (!currentUser) return [];
  return JSON.parse(localStorage.getItem(userLSKey(currentUser.id)) || "[]");
}
function saveTransactionsForCurrentUser(arr) {
  if (!currentUser) return;
  localStorage.setItem(userLSKey(currentUser.id), JSON.stringify(arr));
}

// ---------- DASHBOARD logic (same as earlier, but per-user) ----------
let transactions = []; // active user's transactions

function formatCurrency(n) {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function escapeHTML(s='') {
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function getMonthsFromTransactions() {
  const months = new Set(transactions.map(t => t.date.slice(0,7)));
  return Array.from(months).sort((a,b)=>b.localeCompare(a));
}
function uniqueCategories() {
  const s = new Set(transactions.map(t => t.category));
  return Array.from(s).sort();
}

function renderSummary(filtered) {
  const income = filtered.filter(t => t.type === "income").reduce((s,t)=>s + Number(t.amount),0);
  const expense = filtered.filter(t => t.type === "expense").reduce((s,t)=>s + Number(t.amount),0);
  const balance = income - expense;

  el.totalIncome.textContent = formatCurrency(income);
  el.totalExpense.textContent = formatCurrency(expense);
  el.balance.textContent = formatCurrency(balance);

  const spentPct = income === 0 ? (expense > 0 ? 100 : 0) : Math.min(100, Math.round((expense/income)*100));
  const balancePct = income === 0 ? 0 : Math.max(0, Math.min(100, Math.round((balance / (income||1))*100)));
  el.spentProgress.style.width = spentPct + "%";
  el.balanceProgress.style.width = Math.abs(balancePct) + "%";
  el.spentPercent.textContent = `${spentPct}%`;
  el.balancePercent.textContent = `${balancePct}%`;
}

function renderChart(filtered) {
  if (!el.pieChartCanvas) return;
  const grouped = {};
  filtered.forEach(t => {
    const key = `${t.type}:${t.category}`;
    grouped[key] = (grouped[key] || 0) + Number(t.amount);
  });

  const labels = [];
  const data = [];
  const bg = [];

  Object.keys(grouped).sort().forEach(k=>{
    const [type,category] = k.split(":");
    labels.push(`${category} (${type[0].toUpperCase()})`);
    data.push(grouped[k]);
    bg.push(type === "expense" ? "rgba(239,68,68,0.85)" : "rgba(16,185,129,0.85)");
  });

  if (pieChart) {
    pieChart.data.labels = labels;
    pieChart.data.datasets[0].data = data;
    pieChart.data.datasets[0].backgroundColor = bg;
    pieChart.update();
  } else {
    pieChart = new Chart(el.pieChartCanvas, {
      type: "pie",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bg,
          borderWidth: 0
        }]
      },
      options: {
        plugins: {
          legend: {position: "bottom", labels:{boxWidth:10}}
        },
        maintainAspectRatio: false,
        responsive: true
      }
    });
  }
}

function renderTransactions(filtered) {
  el.transactionsTbody.innerHTML = "";
  filtered
    .sort((a,b)=> new Date(b.date) - new Date(a.date))
    .forEach((t, idx) => {
      const tr = document.createElement("tr");
      tr.classList.add("enter");
      tr.innerHTML = `
        <td>${escapeHTML(t.title)}</td>
        <td>${escapeHTML(t.category)}</td>
        <td>${t.date}</td>
        <td style="text-align:right">${t.type === "expense" ? "-" : ""} ${formatCurrency(t.amount)}</td>
        <td style="color:${t.type==='expense'?'#ef4444':'#10b981'};font-weight:600">${t.type}</td>
        <td style="text-align:right"><button class="del" data-id="${t.id}"><i class="fa-solid fa-trash"></i></button></td>
      `;
      el.transactionsTbody.appendChild(tr);

      tr.querySelector(".del").addEventListener("click", (e)=>{
        const id = e.currentTarget.dataset.id;
        tr.classList.add("leave");
        setTimeout(()=> {
          transactions = transactions.filter(x => x.id !== id);
          saveTransactionsForCurrentUser(transactions);
          refreshUI();
        }, 260);
      });
    });
}

function getActiveFilters() {
  const month = el.monthSelect.value;
  const cat = el.categoryFilter.value;
  return { month, cat };
}
function applyFilters() {
  const { month, cat } = getActiveFilters();
  return transactions.filter(t => {
    if (month !== "all" && !t.date.startsWith(month)) return false;
    if (cat !== "all" && t.category !== cat) return false;
    return true;
  });
}

function populateMonthSelect() {
  const months = getMonthsFromTransactions();
  el.monthSelect.innerHTML = '<option value="all">All months</option>';
  months.forEach(m => {
    const d = new Date(m + "-01");
    const label = d.toLocaleString("en-IN", { month: "short", year: "numeric" });
    el.monthSelect.insertAdjacentHTML("beforeend", `<option value="${m}">${label}</option>`);
  });
}

function populateCategoryFilters() {
  const baseCats = ["Salary","Food","Travel","Shopping","Bills","Other"];
  const cats = Array.from(new Set([...baseCats, ...uniqueCategories()]));
  const catOptions = ['<option value="all">All categories</option>']
    .concat(cats.map(c => `<option value="${c}">${c}</option>`)).join("");
  el.categoryFilter.innerHTML = catOptions;
  const catSelect = document.getElementById("category");
  if (catSelect) catSelect.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join("");
}

function refreshUI() {
  populateMonthSelect();
  populateCategoryFilters();
  const filtered = applyFilters();
  renderSummary(filtered);
  renderChart(filtered);
  renderTransactions(filtered);
}

// ---------- Form handling ----------
document.getElementById("addForm").addEventListener("submit", (e)=>{
  e.preventDefault();
  const title = el.title.value.trim();
  const amount = Number(el.amount.value);
  const date = el.date.value;
  const category = el.category.value;
  const type = document.querySelector('input[name="type"]:checked').value;

  if (!title || !date || !amount) return;

  const tx = {
    id: cryptoRandomId(),
    title, amount: Math.abs(amount), date, category, type
  };

  transactions.push(tx);
  saveTransactionsForCurrentUser(transactions);
  refreshUI();

  el.title.value = "";
  el.amount.value = "";
  el.date.value = "";
  document.getElementById("title").focus();
});

// month & category filters
el.monthSelect.addEventListener("change", refreshUI);
el.categoryFilter.addEventListener("change", refreshUI);

// ---------- Dark mode ----------
function initDarkMode() {
  const saved = localStorage.getItem("pf_dark") === "1";
  document.body.classList.toggle("dark", saved);
  el.darkToggle.checked = saved;
}
el.darkToggle.addEventListener("change", (e) => {
  const on = e.target.checked;
  document.body.classList.toggle("dark", on);
  localStorage.setItem("pf_dark", on ? "1" : "0");
});

// ---------- small utils ----------
function cryptoRandomId() {
  return (crypto.getRandomValues(new Uint32Array(2)).join("-") + "-" + Date.now()).replace(/\s+/g,"");
}
function getRelativeDate(offsetDays=0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------- AUTH logic (register / login / logout) ----------
el.showLoginBtn.addEventListener("click", ()=>{ toggleAuthView("login"); });
el.showRegisterBtn.addEventListener("click", ()=>{ toggleAuthView("register"); });

function toggleAuthView(which='login') {
  if (which === "login") {
    el.loginForm.classList.remove("hidden");
    el.registerForm.classList.add("hidden");
    el.showLoginBtn.classList.add("active");
    el.showRegisterBtn.classList.remove("active");
  } else {
    el.loginForm.classList.add("hidden");
    el.registerForm.classList.remove("hidden");
    el.showLoginBtn.classList.remove("active");
    el.showRegisterBtn.classList.add("active");
  }
}

// register
el.doRegister.addEventListener("click", async (e)=>{
  e.preventDefault();
  el.regError.textContent = "";

  const name = (el.regName.value || "").trim();
  const email = (el.regEmail.value || "").trim().toLowerCase();
  const pass = el.regPassword.value || "";
  const confirm = el.regConfirm.value || "";

  if (!name || !email || !pass || !confirm) { el.regError.textContent = "Please fill all fields."; return; }
  if (pass.length < 6) { el.regError.textContent = "Password must be 6+ characters."; return; }
  if (pass !== confirm) { el.regError.textContent = "Passwords do not match."; return; }
  if (findUserByEmail(email)) { el.regError.textContent = "Email already registered. Login instead."; return; }

  const passHash = await hashStringSHA256(pass);
  const newUser = { id: cryptoRandomId(), name, email, passwordHash: passHash };
  const users = loadUsers();
  users.push(newUser);
  saveUsers(users);

  // create small seed transactions for new user
  const seed = [
    {id: cryptoRandomId(), title:"Welcome Bonus", amount:1000, date:getRelativeDate(-3), category:"Other", type:"income"},
    {id: cryptoRandomId(), title:"Coffee", amount:120, date:getRelativeDate(-2), category:"Food", type:"expense"}
  ];
  localStorage.setItem(userLSKey(newUser.id), JSON.stringify(seed));

  // auto-login after register (remember by default)
  setSession(newUser, true);
  bootAppForUser();
});

// login
el.doLogin.addEventListener("click", async (e)=>{
  e.preventDefault();
  el.loginError.textContent = "";

  const email = (el.loginEmail.value || "").trim().toLowerCase();
  const pass = el.loginPassword.value || "";

  if (!email || !pass) { el.loginError.textContent = "Please enter email and password."; return; }

  const user = findUserByEmail(email);
  if (!user) { el.loginError.textContent = "No account found for that email."; return; }

  const passHash = await hashStringSHA256(pass);
  if (passHash !== user.passwordHash) { el.loginError.textContent = "Incorrect password."; return; }

  setSession(user, el.rememberMe.checked);
  bootAppForUser();
});

// logout
el.logoutBtn.addEventListener("click", ()=>{
  clearSession();
  shutdownAppToAuth();
});

// ---------- App boot / shutdown ----------
function bootAppForUser() {
  // load currentUser from sessionStorage/localStorage
  const u = loadSession(); // sets currentUser
  if (!u) return shutdownAppToAuth();

  // set UI visible
  el.authScreen.classList.add("hidden");
  el.topbar.classList.remove("hidden");
  el.mainApp.classList.remove("hidden");
  el.footer.classList.remove("hidden");
  el.currentUserLabel.textContent = `${currentUser.name} • ${currentUser.email}`;

  // load transactions
  transactions = loadTransactionsForCurrentUser();

  // if no transactions, seed example (only first login)
  if (!transactions || transactions.length === 0) {
    transactions = [
      {id: cryptoRandomId(), title:"Salary", amount:40000, date:getRelativeDate(-18), category:"Salary", type:"income"},
      {id: cryptoRandomId(), title:"Groceries", amount:2200, date:getRelativeDate(-16), category:"Food", type:"expense"},
      {id: cryptoRandomId(), title:"Electric Bill", amount:1200, date:getRelativeDate(-12), category:"Bills", type:"expense"},
    ];
    saveTransactionsForCurrentUser(transactions);
  }

  // initialize UI pieces
  initDarkMode();
  refreshUI();
}

// hide app and show auth
function shutdownAppToAuth() {
  el.authScreen.classList.remove("hidden");
  el.topbar.classList.add("hidden");
  el.mainApp.classList.add("hidden");
  el.footer.classList.add("hidden");

  // clear sensitive fields
  el.loginPassword.value = "";
  el.regPassword.value = "";
  el.regConfirm.value = "";

  // reset chart
  if (pieChart) {
    pieChart.destroy();
    pieChart = null;
  }
}

// ---------- init on load ----------
(function init() {
  // try to restore session
  const session = loadSession();
  if (session) {
    // session exists; boot app
    bootAppForUser();
  } else {
    // no session; show auth
    shutdownAppToAuth();
  }

  // wire small UI actions
  toggleAuthView("login");

  // focus
  el.loginEmail && el.loginEmail.focus();
})();
