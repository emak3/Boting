import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { formatBpAmount } from '../bp/bpFormat.mjs';

const WIDTH = 1100;
const HEIGHT = 620;

let renderer = null;

function chartRenderer() {
  if (renderer) return renderer;
  renderer = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    backgroundColour: '#ffffff',
    chartCallback: (Chart) => {
      Chart.defaults.font.family = '"Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif';
      Chart.defaults.color = '#30343b';
    },
  });
  return renderer;
}

function pct(value) {
  return value == null || !Number.isFinite(value) ? null : Number((value * 100).toFixed(1));
}

function bp(value) {
  return Math.round(Number(value) || 0);
}

function monthlyLabels(locale) {
  const en = String(locale || '').toLowerCase().startsWith('en');
  return Array.from({ length: 12 }, (_, i) => (en ? `${i + 1}` : `${i + 1}月`));
}

function buildDataset(label, data, color, yAxisID, dashed = false) {
  return {
    label,
    data,
    yAxisID,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    borderDash: dashed ? [8, 6] : [],
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.32,
    spanGaps: true,
  };
}

export async function renderAnnualStatsChartPng(stats, locale = null) {
  const monthly = Array.isArray(stats?.monthly) ? stats.monthly : [];
  const labels = monthlyLabels(locale);
  const en = String(locale || '').toLowerCase().startsWith('en');
  const maxRate = Math.max(
    100,
    ...monthly.flatMap((m) => [pct(m.recoveryRate) ?? 0, pct(m.hitRate) ?? 0]),
  );
  const title = en
    ? `Yearly trend ${stats?.year ?? ''}`
    : `年間推移 ${stats?.year ?? ''}`;
  const configuration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        buildDataset(en ? 'Staked BP' : '購入BP', monthly.map((m) => bp(m.totalCostBp)), '#2563eb', 'bp'),
        buildDataset(en ? 'Refund BP' : '払戻BP', monthly.map((m) => bp(m.totalRefundSettled)), '#16a34a', 'bp'),
        buildDataset(
          en ? 'Net BP' : '月次差額',
          monthly.map((m) => bp((m.totalRefundSettled || 0) - (m.totalCostBp || 0))),
          '#dc2626',
          'bp',
          true,
        ),
        buildDataset(en ? 'Recovery %' : '回収率%', monthly.map((m) => pct(m.recoveryRate)), '#9333ea', 'rate'),
        buildDataset(en ? 'Hit %' : '的中率%', monthly.map((m) => pct(m.hitRate)), '#f59e0b', 'rate'),
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 26, weight: 'bold' },
          padding: { bottom: 22 },
        },
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            padding: 18,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = ctx.parsed.y;
              if (ctx.dataset.yAxisID === 'rate') return `${ctx.dataset.label}: ${value}%`;
              return `${ctx.dataset.label}: ${formatBpAmount(value)} bp`;
            },
          },
        },
      },
      scales: {
        bp: {
          type: 'linear',
          position: 'left',
          grid: { color: '#e7eaf0' },
          ticks: {
            callback: (value) => formatBpAmount(value),
          },
          title: { display: true, text: 'BP' },
        },
        rate: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: Math.ceil(Math.min(Math.max(maxRate * 1.15, 120), 500) / 50) * 50,
          grid: { drawOnChartArea: false },
          ticks: {
            callback: (value) => `${value}%`,
          },
          title: { display: true, text: '%' },
        },
        x: {
          grid: { display: false },
        },
      },
      layout: {
        padding: 18,
      },
    },
  };
  return chartRenderer().renderToBuffer(configuration, 'image/png');
}
