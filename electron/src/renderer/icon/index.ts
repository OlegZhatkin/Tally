/**
 * Рисует иконку трея с процентом. Нужно только Windows: подписей у иконок
 * в области уведомлений нет, поэтому цифры приходится растеризовать.
 * Main-процесс вызывает эту функцию через executeJavaScript.
 */

export interface TrayIconRequest {
  text: string;
  color: string;
  /** 0..1 — заполнение полоски под цифрами. */
  fraction: number;
  size: number;
}

declare global {
  interface Window {
    renderTrayIcon: (request: TrayIconRequest) => string;
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

window.renderTrayIcon = ({ text, color, fraction, size }: TrayIconRequest): string => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, size, size);

  const barHeight = Math.max(3, Math.round(size * 0.14));
  const textHeight = size - barHeight - 2;

  // Цифры во всю высоту, с уменьшением шрифта, если не влезают по ширине.
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = textHeight;
  do {
    ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
    fontSize -= 1;
  } while (fontSize > 6 && ctx.measureText(text).width > size - 2);
  ctx.fillText(text, size / 2, textHeight / 2 + 1);

  // Полоска заполнения под цифрами.
  const radius = barHeight / 2;
  ctx.globalAlpha = 0.28;
  roundedRect(ctx, 0, size - barHeight, size, barHeight, radius);
  ctx.globalAlpha = 1;
  const filled = Math.max(barHeight, size * Math.min(Math.max(fraction, 0), 1));
  roundedRect(ctx, 0, size - barHeight, filled, barHeight, radius);

  return canvas.toDataURL('image/png');
};
