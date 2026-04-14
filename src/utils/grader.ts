import Anthropic from '@anthropic-ai/sdk';
import type { ImageMediaType, GradeData } from '../types';

const GRADING_PROMPT = `あなたは小学生の塾のテスト採点システムです。
提供された画像はテスト用紙の写真です。

【採点手順】
1. 画像に写っているすべての設問を特定してください
2. 各設問に対する生徒の回答（手書きの可能性あり）を読み取ってください
3. 各回答の正誤を判定してください（算数・国語・理科・社会などに対応）
4. 不正解の場合は正しい回答を提示してください

【座標の指定方法】
各回答の位置を画像の正規化座標で示してください：
- x軸：画像の左端=0.0、右端=1.0
- y軸：画像の上端=0.0、下端=1.0
- answer_positionには回答が書かれている箇所の中心座標を指定してください

【出力形式】
必ずJSONのみで回答し、他のテキストは含めないでください：

{
  "questions": [
    {
      "number": "1",
      "student_answer": "生徒の回答テキスト（空欄の場合は空文字列）",
      "is_correct": true,
      "correct_answer": null,
      "answer_position": { "x": 0.75, "y": 0.20 }
    },
    {
      "number": "2",
      "student_answer": "3",
      "is_correct": false,
      "correct_answer": "5",
      "answer_position": { "x": 0.75, "y": 0.35 }
    }
  ],
  "total_correct": 1,
  "total_questions": 2
}`;

/** 画像を最大 maxDim px にリサイズして data URL を返す */
export async function resizeImageForApi(dataUrl: string, maxDim = 1920): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxDim && h <= maxDim) { resolve(dataUrl); return; }
      if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else       { w = Math.round((w * maxDim) / h); h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.src = dataUrl;
  });
}

function toMediaType(raw: string): ImageMediaType {
  const valid: ImageMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  return valid.includes(raw as ImageMediaType) ? (raw as ImageMediaType) : 'image/jpeg';
}

/** /api/grade サーバーサイド経由で採点（Vercel 本番・vercel dev） */
async function gradeViaServer(imageBase64: string, mediaType: string): Promise<GradeData> {
  const res = await fetch('/api/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mediaType }),
  });
  const json: unknown = await res.json().catch(() => ({ error: 'レスポンスの解析に失敗しました' }));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `サーバーエラー (${res.status})`);
  return json as GradeData;
}

/** APIキーをブラウザから直接使用して採点（ローカル開発用） */
async function gradeDirectly(apiKey: string, imageBase64: string, mediaType: ImageMediaType): Promise<GradeData> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: GRADING_PROMPT },
      ],
    }],
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('採点結果のJSONを取得できませんでした。テスト画像が正しいか確認してください。');
  return JSON.parse(match[0]) as GradeData;
}

/**
 * テスト採点のメインエントリポイント
 * - apiKey が空文字 → /api/grade サーバー経由（Vercel 環境変数 ANTHROPIC_API_KEY を使用）
 * - apiKey が指定済み → ブラウザから Anthropic API を直接呼び出し（ローカル開発用）
 */
export async function gradeTest(apiKey: string, imageDataUrl: string): Promise<GradeData> {
  const resized = await resizeImageForApi(imageDataUrl);
  const base64Data = resized.split(',')[1];
  const mediaType = toMediaType(resized.split(';')[0].split(':')[1]);

  if (apiKey) {
    return gradeDirectly(apiKey, base64Data, mediaType);
  }
  return gradeViaServer(base64Data, mediaType);
}
