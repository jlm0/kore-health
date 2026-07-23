import { clamp, gaussian, mulberry32, type Rng } from './random';
import {
  DATASET_DAYS,
  SAMPLE_INTERVAL_MS,
  type ActivitySummary,
  type Dataset,
  type DaySummary,
  type MetricSample,
  type SeriesId,
  type SleepStage,
  type SleepStageSegment,
  type SleepSummary,
} from './types';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface DayPlan {
  dayStart: number;
  sleepStart: number;
  sleepEnd: number;
  latencyMin: number;
  stages: SleepStageSegment[];
  workoutStart: number;
  workoutDurMin: number;
  hrvNightBase: number;
  tempDev: number;
  spo2Base: number;
  stepFactor: number;
}

const STAGE_TOTALS_TODAY = { deep: 88, rem: 111, light: 243, awake: 20 };

function buildStages(
  rng: Rng,
  sleepStart: number,
  sleepEnd: number,
  awakeTargetMin: number,
): SleepStageSegment[] {
  const totalMin = (sleepEnd - sleepStart) / MIN;
  const cycles = 5;
  const deepTotal = totalMin * (0.16 + rng() * 0.06);
  const remTotal = totalMin * (0.2 + rng() * 0.06);
  const awakeTotal = Math.min(awakeTargetMin, totalMin * 0.08);
  const lightTotal = totalMin - deepTotal - remTotal - awakeTotal;

  const deepWeights = [0.34, 0.28, 0.18, 0.12, 0.08];
  const remWeights = [0.06, 0.14, 0.2, 0.26, 0.34];
  const awakeSlots = [0, 2, 4];

  const ordered: { stage: SleepStage; min: number }[] = [];
  for (let c = 0; c < cycles; c++) {
    const cycleLight = lightTotal / cycles;
    const deepMin = deepTotal * deepWeights[c];
    const remMin = remTotal * remWeights[c];
    if (awakeSlots.includes(c)) {
      ordered.push({ stage: 'awake', min: awakeTotal / awakeSlots.length });
    }
    ordered.push({ stage: 'light', min: cycleLight * 0.55 });
    ordered.push({ stage: 'deep', min: deepMin });
    ordered.push({ stage: 'light', min: cycleLight * 0.45 });
    ordered.push({ stage: 'rem', min: remMin });
  }

  const segments: SleepStageSegment[] = [];
  let cursor = sleepStart;
  for (const item of ordered) {
    if (item.min < 1) continue;
    const end = Math.min(cursor + item.min * MIN, sleepEnd);
    segments.push({ stage: item.stage, start: cursor, end });
    cursor = end;
    if (cursor >= sleepEnd) break;
  }
  if (cursor < sleepEnd) {
    segments.push({ stage: 'light', start: cursor, end: sleepEnd });
  }
  return segments;
}

function stageAt(segments: SleepStageSegment[], t: number): SleepStage | null {
  for (const s of segments) {
    if (t >= s.start && t < s.end) return s.stage;
  }
  return null;
}

function stageMinutes(segments: SleepStageSegment[]): Record<SleepStage, number> {
  const totals: Record<SleepStage, number> = { deep: 0, rem: 0, light: 0, awake: 0 };
  for (const s of segments) totals[s.stage] += (s.end - s.start) / MIN;
  return totals;
}

