import { simulateAI } from "./simulator.js";

const el = (id) => document.getElementById(id);
const inputs = {
  rps: el("rps"),
  gpus: el("gpus"),
  tin: el("tin"),
  tout: el("tout"),
  tps: el("tps"),
  batch: el("batch"),
  over: el("over"),
  net: el("net"),
  price: el("price"),
};

const setText = (id, v) => (el(id).textContent = v);

function fmtMs(sec) {
  if (!isFinite(sec)) return "∞";
  return `${Math.round(sec * 1000)} ms`;
}
function fmt2(x) {
  if (!isFinite(x)) return "∞";
  return x.toFixed(2);
}
function fmtMoney(x) {
  if (!isFinite(x)) return "∞";
  return `$${x.toFixed(2)}`;
}

function render() {
  setText("rpsVal", inputs.rps.value);
  setText("gpusVal", inputs.gpus.value);
  setText("tinVal", inputs.tin.value);
  setText("toutVal", inputs.tout.value);
  setText("tpsVal", inputs.tps.value);
  setText("batchVal", inputs.batch.value);
  setText("overVal", inputs.over.value);
  setText("netVal", inputs.net.value);
  setText("priceVal", inputs.price.value);

  const result = simulateAI({
    rps: Number(inputs.rps.value),
    gpus: Number(inputs.gpus.value),
    tokensIn: Number(inputs.tin.value),
    tokensOut: Number(inputs.tout.value),
    tpsPerGpuBase: Number(inputs.tps.value),
    batchSize: Number(inputs.batch.value),
    batchAlpha: 0.35,
    batchMaxEff: 2.2,
    maxBatchWaitMs: 10,
    overheadMs: Number(inputs.over.value),
    netMs: Number(inputs.net.value),
    gpuPricePerHour: Number(inputs.price.value),
    hoursPerMonth: 730,
  });

  setText("p95", fmtMs(result.latency.p95Sec));
  setText("mean", fmtMs(result.latency.meanSec));
  setText("rho", fmt2(result.derived.rho));
  setText("cpm", fmtMoney(result.cost.costPer1M));
  setText("month", fmtMoney(result.cost.costPerMonth));

  const warnDiv = el("warnings");
  warnDiv.replaceChildren();
  if (result.warnings.length) {
    result.warnings.forEach((w) => {
      const p = document.createElement("p");
      p.className = w.includes("UNSTABLE") ? "bad" : "warn";
      p.textContent = `⚠ ${w}`;
      warnDiv.appendChild(p);
    });
  }
}

Object.values(inputs).forEach((i) => i.addEventListener("input", render));
render();
