import type { WaterScenario, WaterState, WaterThresholds } from '../src/types/hydro.ts';

export interface SensorEvaluationInput {
  flowRate: number;
  presenceDetected: boolean;
  waterDetected: boolean;
  unattendedFlowSeconds: number;
  thresholds: WaterThresholds;
}

export interface SensorEvaluationResult {
  state: WaterState;
  isWastage: boolean;
  reason: string;
}

/**
 * Evaluates the six preserved Smart Hydro Alert states:
 * 1. NORMAL
 * 2. NORMAL_FLOW
 * 3. WARNING
 * 4. ALERT
 * 5. LEAK
 * 6. CRITICAL
 */
export function evaluateWaterState(input: SensorEvaluationInput): SensorEvaluationResult {
  const { flowRate, presenceDetected, waterDetected, unattendedFlowSeconds, thresholds } = input;
  const hasFlow = flowRate >= thresholds.flowActiveThresholdLpm;

  // 6. CRITICAL: High-flow burst or severe leakage with water contact
  if (
    (waterDetected && flowRate >= thresholds.criticalFlowThresholdLpm) ||
    flowRate >= thresholds.criticalFlowThresholdLpm * 1.35
  ) {
    return {
      state: 'CRITICAL',
      isWastage: true,
      reason: `Critical flow rate (${flowRate.toFixed(1)} L/min) with moisture contact — critical leakage condition`,
    };
  }

  // 5. LEAK: Moisture / water contact detected without measurable pipe flow
  if (waterDetected && !hasFlow) {
    return {
      state: 'LEAK',
      isWastage: true,
      reason: 'Water contact detected by moisture sensor without measurable active pipe flow',
    };
  }

  // 4. ALERT: Continuous unattended water wastage beyond alert threshold
  if (hasFlow && !presenceDetected && unattendedFlowSeconds >= thresholds.alertWastageSec) {
    return {
      state: 'ALERT',
      isWastage: true,
      reason: `Continuous unattended flow (${flowRate.toFixed(1)} L/min) for ${Math.round(unattendedFlowSeconds)}s — active water wastage`,
    };
  }

  // 3. WARNING: Unattended water flow detected without presence
  if (hasFlow && !presenceDetected && unattendedFlowSeconds >= thresholds.warningUnattendedSec) {
    return {
      state: 'WARNING',
      isWastage: true,
      reason: `Unattended water flow (${flowRate.toFixed(1)} L/min) detected for ${Math.round(unattendedFlowSeconds)}s with no occupant presence`,
    };
  }

  // 2. NORMAL_FLOW: Active water consumption with occupant present (or below unattended warning window)
  if (hasFlow) {
    return {
      state: 'NORMAL_FLOW',
      isWastage: false,
      reason: presenceDetected
        ? `Normal attended water usage (${flowRate.toFixed(1)} L/min)`
        : `Short flow (${flowRate.toFixed(1)} L/min) within unattended grace window`,
    };
  }

  // 1. NORMAL: Idle line, no flow, no surface water contact
  return {
    state: 'NORMAL',
    isWastage: false,
    reason: 'Idle pipeline — no flow and no surface moisture detected',
  };
}

export interface GeneratedSensorSample {
  flowRate: number;
  presenceDetected: boolean;
  waterDetected: boolean;
  forceUnattendedSeconds?: number;
}

function jitter(base: number, spread: number): number {
  const value = base + (Math.random() * 2 - 1) * spread;
  return Math.max(0, Number(value.toFixed(2)));
}

/**
 * Generates repeatable software-simulated water sensor values for all 6 scenarios.
 */
export function generateScenarioReading(
  scenario: WaterScenario,
  thresholds: WaterThresholds
): GeneratedSensorSample {
  switch (scenario) {
    case 'NORMAL_IDLE':
      return {
        flowRate: jitter(0.05, 0.05),
        presenceDetected: false,
        waterDetected: false,
        forceUnattendedSeconds: 0,
      };
    case 'NORMAL_USAGE':
      return {
        flowRate: jitter(5.4, 1.2),
        presenceDetected: true,
        waterDetected: false,
        forceUnattendedSeconds: 0,
      };
    case 'UNATTENDED_FLOW':
      return {
        flowRate: jitter(6.8, 0.9),
        presenceDetected: false,
        waterDetected: false,
        forceUnattendedSeconds: thresholds.warningUnattendedSec + 2,
      };
    case 'CONTINUOUS_WASTAGE':
      return {
        flowRate: jitter(10.5, 1.4),
        presenceDetected: false,
        waterDetected: false,
        forceUnattendedSeconds: thresholds.alertWastageSec + 5,
      };
    case 'WATER_CONTACT_NO_FLOW':
      return {
        flowRate: jitter(0.1, 0.08),
        presenceDetected: false,
        waterDetected: true,
        forceUnattendedSeconds: 0,
      };
    case 'CRITICAL_LEAKAGE':
      return {
        flowRate: jitter(thresholds.criticalFlowThresholdLpm + 6.5, 2.2),
        presenceDetected: false,
        waterDetected: true,
        forceUnattendedSeconds: thresholds.alertWastageSec + 10,
      };
  }
}

export const SCENARIO_CATALOG: Array<{
  scenario: WaterScenario;
  targetState: WaterState;
  title: string;
  description: string;
}> = [
  {
    scenario: 'NORMAL_IDLE',
    targetState: 'NORMAL',
    title: 'Normal Idle',
    description: 'Zero active pipe flow, dry floor moisture sensor, nominal standby.',
  },
  {
    scenario: 'NORMAL_USAGE',
    targetState: 'NORMAL_FLOW',
    title: 'Normal Water Usage',
    description: 'Active flow (~5.4 L/min) with occupant presence detected at fixture.',
  },
  {
    scenario: 'UNATTENDED_FLOW',
    targetState: 'WARNING',
    title: 'Unattended Water Flow',
    description: 'Active flow (~6.8 L/min) without occupant presence past warning window.',
  },
  {
    scenario: 'CONTINUOUS_WASTAGE',
    targetState: 'ALERT',
    title: 'Continuous Water Wastage',
    description: 'Sustained unattended flow (~10.5 L/min) exceeding wastage alert threshold.',
  },
  {
    scenario: 'WATER_CONTACT_NO_FLOW',
    targetState: 'LEAK',
    title: 'Water Contact Without Flow',
    description: 'Moisture sensor triggered with negligible line flow — hidden or slow leak.',
  },
  {
    scenario: 'CRITICAL_LEAKAGE',
    targetState: 'CRITICAL',
    title: 'Critical Leakage Condition',
    description: 'High-volume pipe burst (>18 L/min) combined with active surface flooding.',
  },
];
