export const INTEREST_TAX = 0.154;
export const LEAP_CAP_MONTH = 700000;
export const LEAP_CAP_YEAR = 8400000;
export const FUTURE_CAP_MONTH = 500000;
export const FUTURE_CAP_YEAR = 6000000;
export const FUTURE_BONUS_RATE_DEFAULT = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LEAP_EXPANDED_FROM = asUtcDate("2025-01-01");
const AMOUNT_CEILING = 100000000;

export const INCOME_TIERS = [
  {
    id: "lte2400",
    label: "총급여 2,400만원 이하",
    oldLimit: 400000,
    oldRate: 0.06,
    extraRate: 0.03,
    monthlyCap: 33000,
  },
  {
    id: "lte3600",
    label: "총급여 3,600만원 이하",
    oldLimit: 500000,
    oldRate: 0.046,
    extraRate: 0.03,
    monthlyCap: 29000,
  },
  {
    id: "lte4800",
    label: "총급여 4,800만원 이하",
    oldLimit: 600000,
    oldRate: 0.037,
    extraRate: 0.03,
    monthlyCap: 25200,
  },
  {
    id: "lte6000",
    label: "총급여 6,000만원 이하",
    oldLimit: 700000,
    oldRate: 0.03,
    extraRate: 0,
    monthlyCap: 21000,
  },
  {
    id: "lte7500",
    label: "총급여 7,500만원 이하 (기여금 없음)",
    oldLimit: 0,
    oldRate: 0,
    extraRate: 0,
    monthlyCap: 0,
  },
];

export const FUTURE_BONUS_PLANS = {
  none: {
    label: "미지급",
    rate: 0,
    cap: 0,
  },
  regular: {
    label: "일반형 6%",
    rate: 0.06,
    cap: 30000,
  },
  preferred: {
    label: "우대형 12%",
    rate: 0.12,
    cap: 60000,
  },
};

export const BASELINE_INPUTS = {
  leapOpenDate: "2024-06-29",
  depositDom: 1,
  autoDepositAmount: 700000,
  planDepositAmount: 700000,
  leapCloseDate: "2026-07-27",
  futureOpenDate: "2026-07-28",
  leapEarlyRate: 5.5,
  leapMatureRate1: 6,
  leapMatureRate2: 4.5,
  leapMatureRate3: 4.5,
  leapBonusRate1: 4.5,
  leapBonusRate2: 3,
  leapBonusRate3: 3,
  futureRate: 8,
  futureBonusRate: FUTURE_BONUS_RATE_DEFAULT,
  sideFundRate: 4.5,
  futureBonusPlan: "regular",
  tiersByYear: ["lte3600", "lte3600", "lte3600", "lte3600", "lte3600"],
};