function buildDayPlans(rng: Rng, now: number): DayPlan[] {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const plans: DayPlan[] = [];

  for (let i = 0; i < DATASET_DAYS; i++) {
    const dayStart = todayStart.getTime() - (DATASET_DAYS - 1 - i) * DAY;
    const isToday = i === DATASET_DAYS - 1;
    const weekend = [0, 6].includes(new Date(dayStart).getDay());

    const bedOffsetMin = isToday
      ? -36
      : Math.round(gaussian(rng, weekend ? 20 : -30, 35));
    const sleepStart = dayStart + bedOffsetMin * MIN;
    const durationMin = isToday ? 487 : Math.round(clamp(gaussian(rng, 465, 40), 360, 540));
    const sleepEnd = sleepStart + durationMin * MIN;
    const latencyMin = isToday ? 8 : Math.round(clamp(gaussian(rng, 10, 4), 3, 25));
    const awakeTarget = isToday
      ? STAGE_TOTALS_TODAY.awake
      : Math.round(clamp(gaussian(rng, 24, 10), 8, 55));

    const workoutHour = weekend ? 10 + rng() * 3 : 17 + rng() * 2.5;
    const hasWorkout = rng() < (weekend ? 0.75 : 0.6);

    plans.push({
      dayStart,
      sleepStart,
      sleepEnd,
      latencyMin,
      stages: buildStages(rng, sleepStart, sleepEnd, awakeTarget),
      workoutStart: hasWorkout ? dayStart + workoutHour * HOUR : 0,
      workoutDurMin: hasWorkout ? Math.round(30 + rng() * 45) : 0,
      hrvNightBase: isToday ? 64 : clamp(gaussian(rng, 58, 9), 38, 82),
      tempDev: isToday ? 0.1 : clamp(gaussian(rng, 0, 0.16), -0.5, 0.6),
      spo2Base: isToday ? 98 : clamp(gaussian(rng, 97.4, 0.7), 95.5, 99),
      stepFactor: isToday ? 0.95 : clamp(gaussian(rng, 1, 0.3), 0.35, 1.7),
    });
  }
  return plans;
}

function movementIntensity(rng: Rng, plan: DayPlan, t: number): number {
  const hour = (t - plan.dayStart) / HOUR;
  if (hour < 6.5 || hour > 22.5) return 0;

  if (plan.workoutStart > 0 && t >= plan.workoutStart && t < plan.workoutStart + plan.workoutDurMin * MIN) {
    return clamp(0.7 + rng() * 0.3, 0, 1);
  }

  let envelope = 0.16;
  if (hour >= 7 && hour < 9.5) envelope = 0.4;
  else if (hour >= 11.5 && hour < 13.5) envelope = 0.35;
  else if (hour >= 15 && hour < 19) envelope = 0.28;
  else if (hour >= 20) envelope = 0.12;

  const roll = rng();
  if (roll < 0.45) return 0;
  return clamp(rng() * envelope * 2 * plan.stepFactor, 0, 1);
}

