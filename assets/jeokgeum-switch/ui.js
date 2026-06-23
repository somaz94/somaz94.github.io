import {
  BASELINE_INPUTS,
  FUTURE_BONUS_PLANS,
  INCOME_TIERS,
  computeOutcome,
  buildLeapDeposits,
  afterTaxRate,
  checkLeapLimits,
} from "./engine.js";
import {
  REFERENCE_LINKS,
  FUTURE_BANK_TABLE,
  FUTURE_SPEC,
  LEAP_BONUS_TABLE,
  LINKED_EXIT_NOTES,
} from "./dataset.js";

const dom = {
  inputs: {
    leapOpenDate: document.querySelector("#leapOpenDate"),
    leapCloseDate: document.querySelector("#leapCloseDate"),
    futureOpenDate: document.querySelector("#futureOpenDate"),
    depositDom: document.querySelector("#depositDom"),
    autoDepositAmount: document.querySelector("#autoDepositAmount"),
    planDepositAmount: document.querySelector("#planDepositAmount"),
    leapEarlyRate: document.querySelector("#leapEarlyRate"),
    leapMatureRate1: document.querySelector("#leapMatureRate1"),
    leapMatureRate2: document.querySelector("#leapMatureRate2"),
    leapMatureRate3: document.querySelector("#leapMatureRate3"),
    leapBonusRate1: document.querySelector("#leapBonusRate1"),
    leapBonusRate2: document.querySelector("#leapBonusRate2"),
    leapBonusRate3: document.querySelector("#leapBonusRate3"),
    futureRate: document.querySelector("#futureRate"),
    futureBonusRate: document.querySelector("#futureBonusRate"),
    sideFundRate: document.querySelector("#sideFundRate"),
    futureBonusPlan: document.querySelector("#futureBonusPlan"),
  },
  autoDepositAmountHint: document.querySelector("#autoDepositAmountHint"),
  planDepositAmountHint: document.querySelector("#planDepositAmountHint"),
  tierFields: document.querySelector("#tierFields"),
  bankPick: document.querySelector("#bankPick"),
  bankDetail: document.querySelector("#bankDetail"),
  depositRows: document.querySelector("#depositRows"),
  limitAlerts: document.querySelector("#limitAlerts"),
  bankCards: document.querySelector("#bankCards"),
  bankFilter: document.querySelector("#bankFilter"),
  rateDateText: document.querySelector("#rateDateText"),
  noteList: document.querySelector("#noteList"),
  ruleList: document.querySelector("#ruleList"),
  verdictText: document.querySelector("#verdictText"),
  verdictNote: document.querySelector("#verdictNote"),
  gapText: document.querySelector("#gapText"),
  topupText: document.querySelector("#topupText"),
  netRateText: document.querySelector("#netRateText"),
  netRateInline: document.querySelector("#netRateInline"),
  evenRateText: document.querySelector("#evenRateText"),
  finishDateText: document.querySelector("#finishDateText"),
  holdTotalText: document.querySelector("#holdTotalText"),
  moveTotalText: document.querySelector("#moveTotalText"),
  holdBar: document.querySelector("#holdBar"),
  moveBar: document.querySelector("#moveBar"),
  breakdownList: document.querySelector("#breakdownList"),
  topupList: document.querySelector("#topupList"),
  runButton: document.querySelector("#runButton"),
  runStatus: document.querySelector("#runStatus"),
  summaryBand: document.querySelector(".verdict-band"),
  linkedRateHelp: document.querySelector("#linkedRateHelp"),
};

let depositRows = [];
let latestOutcome = null;
let depositsTouched = false;
let saveReady = false;
let restoring = false;
let dirty = false;

const SAVE_KEY = "jeokgeumSwitch:v1";
const TAB_IDS = ["inputs", "history", "rates", "details", "logic"];
const AUTO_DEPOSIT_FIELDS = new Set([
  "leapOpenDate",
  "leapCloseDate",
  "depositDom",
  "autoDepositAmount",
]);

boot();

