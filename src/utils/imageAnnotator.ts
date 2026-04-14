import type { QuestionResult } from '../types';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export async function annotateImage(
  imageDataUrl: string,
  questions: QuestionResult[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas contextの取得に失敗しました')); return; }

      ctx.drawImage(img, 0, 0);

      const baseSize = Math.min(img.naturalWidth, img.naturalHeight);
      const markRadius = Math.max(baseSize * 0.028, 22);
      const lineW = Math.max(baseSize * 0.005, 4);
      const fontSize = Math.max(Math.round(baseSize * 0.022), 18);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const q of questions) {
        const cx = q.answer_position.x * img.naturalWidth;
        const cy = q.answer_position.y * img.naturalHeight;

        ctx.lineWidth = lineW;

        if (q.is_correct) {
          // ○ — 日本の採点慣習は赤丸
          ctx.strokeStyle = 'rgba(200, 0, 30, 0.88)';
          ctx.beginPath();
          ctx.arc(cx, cy, markRadius, 0, 2 * Math.PI);
          ctx.stroke();
        } else {
          // × — 赤バツ
          ctx.strokeStyle = 'rgba(200, 0, 30, 0.88)';
          const s = markRadius * 0.80;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s);
          ctx.lineTo(cx + s, cy + s);
          ctx.moveTo(cx + s, cy - s);
          ctx.lineTo(cx - s, cy + s);
          ctx.stroke();

          // 模範解答ラベル
          if (q.correct_answer) {
            const label = `→ ${q.correct_answer}`;
            ctx.font = `bold ${fontSize}px 'Hiragino Sans','Yu Gothic','Meiryo',sans-serif`;
            const metrics = ctx.measureText(label);
            const pad = 5;
            const bw = metrics.width + pad * 2;
            const bh = fontSize + pad * 2;
            const tx = cx + markRadius + 8;
            const ty = cy - bh / 2;

            // 背景
            ctx.fillStyle = 'rgba(255, 245, 240, 0.93)';
            ctx.strokeStyle = 'rgba(200, 0, 30, 0.65)';
            ctx.lineWidth = 1.5;
            roundRect(ctx, tx, ty, bw, bh, 5);
            ctx.fill();
            ctx.stroke();

            // テキスト
            ctx.fillStyle = 'rgba(170, 0, 20, 1)';
            ctx.fillText(label, tx + pad, ty + pad + fontSize * 0.82);
          }
        }
      }

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };

    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = imageDataUrl;
  });
}