export function generateDataset(seed: number, now: number = Date.now()): Dataset {
  const rng = mulberry32(seed);
  const plans = buildDayPlans(rng, now);

  const series: Record<SeriesId, MetricSample[]> = { hr: [], hrv: [], temp: [], spo2: [], move: [] };
  const sampleRng = mulberry32(seed ^ 0x9e3779b9);

  const firstT = plans[0].sleepStart - HOUR;
  const stepsPerDay = new Array(DATASET_DAYS).fill(0);
  const hourlySteps: number[][] = plans.map(() => new Array(24).fill(0));

  for (let t = firstT; t <= now; t += SAMPLE_INTERVAL_MS) {
    let dayIdx = Math.floor((t - plans[0].dayStart) / DAY);
    dayIdx = clamp(dayIdx, 0, DATASET_DAYS - 1);

    const nightPlan =
      t < plans[dayIdx].sleepEnd
        ? plans[dayIdx]
        : dayIdx + 1 < DATASET_DAYS && t >= plans[dayIdx + 1].sleepStart
          ? plans[dayIdx + 1]
          : null;
    const stage = nightPlan ? stageAt(nightPlan.stages, t) : null;
    const plan = plans[dayIdx];

    let move = 0;
    let hr: number;
    let hrv: number;
    let spo2: number;

    if (stage) {
      const nightFrac = clamp(
        (t - nightPlan!.sleepStart) / (nightPlan!.sleepEnd - nightPlan!.sleepStart),
        0,
        1,
      );
      const midDip = Math.sin(nightFrac * Math.PI) * 4;
      const stageHr = { deep: 48.5, light: 52, rem: 56, awake: 61 }[stage];
      hr = stageHr - midDip + gaussian(sampleRng, 0, 1.4);
      const stageHrvBoost = { deep: 12, light: 4, rem: -2, awake: -10 }[stage];
      hrv =
        nightPlan!.hrvNightBase + stageHrvBoost + Math.sin(nightFrac * Math.PI) * 9 + gaussian(sampleRng, 0, 5);
      spo2 = nightPlan!.spo2Base - Math.sin(nightFrac * Math.PI) * 0.4 + gaussian(sampleRng, 0, 0.35);
    } else {
      move = movementIntensity(sampleRng, plan, t);
      hr = 63 + move * 62 + gaussian(sampleRng, 0, 3.2);
      hrv = clamp(plan.hrvNightBase - 14 - move * 12 + gaussian(sampleRng, 0, 6), 18, 95);
      spo2 = plan.spo2Base - 0.5 + gaussian(sampleRng, 0, 0.4);
    }

    const hourOfDay = ((t - plan.dayStart) / HOUR) % 24;
    const circadianTemp = -0.12 * Math.cos(((hourOfDay - 17) / 24) * Math.PI * 2);
    const temp = plan.tempDev + circadianTemp + gaussian(sampleRng, 0, 0.03);

    series.hr.push({ t, v: Math.round(clamp(hr, 40, 185) * 10) / 10 });
    series.hrv.push({ t, v: Math.round(clamp(hrv, 15, 110) * 10) / 10 });
    series.temp.push({ t, v: Math.round(temp * 100) / 100 });
    series.spo2.push({ t, v: Math.round(clamp(spo2, 93, 100) * 10) / 10 });
    series.move.push({ t, v: Math.round(move * 100) / 100 });

    if (t >= plan.dayStart && move > 0) {
      const steps = Math.round(move * 340);
      stepsPerDay[dayIdx] += steps;
      const h = Math.floor((t - plan.dayStart) / HOUR);
      if (h >= 0 && h < 24) hourlySteps[dayIdx][h] += steps;
    }
  }

  const summaryRng = mulberry32(seed ^ 0x51ab3c);
  const days: DaySummary[] = plans.map((plan, i) => {
    const nightSamples = {
      hr: series.hr.filter((s) => s.t >= plan.sleepStart && s.t < plan.sleepEnd),
      hrv: series.hrv.filter((s) => s.t >= plan.sleepStart && s.t < plan.sleepEnd),
      spo2: series.spo2.filter((s) => s.t >= plan.sleepStart && s.t < plan.sleepEnd),
    };
    const avg = (xs: MetricSample[]) =>
      xs.length ? xs.reduce((s, x) => s + x.v, 0) / xs.length : 0;

    const totals = stageMinutes(plan.stages);
    const asleepMin = totals.deep + totals.rem + totals.light;
    const inBedMin = (plan.sleepEnd - plan.sleepStart) / MIN;
    const efficiency = Math.round((asleepMin / inBedMin) * 100);
    const lowestHr = nightSamples.hr.length
      ? Math.round(Math.min(...nightSamples.hr.map((s) => s.v)))
      : 48;
    const peakHrv = nightSamples.hrv.length
      ? Math.round(Math.max(...nightSamples.hrv.map((s) => s.v)))
      : 70;

    const hrvAvg = Math.round(avg(nightSamples.hrv)) || 55;
    const restingHr = Math.round(avg(nightSamples.hr) * 0.94) || 52;
    const spo2Avg = Math.round(avg(nightSamples.spo2) * 10) / 10 || 97.5;

    const durationScore = clamp((asleepMin / 480) * 100, 40, 100);
    const deepScore = clamp((totals.deep / 90) * 100, 30, 100);
    const sleepScore = Math.round(
      clamp(durationScore * 0.45 + efficiency * 0.3 + deepScore * 0.25 + gaussian(summaryRng, 0, 2), 52, 98),
    );

    const steps = stepsPerDay[i];
    const activeCal = Math.round(steps * 0.052 + plan.workoutDurMin * 4.2);
    const goalCal = 500;
    const activityScore = Math.round(clamp((steps / 9500) * 80 + (plan.workoutDurMin > 0 ? 14 : 4), 35, 98));

    const tempScore = clamp(1 - Math.abs(plan.tempDev) / 0.6, 0, 1);
    const hrvBalance = clamp(hrvAvg / 70, 0.3, 1);
    const rhrScore = clamp(1 - (restingHr - 46) / 20, 0.3, 1);
    const sleepContrib = clamp(sleepScore / 100, 0, 1);
    const recovery = clamp((hrvBalance + rhrScore) / 2 + gaussian(summaryRng, 0, 0.04), 0.3, 1);
    const activityBalance = clamp(0.55 + gaussian(summaryRng, 0.12, 0.12), 0.3, 1);

    const readiness = Math.round(
      clamp(
        (hrvBalance * 0.28 + sleepContrib * 0.3 + rhrScore * 0.16 + tempScore * 0.14 + activityBalance * 0.12) *
          104 +
          gaussian(summaryRng, 0, 2),
        50,
        97,
      ),
    );

    const date = new Date(plan.dayStart);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;

    const sleep: SleepSummary = {
      start: plan.sleepStart,
      end: plan.sleepEnd,
      durationMin: Math.round(asleepMin),
      efficiency,
      latencyMin: plan.latencyMin,
      stages: plan.stages,
      deepMin: Math.round(totals.deep),
      remMin: Math.round(totals.rem),
      lightMin: Math.round(totals.light),
      awakeMin: Math.round(totals.awake),
      lowestHr,
      peakHrv,
    };

    const activity: ActivitySummary = {
      steps,
      activeCal,
      goalCal,
      kmEquiv: Math.round(steps * 0.00074 * 10) / 10,
      inactiveMin: Math.round(clamp(gaussian(summaryRng, 55, 20), 15, 130)),
    };

    return {
      date: iso,
      dayStart: plan.dayStart,
      readiness,
      sleepScore,
      activityScore,
      contributors: {
        hrvBalance,
        bodyTemp: tempScore,
        sleep: sleepContrib,
        restingHr: rhrScore,
        recovery,
        activityBalance,
      },
      sleep,
      activity,
      hrvAvg,
      restingHr,
      tempDeviation: plan.tempDev,
      spo2: spo2Avg,
    };
  });

  const today = days[days.length - 1];
  today.readiness = 88;
  today.sleepScore = 92;
  today.activityScore = 76;
  today.hrvAvg = 62;
  today.restingHr = 51;
  today.tempDeviation = 0.1;
  today.spo2 = 98;
  today.sleep.durationMin = 462;
  today.sleep.efficiency = 96;
  today.sleep.latencyMin = 8;
  today.sleep.lowestHr = 47;
  today.sleep.peakHrv = 74;
  today.activity.steps = Math.max(today.activity.steps, 8432);
  today.activity.activeCal = Math.max(today.activity.activeCal, 512);
  today.activity.kmEquiv = 6.2;
  today.activity.inactiveMin = 40;
  today.contributors = {
    hrvBalance: 0.92,
    bodyTemp: 0.96,
    sleep: 0.9,
    restingHr: 0.88,
    recovery: 0.84,
    activityBalance: 0.72,
  };

  return { seed, generatedAt: now, days, series };
}

