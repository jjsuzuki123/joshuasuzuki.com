function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function lnFactorial(n) {
  let out = 0;
  for (let i = 2; i <= n; i++) out += Math.log(i);
  return out;
}

function erlangC(lambda, mu, c) {
  if (c <= 0 || mu <= 0) return { rho: Infinity, Pw: 1, Wq: Infinity, stable: false, P0: 0 };

  const rho = lambda / (c * mu);
  if (rho >= 1) return { rho, Pw: 1, Wq: Infinity, stable: false, P0: 0 };

  const a = lambda / mu;

  let sum = 0;
  for (let n = 0; n <= c - 1; n++) {
    const term = Math.exp(n * Math.log(a) - lnFactorial(n));
    sum += term;
  }
  const last = Math.exp(c * Math.log(a) - lnFactorial(c)) / (1 - rho);
  const denom = sum + last;
  const P0 = 1 / denom;

  const Pw = last * P0;

  const S = 1 / mu;
  const Wq = (Pw * S) / (c * (1 - rho));

  return { rho, Pw, Wq, stable: true, P0 };
}

export function simulateAI(params) {
  const {
    rps,
    gpus,
    tokensIn,
    tokensOut,
    tpsPerGpuBase,
    batchSize,
    batchAlpha,
    batchMaxEff,
    maxBatchWaitMs,
    overheadMs,
    netMs,
    gpuPricePerHour,
    hoursPerMonth = 730
  } = params;

  const lambda = Math.max(0, rps);
  const c = Math.max(0, Math.floor(gpus));
  const T = Math.max(0, tokensIn + tokensOut);

  const overhead = overheadMs / 1000;
  const net = netMs / 1000;
  const maxBatchWait = maxBatchWaitMs / 1000;

  const b = Math.max(1, Math.floor(batchSize));

  const eff = clamp(1 + batchAlpha * Math.log(b), 1, batchMaxEff);
  const tpsEff = Math.max(1e-9, tpsPerGpuBase * eff);

  const S = overhead + (T / tpsEff);
  const mu = 1 / Math.max(1e-9, S);

  let Wbatch = 0;
  if (b > 1 && lambda > 0) {
    Wbatch = Math.min(maxBatchWait, (b - 1) / (2 * lambda));
  }

  const q = erlangC(lambda, mu, c);

  let meanSystem = Infinity;
  let p95System = Infinity;
  let warnings = [];

  if (!q.stable) {
    warnings.push("UNSTABLE: demand exceeds capacity (ρ ≥ 1). Latency will blow up.");
  } else {
    const Wq = q.Wq;
    meanSystem = Wq + S;

    const k = (c * mu) - lambda;
    let Wq_p95 = 0;

    if (q.Pw > 0.05) {
      Wq_p95 = -Math.log(0.05 / q.Pw) / k;
    } else {
      Wq_p95 = 0;
    }

    p95System = S + Math.max(0, Wq_p95);

    if (q.rho > 0.85) warnings.push("High utilization (ρ > 0.85). Expect rising queueing delays under spikes.");
    if (q.rho > 0.95) warnings.push("Very high utilization (ρ > 0.95). Small demand spikes will cause big latency jumps.");
  }

  const totalMeanLatency = net + Wbatch + meanSystem;
  const totalP95Latency = net + Wbatch + p95System;

  const reqPerMonth = lambda * hoursPerMonth * 3600;
  const costPerMonth = c * gpuPricePerHour * hoursPerMonth;
  const costPerReq = reqPerMonth > 0 ? (costPerMonth / reqPerMonth) : 0;

  return {
    inputs: { ...params, tokensTotal: T, tpsEff, eff },
    derived: {
      lambda,
      mu,
      serviceTimeSec: S,
      batchWaitSec: Wbatch,
      rho: q.rho,
      Pw: q.Pw,
      WqSec: q.Wq
    },
    latency: {
      meanSec: totalMeanLatency,
      p95Sec: totalP95Latency
    },
    cost: {
      costPerMonth,
      costPerReq,
      costPer1M: costPerReq * 1e6,
      reqPerMonth
    },
    warnings
  };
}