function boot() {
  applyBaseline();
  drawBonusPlanOptions();
  drawTierFields();
  drawBankOptions();
  drawNotes();
  drawLinkedRateHelp();
  // A shared link (?s=...) takes priority over the locally saved state so the
  // recipient sees exactly the scenario that was shared with them.
  const savedState = loadShared() || loadSaved();
  if (savedState) {
    restoreSaved(savedState);
  } else {
    depositRows = buildLeapDeposits(readInputs());
  }
  wireEvents();
  drawDepositRows();
  drawAmountHints(readInputs());
  saveReady = true;
  openTab(savedState?.activeTab || "inputs");
  runCalc();
}

function applyBaseline() {
  for (const [key, input] of Object.entries(dom.inputs)) {
    if (input && key in BASELINE_INPUTS) {
      input.value = BASELINE_INPUTS[key];
    }
  }
}

function drawBonusPlanOptions() {
  dom.inputs.futureBonusPlan.innerHTML = Object.entries(FUTURE_BONUS_PLANS)
    .map(([id, item]) => `<option value="${id}">${item.label}</option>`)
    .join("");
  dom.inputs.futureBonusPlan.value = BASELINE_INPUTS.futureBonusPlan;
}

function drawTierFields(values = BASELINE_INPUTS.tiersByYear) {
  const selectedValues = Array.isArray(values) ? values : BASELINE_INPUTS.tiersByYear;
  dom.tierFields.innerHTML = BASELINE_INPUTS.tiersByYear
    .map((value, index) => {
      const selectedValue = INCOME_TIERS.some((bracket) => bracket.id === selectedValues[index])
        ? selectedValues[index]
        : value;
      const options = INCOME_TIERS.map(
        (bracket) =>
          `<option value="${bracket.id}" ${bracket.id === selectedValue ? "selected" : ""}>${bracket.label}</option>`,
      ).join("");
      return `
        <label>
          ${index + 1}년차 소득구간
          <select class="tier-select" data-index="${index}">${options}</select>
        </label>
      `;
    })
    .join("");
}

function drawBankOptions(selectedBank = "우리은행") {
  dom.bankPick.innerHTML = FUTURE_BANK_TABLE.map(
    (bank) => `<option value="${attrEscape(bank.bank)}">${bank.bank}</option>`,
  ).join("");
  dom.bankPick.value = FUTURE_BANK_TABLE.some((bank) => bank.bank === selectedBank)
    ? selectedBank
    : "우리은행";
  dom.rateDateText.textContent = `전국은행연합회 비교공시 기준일자: ${fmtDotDate(FUTURE_SPEC.asOf)}`;
  drawBankDetail();
  drawBankCards();
}

function wireEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      openTab(button.dataset.tab);
      persist();
    });
  });

  Object.entries(dom.inputs).forEach(([key, input]) => {
    input.addEventListener("input", () => onSettingInput(key));
    input.addEventListener("change", () => onSettingInput(key));
  });

  dom.runButton.addEventListener("click", runCalc);
  dom.tierFields.addEventListener("change", markStale);
  dom.bankPick.addEventListener("change", () => {
    drawBankDetail();
    persist();
  });
  dom.bankFilter.addEventListener("input", drawBankCards);

  document.querySelectorAll(".tip-button").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = document.getElementById(button.getAttribute("aria-describedby"));
      panel?.classList.remove("is-closed");
    });
  });
  document.querySelectorAll(".tip-close").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.closest(".tip-panel");
      panel?.classList.add("is-closed");
      panel?.closest(".tip-wrap")?.querySelector(".tip-button")?.blur();
      button.blur();
    });
  });

  document.querySelector("#rebuildDeposits").addEventListener("click", () => {
    depositRows = buildLeapDeposits(readInputs());
    depositsTouched = false;
    drawDepositRows();
    // Jump to the 납입 이력 tab so the freshly built rows are actually on screen,
    // then recompute — otherwise the click leaves the visible tab unchanged.
    openTab("history");
    runCalc();
    flashToast(`납입 이력 ${depositRows.length}건을 새로 만들었어요`);
  });

  document.querySelector("#clearSaved").addEventListener("click", clearSaved);

  document.querySelector("#applyTierToAll").addEventListener("click", () => {
    const selects = Array.from(document.querySelectorAll(".tier-select"));
    if (!selects.length) {
      return;
    }
    const firstValue = selects[0].value;
    selects.forEach((select) => {
      select.value = firstValue;
    });
    markStale();
    runCalc();
    const label = INCOME_TIERS.find((tier) => tier.id === firstValue)?.label || firstValue;
    flashToast(`1년차 소득구간(${label})을 전체 연차에 적용했어요`);
  });

  document.querySelector("#copyResultButton").addEventListener("click", async () => {
    if (!latestOutcome) {
      flashToast("먼저 계산을 완료해 주세요");
      return;
    }
    const ok = await copyText(buildResultSummary(latestOutcome));
    flashToast(ok ? "결과 요약을 복사했어요" : "복사에 실패했어요. 화면에서 직접 확인해 주세요");
  });

  document.querySelector("#shareButton").addEventListener("click", async () => {
    const ok = await copyText(buildShareUrl());
    flashToast(ok ? "공유 링크를 복사했어요" : "복사에 실패했어요. 주소창의 링크를 사용해 주세요");
  });

  document.querySelector("#addDepositRow").addEventListener("click", () => {
    depositsTouched = true;
    depositRows.push({
      id: `manual-${Date.now()}`,
      date: dom.inputs.leapCloseDate.value,
      amount: Number(dom.inputs.autoDepositAmount.value || 0),
    });
    drawDepositRows();
    markStale();
  });
}