export function asUtcDate(value, fieldName = "날짜") {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error(`${fieldName}가 존재하지 않는 날짜입니다.`);
    }
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`${fieldName} 형식이 올바르지 않습니다.`);
  }
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${fieldName}가 존재하지 않는 날짜입니다.`);
  }
  return date;
}

export function toIso(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function plusDays(date, days) {
  const copy = asUtcDate(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function plusMonths(date, months) {
  const source = asUtcDate(date);
  const targetMonth = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(source.getUTCDate(), monthLastDom(year, month));
  return new Date(Date.UTC(year, month, day));
}

export function plusYears(date, years) {
  return plusMonths(date, years * 12);
}

export function dayGap(startDate, endDate) {
  return Math.max(0, Math.round((asUtcDate(endDate) - asUtcDate(startDate)) / MS_PER_DAY));
}

export function cmpDate(a, b) {
  return asUtcDate(a).getTime() - asUtcDate(b).getTime();
}

export function monthTag(date) {
  const parsed = asUtcDate(date);
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function yearTag(date) {
  return String(asUtcDate(date).getUTCFullYear());
}

export function bonusYearTag(dateValue, anchorDateValue) {
  const date = asUtcDate(dateValue);
  const anchorDate = asUtcDate(anchorDateValue);
  let start = anniversaryFor(anchorDate, date.getUTCFullYear());
  if (cmpDate(date, start) < 0) {
    start = anniversaryFor(anchorDate, date.getUTCFullYear() - 1);
  }
  const end = plusDays(plusYears(start, 1), -1);
  return `${toIso(start)}~${toIso(end)}`;
}

export function monthLastDom(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function afterTaxRate(preTaxPercent) {
  return Number(preTaxPercent || 0) * (1 - INTEREST_TAX);
}

export function toDailyRate(annualPercent) {
  return Math.pow(1 + Number(annualPercent || 0) / 100, 1 / 365) - 1;
}

export function segmentInterest(amount, startDateValue, endDateValue, rateInput) {
  const normalizedAmount = roundWon(amount);
  if (!Array.isArray(rateInput)) {
    return (
      normalizedAmount *
      (Number(rateInput || 0) / 100 / 365) *
      dayGap(startDateValue, endDateValue)
    );
  }

  const startDate = asUtcDate(startDateValue);
  const endDate = asUtcDate(endDateValue);
  return rateInput.reduce((sum, segment) => {
    const segmentStart = laterDate(startDate, asUtcDate(segment.startDate));
    const segmentEnd = earlierDate(endDate, asUtcDate(segment.endDate));
    const days = dayGap(segmentStart, segmentEnd);
    if (days <= 0) {
      return sum;
    }
    return sum + normalizedAmount * (Number(segment.annualRate || 0) / 100 / 365) * days;
  }, 0);
}

export function buildLeapDeposits(settings) {
  const signupDate = asUtcDate(settings.leapOpenDate);
  const throughDate = asUtcDate(settings.leapCloseDate);
  const depositDom = clampDom(settings.depositDom);
  const amount = roundWon(settings.autoDepositAmount);
  const rows = [];
  let monthCursor = new Date(Date.UTC(signupDate.getUTCFullYear(), signupDate.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(throughDate.getUTCFullYear(), throughDate.getUTCMonth(), 1));

  while (cmpDate(monthCursor, endMonth) <= 0) {
    const scheduled = depositDateForMonth(signupDate, monthCursor, depositDom);
    if (cmpDate(scheduled, throughDate) <= 0) {
      rows.push({
        id: `yl-${toIso(scheduled)}`,
        date: toIso(scheduled),
        amount,
      });
    }
    monthCursor = plusMonths(monthCursor, 1);
  }

  return rows;
}

export function buildDeposits(startDateValue, maturityDateValue, paymentDayValue, amountValue, monthlyCap) {
  const startDate = asUtcDate(startDateValue);
  const maturityDate = asUtcDate(maturityDateValue);
  const depositDom = clampDom(paymentDayValue);
  const amount = Math.min(roundWon(amountValue), monthlyCap);
  const rows = [];
  let monthCursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

  while (cmpDate(monthCursor, maturityDate) < 0) {
    const scheduled = depositDateForMonth(startDate, monthCursor, depositDom);
    if (cmpDate(scheduled, startDate) >= 0 && cmpDate(scheduled, maturityDate) < 0) {
      rows.push({
        id: `future-${toIso(scheduled)}`,
        date: toIso(scheduled),
        amount,
      });
    }
    monthCursor = plusMonths(monthCursor, 1);
  }

  return rows;
}

export function depositDateForMonth(anchorDateValue, monthStartValue, paymentDayValue) {
  const anchorDate = asUtcDate(anchorDateValue);
  const monthStart = asUtcDate(monthStartValue);
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const day = Math.min(clampDom(paymentDayValue), monthLastDom(year, month));
  const candidate = new Date(Date.UTC(year, month, day));

  if (month === anchorDate.getUTCMonth()) {
    const anniversary = anniversaryFor(anchorDate, year);
    return cmpDate(candidate, anniversary) >= 0 ? candidate : anniversary;
  }

  return candidate;
}

export function checkLeapLimits(rows, anchorDateValue = BASELINE_INPUTS.leapOpenDate) {
  const monthlyTotals = new Map();
  const yearlyTotals = new Map();
  const issues = [];

  for (const row of normalizeDeposits(rows)) {
    monthlyTotals.set(monthTag(row.date), (monthlyTotals.get(monthTag(row.date)) || 0) + row.amount);
    const contributionYear = bonusYearTag(row.date, anchorDateValue);
    yearlyTotals.set(contributionYear, (yearlyTotals.get(contributionYear) || 0) + row.amount);
  }

  for (const [key, total] of monthlyTotals) {
    if (total > LEAP_CAP_MONTH) {
      issues.push({
        type: "monthly",
        key,
        total,
        limit: LEAP_CAP_MONTH,
        message: `${key} 월 납입액이 70만원을 초과합니다.`,
      });
    }
  }

  for (const [key, total] of yearlyTotals) {
    if (total > LEAP_CAP_YEAR) {
      issues.push({
        type: "yearly",
        key,
        total,
        limit: LEAP_CAP_YEAR,
        message: `${key} 납입연도 납입액이 840만원을 초과합니다.`,
      });
    }
  }

  return {
    issues,
    monthlyTotals,
    yearlyTotals,
  };
}

export function leapBonus(monthlyAmount, incomeBracketId, monthDateValue) {
  const bracket = INCOME_TIERS.find((item) => item.id === incomeBracketId) || INCOME_TIERS.at(-1);
  if (!bracket.oldLimit || !bracket.oldRate) {
    return 0;
  }

  const amount = Math.min(roundWon(monthlyAmount), LEAP_CAP_MONTH);
  const monthDate = asUtcDate(monthDateValue);
  const oldPart = Math.min(amount, bracket.oldLimit) * bracket.oldRate;

  if (cmpDate(monthDate, LEAP_EXPANDED_FROM) < 0) {
    return Math.round(oldPart);
  }

  const expandedPart = Math.max(0, amount - bracket.oldLimit) * bracket.extraRate;
  return Math.round(Math.min(oldPart + expandedPart, bracket.monthlyCap));
}

export function futureBonus(monthlyAmount, contributionType) {
  const type = FUTURE_BONUS_PLANS[contributionType] || FUTURE_BONUS_PLANS.regular;
  return Math.round(Math.min(roundWon(monthlyAmount) * type.rate, type.cap));
}

export function computeOutcome(inputSettings, inputRows) {
  const settings = normalizeSettings(inputSettings);
  const rows = normalizeDeposits(inputRows);
  const core = evaluateScenario(settings, rows, settings.sideFundRate);
  const breakEven = findBreakEven(settings, rows);
  return {
    ...core,
    breakEven,
  };
}

export function findBreakEven(inputSettings, inputRows, minPercent = -20, maxPercent = 30) {
  const settings = normalizeSettings(inputSettings);
  const rows = normalizeDeposits(inputRows);
  const samples = 100;
  let leftRate = minPercent;
  let leftValue = evaluateScenario(settings, rows, leftRate).difference;

  if (Math.abs(leftValue) < 0.5) {
    return breakEvenAt(leftRate);
  }

  for (let index = 1; index <= samples; index += 1) {
    const rightRate = minPercent + ((maxPercent - minPercent) * index) / samples;
    const rightValue = evaluateScenario(settings, rows, rightRate).difference;

    if (Math.abs(rightValue) < 0.5) {
      return breakEvenAt(rightRate);
    }

    if (leftValue * rightValue < 0) {
      let lo = leftRate;
      let hi = rightRate;
      let fLo = leftValue;

      for (let step = 0; step < 60; step += 1) {
        const mid = (lo + hi) / 2;
        const fMid = evaluateScenario(settings, rows, mid).difference;
        if (Math.abs(fMid) < 0.5) {
          return breakEvenAt(mid);
        }
        if (fLo * fMid <= 0) {
          hi = mid;
        } else {
          lo = mid;
          fLo = fMid;
        }
      }

      return breakEvenAt((lo + hi) / 2);
    }

    leftRate = rightRate;
    leftValue = rightValue;
  }

  return null;
}

function evaluateScenario(settings, rows, sideFundRate) {
  const signupDate = asUtcDate(settings.leapOpenDate);
  const exitDate = asUtcDate(settings.leapCloseDate);
  const futureStartDate = asUtcDate(settings.futureOpenDate);
  const leapMatureOn = plusMonths(signupDate, 60);
  const futureMatureOn = plusMonths(futureStartDate, 36);
  const comparisonEndDate =
    cmpDate(leapMatureOn, futureMatureOn) >= 0
      ? leapMatureOn
      : futureMatureOn;

  const historyPayments = rows.filter((row) => cmpDate(row.date, exitDate) <= 0);
  const allLeapScheduledPayments = buildDeposits(
    settings.leapOpenDate,
    toIso(leapMatureOn),
    settings.depositDom,
    Math.min(settings.planDepositAmount, LEAP_CAP_MONTH),
    LEAP_CAP_MONTH,
  );
  const futureLeapPayments = allLeapScheduledPayments.filter(
    (row) => cmpDate(row.date, exitDate) > 0,
  );
  const maintainedLeapPayments = sortDeposits([...historyPayments, ...futureLeapPayments]);
  const futurePayments = buildDeposits(
    settings.futureOpenDate,
    toIso(futureMatureOn),
    settings.depositDom,
    settings.planDepositAmount,
    FUTURE_CAP_MONTH,
  );

  const earlyLeapPayout = settleLeap({
    settings,
    payments: historyPayments,
    payoutDate: exitDate,
    annualRate: settings.leapEarlyRate,
    contributionAnnualRate: settings.leapBonusRate1,
  });
  const maintainedLeapPayout = settleLeap({
    settings,
    payments: maintainedLeapPayments,
    payoutDate: leapMatureOn,
    annualRate: leapRateSchedule(settings, "maturity"),
    contributionAnnualRate: leapRateSchedule(settings, "contribution"),
  });
  const futurePayout = settleFuture({
    settings,
    payments: futurePayments,
    payoutDate: futureMatureOn,
  });

  const externalAfterTaxRate = afterTaxRate(sideFundRate);
  const dailyRate = toDailyRate(externalAfterTaxRate);
  const cash = simulateSideFund({
    startDate: exitDate,
    endDate: comparisonEndDate,
    dailyRate,
    events: [
      {
        date: toIso(exitDate),
        scenario: "B",
        amount: earlyLeapPayout.total,
        label: "청년도약계좌 특별중도해지 지급",
      },
      ...futureLeapPayments.map((row) => ({
        date: row.date,
        scenario: "A",
        amount: -row.amount,
        label: "청년도약계좌 유지 납입",
      })),
      ...futurePayments.map((row) => ({
        date: row.date,
        scenario: "B",
        amount: -row.amount,
        label: "청년미래적금 납입",
      })),
      {
        date: toIso(leapMatureOn),
        scenario: "A",
        amount: maintainedLeapPayout.total,
        label: "청년도약계좌 만기 지급",
      },
      {
        date: toIso(futureMatureOn),
        scenario: "B",
        amount: futurePayout.total,
        label: "청년미래적금 만기 지급",
      },
    ],
  });

  const difference = cash.finalB - cash.finalA;
  return {
    settings,
    dates: {
      leapMatureOn: toIso(leapMatureOn),
      futureMatureOn: toIso(futureMatureOn),
      comparisonEndDate: toIso(comparisonEndDate),
    },
    rates: {
      sideFundRate,
      externalAfterTaxRate,
      externalDailyRate: dailyRate,
      leapMatureSchedule: leapRateSchedule(settings, "maturity").map(toSegmentView),
      leapBonusSchedule: leapRateSchedule(settings, "contribution").map(toSegmentView),
    },
    schedules: {
      historyPayments,
      futureLeapPayments,
      futurePayments,
      maintainedLeapPayments,
    },
    payouts: {
      earlyLeapPayout,
      maintainedLeapPayout,
      futurePayout,
    },
    cash,
    difference,
    winner: Math.abs(difference) < 1 ? "tie" : difference > 0 ? "switch" : "keep",
  };
}

function settleLeap({
  settings,
  payments,
  payoutDate,
  annualRate,
  contributionAnnualRate,
}) {
  const contributionEvents = buildBonusEvents({
    settings,
    payments,
    payoutDate,
    product: "leap",
  });

  return settleAccount({
    payments,
    annualRate,
    contributionAnnualRate,
    contributionEvents,
    payoutDate,
  });
}

function settleFuture({ settings, payments, payoutDate }) {
  const contributionEvents = buildBonusEvents({
    settings,
    payments,
    payoutDate,
    product: "future",
  });

  return settleAccount({
    payments,
    annualRate: settings.futureRate,
    contributionAnnualRate: settings.futureBonusRate,
    contributionEvents,
    payoutDate,
  });
}

function settleAccount({
  payments,
  annualRate,
  contributionAnnualRate,
  contributionEvents,
  payoutDate,
}) {
  const payout = asUtcDate(payoutDate);
  const principal = payments.reduce((sum, row) => sum + row.amount, 0);
  const principalInterest = payments.reduce((sum, row) => {
    return sum + segmentInterest(row.amount, row.date, payout, annualRate);
  }, 0);
  const contribution = contributionEvents.reduce((sum, event) => sum + event.amount, 0);
  const contributionInterest = contributionEvents.reduce((sum, event) => {
    const interestStart = cmpDate(event.settleDate, payout) <= 0 ? asUtcDate(event.settleDate) : payout;
    return sum + segmentInterest(
      event.amount,
      interestStart,
      payout,
      contributionAnnualRate,
    );
  }, 0);

  return {
    principal,
    principalInterest,
    contribution,
    contributionInterest,
    total: principal + principalInterest + contribution + contributionInterest,
    contributionEvents,
  };
}

function buildBonusEvents({ settings, payments, payoutDate, product }) {
  const monthlyTotals = new Map();
  const monthDates = new Map();
  const payout = asUtcDate(payoutDate);

  for (const row of payments) {
    const key = monthTag(row.date);
    monthlyTotals.set(key, (monthlyTotals.get(key) || 0) + row.amount);
    if (!monthDates.has(key) || cmpDate(row.date, monthDates.get(key)) < 0) {
      monthDates.set(key, row.date);
    }
  }

  return Array.from(monthlyTotals.entries())
    .map(([key, total]) => {
      const firstPaymentDate = asUtcDate(monthDates.get(key));
      const [year, month] = key.split("-").map(Number);
      const settleDate = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 10));
      const amount =
        product === "leap"
          ? leapBonus(
              total,
              tierForDate(firstPaymentDate, settings),
              new Date(Date.UTC(year, month - 1, 1)),
            )
          : futureBonus(total, settings.futureBonusPlan);

      return {
        month: key,
        paymentTotal: total,
        amount,
        settleDate: toIso(settleDate),
      };
    })
    .filter((event) => event.amount > 0 && cmpDate(event.month + "-01", payout) <= 0);
}

function tierForDate(dateValue, settings) {
  const date = asUtcDate(dateValue);
  const signupDate = asUtcDate(settings.leapOpenDate);
  let index = 0;
  for (let year = 1; year < 5; year += 1) {
    if (cmpDate(date, nextMonthStart(plusYears(signupDate, year))) >= 0) {
      index = year;
    }
  }
  return settings.tiersByYear[Math.min(index, settings.tiersByYear.length - 1)];
}

function nextMonthStart(dateValue) {
  const date = asUtcDate(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function anniversaryFor(anchorDate, year) {
  const month = anchorDate.getUTCMonth();
  const day = Math.min(anchorDate.getUTCDate(), monthLastDom(year, month));
  return new Date(Date.UTC(year, month, day));
}

function leapRateSchedule(settings, type) {
  const signupDate = asUtcDate(settings.leapOpenDate);
  const month36 = plusMonths(signupDate, 36);
  const month48 = plusMonths(signupDate, 48);
  const month60 = plusMonths(signupDate, 60);
  const rates =
    type === "maturity"
      ? [
          settings.leapMatureRate1,
          settings.leapMatureRate2,
          settings.leapMatureRate3,
        ]
      : [
          settings.leapBonusRate1,
          settings.leapBonusRate2,
          settings.leapBonusRate3,
        ];

  return [
    {
      label: "1~36개월",
      startDate: toIso(signupDate),
      endDate: toIso(month36),
      annualRate: Number(rates[0] || 0),
    },
    {
      label: "37~48개월",
      startDate: toIso(month36),
      endDate: toIso(month48),
      annualRate: Number(rates[1] || 0),
    },
    {
      label: "49~60개월",
      startDate: toIso(month48),
      endDate: toIso(month60),
      annualRate: Number(rates[2] || 0),
    },
  ];
}

function toSegmentView(segment) {
  return {
    label: segment.label,
    startDate: segment.startDate,
    endDate: segment.endDate,
    annualRate: segment.annualRate,
  };
}

function simulateSideFund({ startDate, endDate, dailyRate, events }) {
  const eventsByDate = new Map();
  for (const event of events) {
    if (!eventsByDate.has(event.date)) {
      eventsByDate.set(event.date, []);
    }
    eventsByDate.get(event.date).push(event);
  }

  let balanceA = 0;
  let balanceB = 0;
  let totalInjected = 0;
  const injections = [];
  const dailySnapshots = [];

  for (let cursor = asUtcDate(startDate); cmpDate(cursor, endDate) <= 0; cursor = plusDays(cursor, 1)) {
    const key = toIso(cursor);
    for (const event of eventsByDate.get(key) || []) {
      if (event.scenario === "A") {
        balanceA += event.amount;
      } else {
        balanceB += event.amount;
      }
    }

    const required = Math.max(0, -Math.min(balanceA, balanceB));
    if (required > 0) {
      balanceA += required;
      balanceB += required;
      totalInjected += required;
      injections.push({
        date: key,
        amount: required,
        balanceA,
        balanceB,
      });
    }

    if (
      key === toIso(startDate) ||
      key === toIso(endDate) ||
      eventsByDate.has(key) ||
      required > 0
    ) {
      dailySnapshots.push({
        date: key,
        balanceA,
        balanceB,
      });
    }

    if (cmpDate(cursor, endDate) < 0) {
      balanceA *= 1 + dailyRate;
      balanceB *= 1 + dailyRate;
    }
  }

  return {
    finalA: balanceA,
    finalB: balanceB,
    totalInjected,
    injections,
    events,
    dailySnapshots,
  };
}

function breakEvenAt(preTaxRate) {
  return {
    preTaxRate,
    afterTaxRate: afterTaxRate(preTaxRate),
  };
}

function normalizeSettings(input = {}) {
  const incomeBracketIds = new Set(INCOME_TIERS.map((bracket) => bracket.id));
  const tiersByYear =
    Array.isArray(input.tiersByYear) && input.tiersByYear.length
      ? BASELINE_INPUTS.tiersByYear.map((defaultValue, index) =>
          incomeBracketIds.has(input.tiersByYear[index]) ? input.tiersByYear[index] : defaultValue,
        )
      : BASELINE_INPUTS.tiersByYear;

  return {
    ...BASELINE_INPUTS,
    ...input,
    leapOpenDate: toIso(asUtcDate(input.leapOpenDate ?? BASELINE_INPUTS.leapOpenDate, "청년도약계좌 가입일")),
    leapCloseDate: toIso(asUtcDate(input.leapCloseDate ?? BASELINE_INPUTS.leapCloseDate, "청년도약계좌 해지일")),
    futureOpenDate: toIso(asUtcDate(input.futureOpenDate ?? BASELINE_INPUTS.futureOpenDate, "청년미래적금 가입일")),
    depositDom: safeNumber(input.depositDom ?? BASELINE_INPUTS.depositDom, "기본 입금일", {
      min: 1,
      max: 31,
      integer: true,
    }),
    autoDepositAmount: safeAmount(
      input.autoDepositAmount ?? BASELINE_INPUTS.autoDepositAmount,
      "자동 생성 납입금액",
    ),
    planDepositAmount: safeAmount(input.planDepositAmount ?? BASELINE_INPUTS.planDepositAmount, "향후 월납입 설정금액"),
    leapEarlyRate: safeRate(
      input.leapEarlyRate ?? BASELINE_INPUTS.leapEarlyRate,
      "도약 특별중도해지 금리",
    ),
    leapMatureRate1: safeRate(
      input.leapMatureRate1 ?? BASELINE_INPUTS.leapMatureRate1,
      "도약 만기 금리 1~36개월",
    ),
    leapMatureRate2: safeRate(
      input.leapMatureRate2 ?? BASELINE_INPUTS.leapMatureRate2,
      "도약 만기 금리 37~48개월",
    ),
    leapMatureRate3: safeRate(
      input.leapMatureRate3 ?? BASELINE_INPUTS.leapMatureRate3,
      "도약 만기 금리 49~60개월",
    ),
    leapBonusRate1: safeRate(
      input.leapBonusRate1 ?? BASELINE_INPUTS.leapBonusRate1,
      "도약 기여금 이자 금리 1~36개월",
    ),
    leapBonusRate2: safeRate(
      input.leapBonusRate2 ?? BASELINE_INPUTS.leapBonusRate2,
      "도약 기여금 이자 금리 37~48개월",
    ),
    leapBonusRate3: safeRate(
      input.leapBonusRate3 ?? BASELINE_INPUTS.leapBonusRate3,
      "도약 기여금 이자 금리 49~60개월",
    ),
    futureRate: safeRate(input.futureRate ?? BASELINE_INPUTS.futureRate, "미래적금 적용 금리"),
    futureBonusRate: safeRate(
      input.futureBonusRate ?? BASELINE_INPUTS.futureBonusRate,
      "미래적금 기여금 이자 금리",
    ),
    sideFundRate: safeNumber(input.sideFundRate ?? BASELINE_INPUTS.sideFundRate, "외부 돈 세전 연이율", {
      min: -100,
      max: 100,
    }),
    futureBonusPlan: FUTURE_BONUS_PLANS[input.futureBonusPlan]
      ? input.futureBonusPlan
      : BASELINE_INPUTS.futureBonusPlan,
    tiersByYear,
  };
}

export function normalizeDeposits(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return sortDeposits(
    sourceRows
      .map((row, index) => ({
        id: row.id || `row-${index}`,
        date: toIso(asUtcDate(row.date, "납입일")),
        amount: safeAmount(row.amount, "납입금액"),
      }))
      .filter((row) => Number.isFinite(row.amount) && row.amount > 0),
  );
}

function sortDeposits(rows) {
  return [...rows].sort((a, b) => cmpDate(a.date, b.date) || a.id.localeCompare(b.id));
}

function laterDate(a, b) {
  return cmpDate(a, b) >= 0 ? asUtcDate(a) : asUtcDate(b);
}

function earlierDate(a, b) {
  return cmpDate(a, b) <= 0 ? asUtcDate(a) : asUtcDate(b);
}

function roundWon(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function clampDom(value) {
  return Math.min(31, Math.max(1, Math.round(Number(value || 1))));
}

function safeAmount(value, fieldName) {
  return Math.round(safeNumber(value, fieldName, { min: 0, max: AMOUNT_CEILING }));
}

function safeRate(value, fieldName) {
  return safeNumber(value, fieldName, { min: 0, max: 100 });
}

function safeNumber(value, fieldName, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === "" || value === null || value === undefined) {
    throw new Error(`${fieldName} 값을 입력하세요.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${fieldName} 범위를 확인하세요.`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new Error(`${fieldName}은 정수로 입력하세요.`);
  }
  return number;
}
