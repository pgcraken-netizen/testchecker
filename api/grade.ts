import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// 10MB まで body を受け付ける（base64 画像）
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

// Vercel Pro は最大 300 秒。Hobby は 10 秒なので注意
export const maxDuration = 60;

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'ANTHROPIC_API_KEY 環境変数が設定されていません。' +
        'Vercel ダッシュボード → Settings → Environment Variables から設定してください。',
    });
  }

  const { imageBase64, mediaType } = req.body as {
    imageBase64?: string;
    mediaType?: string;
  };

  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'imageBase64 と mediaType が必要です' });
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(mediaType)) {
    return res.status(400).json({ error: '対応していない画像形式です' });
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: imageBase64,
              },
            },
            { type: 'text', text: GRADING_PROMPT },
          ],
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return res.status(422).json({
        error: '採点結果のJSONを取得できませんでした。テスト画像を確認してください。',
      });
    }

    return res.status(200).json(JSON.parse(match[0]));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '不明なエラー';
    return res.status(500).json({ error: `採点中にエラーが発生しました: ${message}` });
  }
}