function onSettingInput(key) {
  if (AUTO_DEPOSIT_FIELDS.has(key) && !depositsTouched) {
    try {
      depositRows = buildLeapDeposits(readInputs());
      drawDepositRows();
    } catch {
      // The user may be midway through editing a date; the explicit calculation step will report the error.
    }
  }
  const settings = readInputs();
  drawNetRate(settings);
  drawAmountHints(settings);
  markStale();
}

function openTab(tabName) {
  if (!TAB_IDS.includes(tabName)) {
    return;
  }
  document.querySelectorAll(".tab").forEach((button) => {
    const selected = button.dataset.tab === tabName;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
  document.querySelectorAll(".tabset-pane").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${tabName}`);
  });
}

function readInputs() {
  return {
    leapOpenDate: dom.inputs.leapOpenDate.value,
    leapCloseDate: dom.inputs.leapCloseDate.value,
    futureOpenDate: dom.inputs.futureOpenDate.value,
    depositDom: dom.inputs.depositDom.value,
    autoDepositAmount: dom.inputs.autoDepositAmount.value,
    planDepositAmount: dom.inputs.planDepositAmount.value,
    leapEarlyRate: dom.inputs.leapEarlyRate.value,
    leapMatureRate1: dom.inputs.leapMatureRate1.value,
    leapMatureRate2: dom.inputs.leapMatureRate2.value,
    leapMatureRate3: dom.inputs.leapMatureRate3.value,
    leapBonusRate1: dom.inputs.leapBonusRate1.value,
    leapBonusRate2: dom.inputs.leapBonusRate2.value,
    leapBonusRate3: dom.inputs.leapBonusRate3.value,
    futureRate: dom.inputs.futureRate.value,
    futureBonusRate: dom.inputs.futureBonusRate.value,
    sideFundRate: dom.inputs.sideFundRate.value,
    futureBonusPlan: dom.inputs.futureBonusPlan.value,
    tiersByYear: Array.from(document.querySelectorAll(".tier-select")).map(
      (select) => select.value,
    ),
  };
}

function loadSaved() {
  try {
    const raw = window.localStorage?.getItem(SAVE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function restoreSaved(savedState) {
  restoring = true;
  try {
    const settings = savedState.settings || {};
    for (const [key, input] of Object.entries(dom.inputs)) {
      if (input && settings[key] !== undefined && settings[key] !== null) {
        input.value = settings[key];
      }
    }
    drawTierFields(settings.tiersByYear);
    drawBankOptions(savedState.selectedBank);

    const savedRows = cleanSavedRows(savedState.depositRows);
    depositRows = savedRows.length ? savedRows : buildLeapDeposits(readInputs());
    depositsTouched = savedRows.length ? Boolean(savedState.depositsTouched) : false;
  } finally {
    restoring = false;
  }
}

function cleanSavedRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .filter((row) => typeof row?.date === "string")
    .map((row, index) => ({
      id: String(row.id || `saved-${index}-${row.date}`),
      date: row.date,
      amount: Number(row.amount || 0),
    }));
}

function persist() {
  if (!saveReady || restoring) {
    return;
  }
  try {
    window.localStorage?.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        settings: readInputs(),
        selectedBank: dom.bankPick.value,
        activeTab: currentTab(),
        depositRows: depositRows.map((row) => ({
          id: row.id,
          date: row.date,
          amount: row.amount,
        })),
        depositsTouched,
      }),
    );
  } catch {
    // Storage can be unavailable in hardened browser modes; calculation still works without persistence.
  }
}

function clearSaved() {
  try {
    window.localStorage?.removeItem(SAVE_KEY);
  } catch {
    // Ignore storage errors and still reset the in-memory form.
  }

  restoring = true;
  try {
    depositsTouched = false;
    applyBaseline();
    drawTierFields();
    drawBankOptions();
    depositRows = buildLeapDeposits(readInputs());
  } finally {
    restoring = false;
  }

  drawDepositRows();
  openTab("inputs");
  // A reset is a deliberate action, so recompute immediately and confirm it
  // visibly instead of leaving the form in a silent "변경사항 있음" state.
  runCalc();
  flashToast("기본값으로 초기화했어요");
}

// Read a shared scenario from the ?s= query param. Same shape as the saved state
// so restoreSaved() can consume it directly.
function loadShared() {
  try {
    const raw = new URLSearchParams(window.location.search).get("s");
    if (!raw) {
      return null;
    }
    const parsed = decodeState(raw);
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function buildShareUrl() {
  const state = {
    version: 1,
    settings: readInputs(),
    selectedBank: dom.bankPick.value,
    activeTab: currentTab(),
    depositsTouched,
    // Only embed rows when the user hand-edited them; auto-generated rows are
    // rebuilt from settings on the recipient side to keep the link short.
    depositRows: depositsTouched
      ? depositRows.map((row) => ({ date: row.date, amount: row.amount }))
      : [],
  };
  const url = new URL(window.location.href);
  url.searchParams.set("s", encodeState(state));
  return url.toString();
}

function buildResultSummary(result) {
  const verdict =
    result.winner === "switch"
      ? "청년미래적금 전환 우위"
      : result.winner === "keep"
        ? "청년도약계좌 유지 우위"
        : "두 선택이 거의 동일";
  const diff = `${result.difference >= 0 ? "+" : "-"}${fmtWon(Math.abs(result.difference))}`;
  const evenRate = result.breakEven
    ? `${fmtPct(result.breakEven.preTaxRate)} 세전 (${fmtPct(result.breakEven.afterTaxRate)} 세후)`
    : "범위 내 없음";
  return [
    "[청년 적금 갈아타기 손익 계산]",
    `판정: ${verdict}`,
    `최종 외부 현금 차이: ${diff}`,
    `도약 유지: ${fmtWon(result.cash.finalA)}`,
    `미래 전환: ${fmtWon(result.cash.finalB)}`,
    `손익분기 세전 연이율: ${evenRate}`,
    `계산 종료일: ${result.dates.comparisonEndDate}`,
    `${window.location.origin}/jeokgeum-switch/`,
  ].join("\n");
}

// UTF-8 safe base64 round-trip for the share payload (Korean labels included).
function encodeState(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeState(text) {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API can be blocked outside secure contexts; fall back below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "absolute";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

let toastTimer = null;
function flashToast(message) {
  let el = document.querySelector("#actionToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "actionToast";
    el.className = "action-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-shown");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-shown"), 2400);
}

function drawDepositRows() {
  dom.depositRows.innerHTML = depositRows
    .map(
      (row) => `
        <tr data-id="${attrEscape(row.id)}">
          <td><input type="date" value="${attrEscape(row.date)}" data-field="date" aria-label="납입일" /></td>
          <td><input type="number" min="0" step="1000" value="${attrEscape(row.amount)}" data-field="amount" aria-label="납입금액" /></td>
          <td><button class="remove-button" type="button" data-action="delete">삭제</button></td>
        </tr>
      `,
    )
    .join("");

  dom.depositRows.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", onDepositEdit);
    input.addEventListener("change", onDepositEdit);
  });
  dom.depositRows.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.closest("tr").dataset.id;
      depositsTouched = true;
      depositRows = depositRows.filter((row) => row.id !== id);
      drawDepositRows();
      markStale();
    });
  });
}

function onDepositEdit(event) {
  const rowEl = event.target.closest("tr");
  const row = depositRows.find((item) => item.id === rowEl.dataset.id);
  if (!row) return;
  depositsTouched = true;
  row[event.target.dataset.field] =
    event.target.dataset.field === "amount" ? Number(event.target.value || 0) : event.target.value;
  markStale();
}

function drawBankDetail() {
  const bank = FUTURE_BANK_TABLE.find((item) => item.bank === dom.bankPick.value) || FUTURE_BANK_TABLE[0];
  dom.bankDetail.innerHTML = `
    <div class="rate-row">
      <span class="pill">기본 ${fmtPct(bank.baseRate)}</span>
      <span class="pill">최고 ${fmtPct(bank.maxRate)}</span>
      <span class="pill">제공일 ${bank.providedDate}</span>
    </div>
    ${textBlock("요약", bank.summary)}
    ${textBlock("상세조건", bank.conditions)}
    ${textBlock("만기 후 금리", bank.afterMaturity)}
    ${bank.notes ? textBlock("유의사항", bank.notes) : ""}
  `;
}

function drawBankCards() {
  const keyword = dom.bankFilter.value.trim().toLowerCase();
  const banks = FUTURE_BANK_TABLE.filter((bank) => {
    const text = `${bank.bank} ${bank.summary} ${bank.conditions}`.toLowerCase();
    return !keyword || text.includes(keyword);
  });

  dom.bankCards.innerHTML = banks
    .map(
      (bank) => `
        <article class="bank-tile">
          <h3>${bank.bank}</h3>
          <div class="rate-row">
            <span class="pill">기본 ${fmtPct(bank.baseRate)}</span>
            <span class="pill">최고 ${fmtPct(bank.maxRate)}</span>
            <span class="pill">제공일 ${bank.providedDate}</span>
          </div>
          ${textBlock("우대항목", bank.summary)}
          ${textBlock("상세조건", bank.conditions)}
          ${textBlock("만기 후 금리", bank.afterMaturity)}
          ${bank.notes ? textBlock("유의사항", bank.notes) : ""}
        </article>
      `,
    )
    .join("");
}

function runCalc() {
  const settings = readInputs();
  drawNetRate(settings);
  let validation = { issues: [] };

  try {
    validation = checkLeapLimits(depositRows, settings.leapOpenDate);
    drawAlerts(validation);
    latestOutcome = computeOutcome(settings, depositRows);
    drawResult(latestOutcome);
  } catch (error) {
    latestOutcome = null;
    drawAlerts(validation);
    dom.verdictText.textContent = "입력값 확인 필요";
    dom.verdictNote.textContent = error.message;
  } finally {
    dirty = false;
    syncRunState();
    drawRules(settings, latestOutcome, validation);
    persist();
  }
}

function drawNetRate(settings) {
  dom.netRateInline.textContent = fmtPct(afterTaxRate(settings.sideFundRate));
}

// Show a "= NN만원" readout under raw-won amount inputs so large numbers are easy to read.
function drawAmountHints(settings) {
  dom.autoDepositAmountHint.textContent = fmtManwon(settings.autoDepositAmount);
  dom.planDepositAmountHint.textContent = fmtManwon(settings.planDepositAmount);
}

function markStale() {
  if (restoring) {
    return;
  }
  dirty = true;
  syncRunState();
  persist();
}

function syncRunState() {
  dom.runStatus.textContent = dirty ? "변경사항 있음" : "계산 완료";
  dom.runStatus.classList.toggle("is-pending", dirty);
  dom.runButton.classList.toggle("is-pending", dirty);
  dom.summaryBand.classList.toggle("is-stale", dirty);
}

function drawAlerts(validation) {
  if (!validation.issues.length) {
    dom.limitAlerts.innerHTML = "";
    return;
  }
  dom.limitAlerts.innerHTML = validation.issues
    .map(
      (issue) =>
        `<div class="alert-item">${issue.message} 현재 ${fmtWon(issue.total)}, 한도 ${fmtWon(issue.limit)}</div>`,
    )
    .join("");
}

function drawResult(result) {
  const differenceAbs = Math.abs(result.difference);
  const keepText = fmtWon(result.cash.finalA);
  const switchText = fmtWon(result.cash.finalB);

  if (result.winner === "switch") {
    dom.verdictText.textContent = "청년미래적금 전환 우위";
    dom.verdictNote.textContent = `전환 시 최종 외부 현금이 ${fmtWon(differenceAbs)} 더 큽니다.`;
  } else if (result.winner === "keep") {
    dom.verdictText.textContent = "청년도약계좌 유지 우위";
    dom.verdictNote.textContent = `유지 시 최종 외부 현금이 ${fmtWon(differenceAbs)} 더 큽니다.`;
  } else {
    dom.verdictText.textContent = "두 선택이 거의 동일";
    dom.verdictNote.textContent = "최종 외부 현금 차이가 1원 미만입니다.";
  }

  dom.summaryBand.classList.toggle("winner-keep", result.winner === "keep");
  dom.summaryBand.classList.toggle("winner-switch", result.winner === "switch");

  dom.gapText.textContent = `${result.difference >= 0 ? "+" : "-"}${fmtWon(differenceAbs)}`;
  dom.topupText.textContent = fmtWon(result.cash.totalInjected);
  dom.netRateText.textContent = fmtPct(result.rates.externalAfterTaxRate);
  dom.evenRateText.textContent = result.breakEven
    ? `${fmtPct(result.breakEven.preTaxRate)} 세전 (${fmtPct(result.breakEven.afterTaxRate)} 세후)`
    : "범위 내 없음";
  dom.finishDateText.textContent = result.dates.comparisonEndDate;
  dom.holdTotalText.textContent = keepText;
  dom.moveTotalText.textContent = switchText;

  const maxFinal = Math.max(1, result.cash.finalA, result.cash.finalB);
  dom.holdBar.style.width = `${Math.max(2, (result.cash.finalA / maxFinal) * 100)}%`;
  dom.moveBar.style.width = `${Math.max(2, (result.cash.finalB / maxFinal) * 100)}%`;

  drawBreakdown(result);
  drawTopups(result);
}

function drawBreakdown(result) {
  const groups = [
    ["도약 특별중도해지 지급", result.payouts.earlyLeapPayout],
    ["도약 유지 만기 지급", result.payouts.maintainedLeapPayout],
    ["미래적금 만기 지급", result.payouts.futurePayout],
  ];

  dom.breakdownList.innerHTML = groups
    .map(
      ([title, payout]) => `
        <article class="part-item">
          <h3>${title}</h3>
          <div class="pair-grid">
            <span>원금</span><strong>${fmtWon(payout.principal)}</strong>
            <span>원금 이자</span><strong>${fmtWon(payout.principalInterest)}</strong>
            <span>정부기여금</span><strong>${fmtWon(payout.contribution)}</strong>
            <span>기여금 이자</span><strong>${fmtWon(payout.contributionInterest)}</strong>
            <span>합계</span><strong>${fmtWon(payout.total)}</strong>
          </div>
        </article>
      `,
    )
    .join("");
}

function drawTopups(result) {
  if (!result.cash.injections.length) {
    dom.topupList.innerHTML = `<div class="log-item">추가 납입필요가 발생하지 않았습니다.</div>`;
    return;
  }
  dom.topupList.innerHTML = result.cash.injections
    .slice(0, 30)
    .map(
      (event) => `
        <article class="log-item">
          <h3>${event.date}</h3>
          <div class="pair-grid">
            <span>추가 투입</span><strong>${fmtWon(event.amount)}</strong>
            <span>도약 유지 잔액</span><strong>${fmtWon(event.balanceA)}</strong>
            <span>미래 전환 잔액</span><strong>${fmtWon(event.balanceB)}</strong>
          </div>
        </article>
      `,
    )
    .join("");
}

function drawNotes() {
  const contributionRows = LEAP_BONUS_TABLE.rows
    .map((row) => `${row.label}: 월 최대 ${fmtWon(row.monthlyCap)}`)
    .join("<br>");
  dom.noteList.innerHTML = `
    <div class="ref-item">
      <strong>청년도약계좌 기여금</strong>
      <p>${LEAP_BONUS_TABLE.note}<br>${contributionRows}</p>
    </div>
    <div class="ref-item">
      <strong>청년미래적금 구조</strong>
      <p>월 최대 ${fmtWon(FUTURE_SPEC.monthlyCap)}, 연 ${fmtWon(FUTURE_SPEC.yearlyCap)}, ${FUTURE_SPEC.months}개월. 일반형 6%, 우대형 12% 정부기여금을 반영하고, 정부기여금 이자는 기본금리 기준으로 별도 계산합니다.</p>
    </div>
    ${REFERENCE_LINKS.map(
      (source) =>
        `<div class="ref-item"><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.label}</a></div>`,
    ).join("")}
  `;
}

function drawLinkedRateHelp() {
  dom.linkedRateHelp.innerHTML = `
    <div class="tip-panel-head">
      <div class="tip-title">갈아타려고 해지해도 우대금리 받을 수 있나요?</div>
      <button class="tip-close" type="button" aria-label="도움말 닫기">닫기</button>
    </div>
    <p class="tip-summary">미래적금으로 갈아타려고 도약계좌를 특별중도해지해도, 확인된 은행들은 그동안 쌓은 우대금리를 인정해줘요. 급여이체·카드실적 같은 조건은 보통 해지 뒤 만기까지 채운 걸로 봐주지만, 해지 전에 실적이 하나도 없으면 빠집니다. 은행별 상세는 아래를 참고하세요.</p>
    <div class="tip-note-grid">
      ${LINKED_EXIT_NOTES.map(
        (item) => `
          <section class="tip-note">
            <div class="tip-note-head">
              <strong>${htmlEscape(item.bank)}</strong>
              <span class="status-tag ${attrEscape(item.statusType)}">${htmlEscape(item.status)}</span>
            </div>
            <p>${htmlEscape(item.summary)}</p>
            <small>${htmlEscape(item.source)}</small>
          </section>
        `,
      ).join("")}
    </div>
  `;
}

function drawRules(settings, result, validation) {
  const futureBonusPlan =
    FUTURE_BONUS_PLANS[settings.futureBonusPlan] || FUTURE_BONUS_PLANS.regular;
  const maturityScheduleText = result?.rates?.leapMatureSchedule
    ? fmtSchedule(result.rates.leapMatureSchedule)
    : "계산 성공 후 표시됩니다.";
  const contributionScheduleText = result?.rates?.leapBonusSchedule
    ? fmtSchedule(result.rates.leapBonusSchedule)
    : "계산 성공 후 표시됩니다.";
  const limitText = validation.issues.length
    ? validation.issues.map((issue) => `${issue.message} 현재 ${fmtWon(issue.total)}`).join("\n")
    : "현재 납입 이력에는 월/납입연도 한도 위반이 없습니다.";

  const sections = [
    {
      title: "비교 기준일",
      body: [
        `청년도약계좌 특별중도해지일은 ${settings.leapCloseDate}, 청년미래적금 가입일은 ${settings.futureOpenDate}로 둡니다.`,
        `비교 종료일은 두 상품 만기일 중 늦은 날짜입니다${result ? `: ${result.dates.comparisonEndDate}` : ""}.`,
        "전환 시나리오는 해지일에 도약계좌 특별중도해지 지급액을 외부 현금 계정에 받는 것으로 처리합니다.",
      ],
    },
    {
      title: "청년도약계좌 납입일",
      body: [
        `가입일은 ${settings.leapOpenDate}, 기본 입금일은 매월 ${settings.depositDom}일입니다.`,
        "가입월과 매년 가입월은 max(기본 입금일, 해당 연도 가입기념일)을 납입 가능일로 봅니다.",
        "가입월이 아닌 달은 기본 입금일을 사용하되, 그 달에 해당 일이 없으면 말일로 보정합니다.",
        "2월 29일 기준은 비윤년 2월 28일을 같은 납입 가능일로 봅니다.",
        "해지월의 납입 가능일이 해지일보다 늦으면 그 달 납입은 생성하지 않습니다.",
      ],
    },
    {
      title: "청년도약계좌 한도",
      body: [
        `월 한도는 ${fmtWon(700000)}, 납입연도 한도는 ${fmtWon(8400000)}입니다.`,
        "연 한도는 달력연도가 아니라 가입일 기준 1년 단위 납입연도로 검증합니다.",
        limitText,
      ],
    },
    {
      title: "청년도약계좌 금리",
      body: [
        `특별중도해지 원금 이자는 단일 입력금리 ${fmtPct(settings.leapEarlyRate)}로 계산합니다.`,
        "만기 유지 시 원금 이자는 1~36개월 고정금리, 37~48개월 변동금리 예상값, 49~60개월 변동금리 예상값으로 나눠 단리 일할 계산합니다.",
        maturityScheduleText,
        "정부기여금 이자도 정산일부터 만기일까지 같은 방식의 3구간 금리 스케줄로 나눠 계산합니다.",
        contributionScheduleText,
      ],
    },
    {
      title: "청년도약계좌 기여금",
      body: [
        "월 납입총액을 기준으로 다음 달 10일 정부기여금이 정산되는 것으로 처리합니다.",
        "2025년 1월 납입분부터 확대 기여금 구조를 적용합니다.",
        "소득구간 1년차는 가입일부터 다음 해 가입월 말일까지, 2년차부터는 매년 가입월 다음 달 1일부터 적용합니다.",
        "2026년 7월 전환 가정에서는 도약계좌 7월 납입분 기여금을 받는 것으로 보되, 정산일이 해지일 이후이면 이자는 0원입니다.",
      ],
    },
    {
      title: "청년미래적금",
      body: [
        `월 납입액은 설정 월납입액 ${fmtWon(settings.planDepositAmount)}과 월 한도 ${fmtWon(500000)} 중 작은 금액입니다.`,
        "가입월과 매년 가입월의 납입일 보정은 청년도약계좌와 같은 방식으로 적용합니다.",
        `정부기여금 유형은 ${futureBonusPlan.label}입니다.`,
        "일반형은 월 납입액의 6%, 월 30,000원 한도이고 우대형은 월 납입액의 12%, 월 60,000원 한도입니다.",
        `정부기여금 이자는 미래적금 적용 금리와 분리해 ${fmtPct(settings.futureBonusRate)}로 계산합니다.`,
      ],
    },
    {
      title: "외부 현금 계정",
      body: [
        `외부 돈 세전 연이율 ${fmtPct(settings.sideFundRate)}를 15.4% 과세 후 ${fmtPct(afterTaxRate(settings.sideFundRate))} 세후 연이율로 바꿉니다.`,
        "세후 연이율은 (1 + 세후연이율)^(1/365) - 1 방식으로 일이율 복리 환산합니다.",
        "각 날짜의 해지/만기 지급과 납입 이벤트를 반영한 뒤, 음수 잔액이 생기면 두 시나리오가 모두 0 이상이 되는 최소 금액을 추가 투입으로 기록합니다.",
        "날짜가 다음 날로 넘어갈 때 외부 현금 계정 잔액에 일이율을 곱해 이자를 반영합니다.",
      ],
    },
    {
      title: "손익분기",
      body: [
        "손익분기 외부 세전 연이율은 -20%~30% 범위에서 부호 변화를 찾고 이분법으로 근사합니다.",
        result?.breakEven
          ? `현재 손익분기값은 세전 ${fmtPct(result.breakEven.preTaxRate)}, 세후 ${fmtPct(result.breakEven.afterTaxRate)}입니다.`
          : "현재 설정에서는 탐색 범위 안에서 손익분기값이 없습니다.",
      ],
    },
  ];

  dom.ruleList.innerHTML = sections
    .map(
      (section) => `
        <article class="rule-item">
          <h3>${htmlEscape(section.title)}</h3>
          <ul>
            ${section.body.map((line) => `<li>${htmlEscape(line)}</li>`).join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

function fmtSchedule(schedule) {
  return schedule
    .map(
      (segment) =>
        `${segment.label}: ${segment.startDate}부터 ${segment.endDate} 전일까지 ${fmtPct(segment.annualRate)}`,
    )
    .join("\n");
}

function textBlock(title, value) {
  if (!value) {
    return "";
  }
  return `<p class="note-block"><strong>${htmlEscape(title)}</strong>${htmlEscape(value)}</p>`;
}

function currentTab() {
  return document.querySelector(".tab.is-active")?.dataset.tab || "inputs";
}

function fmtWon(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(Number(value || 0)))}원`;
}

function fmtPct(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function fmtDotDate(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!year || !month || !day) {
    return String(iso || "");
  }
  return `${year}. ${month}. ${day}.`;
}

function fmtManwon(value) {
  const won = Number(value || 0);
  if (!won) {
    return "";
  }
  const man = won / 10000;
  const text = Number.isInteger(man)
    ? new Intl.NumberFormat("ko-KR").format(man)
    : man.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return `= ${text}만원`;
}

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>");
}

function attrEscape(value) {
  return htmlEscape(value).replaceAll("<br>", " ");
}