export function generateNextSamples(
  dataset: Dataset,
  t: number,
): Record<SeriesId, MetricSample> {
  const rng = mulberry32((dataset.seed ^ Math.floor(t / SAMPLE_INTERVAL_MS)) >>> 0);
  const last = {
    hr: dataset.series.hr[dataset.series.hr.length - 1]?.v ?? 60,
    hrv: dataset.series.hrv[dataset.series.hrv.length - 1]?.v ?? 55,
    temp: dataset.series.temp[dataset.series.temp.length - 1]?.v ?? 0.1,
    spo2: dataset.series.spo2[dataset.series.spo2.length - 1]?.v ?? 97.5,
  };
  const move = rng() < 0.5 ? 0 : Math.round(rng() * 45) / 100;
  return {
    hr: { t, v: Math.round(clamp(last.hr + gaussian(rng, move * 6, 2.4), 44, 170) * 10) / 10 },
    hrv: { t, v: Math.round(clamp(last.hrv + gaussian(rng, -move * 3, 3), 18, 100) * 10) / 10 },
    temp: { t, v: Math.round(clamp(last.temp + gaussian(rng, 0, 0.02), -0.8, 0.9) * 100) / 100 },
    spo2: { t, v: Math.round(clamp(last.spo2 + gaussian(rng, 0, 0.2), 94, 99.6) * 10) / 10 },
    move: { t, v: move },
  };
}
