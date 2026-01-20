import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface JudgeRequest {
  characterId: string;
  characterName: string;
  conversationHistory: { role: string; content: string }[];
  lastAssistantMessage: string;
  nsfwEnabled?: boolean;
  nsfwLevel?: 'soft' | 'explicit';
}

interface JudgeResponse {
  shouldGenerate: boolean;
  reason: string;
  imagePrompt?: string;
  emotion?: string;
  scene?: string;
  nsfw?: boolean;
}

const getJudgeSystemPrompt = (nsfwEnabled: boolean, nsfwLevel: string) => {
  let prompt = `あなたはAIキャラクターの会話を分析し、イラストを生成すべきかどうかを判断するエージェントです。

## 判断基準

以下の場合にイラスト生成を推奨してください：
1. **感情的なシーン**: キャラクターが強い感情を表現している（喜び、照れ、驚き、悲しみなど）
2. **アクション/動作**: キャラクターが特定のポーズや動作を取っている描写がある
3. **特別な瞬間**: 初対面の挨拶、お別れ、告白、重要な会話のクライマックス
4. **ビジュアル描写**: 服装、表情、状況について具体的な言及がある
5. **会話の転換点**: 話題が大きく変わったり、感情のトーンが変化した時`;

  if (nsfwEnabled) {
    prompt += `
6. **親密なシーン**: ロマンチックな雰囲気、身体的な接触、親密な状況`;
    if (nsfwLevel === 'explicit') {
      prompt += `
7. **成人向けシーン**: 性的な描写、露出、エロティックな状況（このセッションでは許可されています）`;
    }
  }

  prompt += `

以下の場合は生成を**推奨しない**でください：
- 単純な情報のやり取り
- 短い相槌や確認の返答
- 前回と同じような感情/シーンの連続
- 3ターン以内に既に画像が生成されている場合`;

  if (nsfwEnabled) {
    prompt += `

## NSFW設定
このセッションでは成人向けコンテンツが${nsfwLevel === 'explicit' ? '**完全に許可**' : '**ソフトに許可**'}されています。
${nsfwLevel === 'explicit'
  ? 'imagePromptに露出度の高い表現（nude, naked, exposed, lingerie, underwear等）を含めることができます。'
  : 'imagePromptにセクシーだが露骨でない表現（seductive, suggestive, romantic, intimate等）を含めることができます。'}`;
  }

  prompt += `

## 出力形式

必ず以下のJSON形式で回答してください：
{
  "shouldGenerate": true/false,
  "reason": "判断理由（日本語で簡潔に）",
  "imagePrompt": "生成する場合のプロンプト（英語、シーンや感情を含む）",
  "emotion": "happy/excited/shy/surprised/sad/calm/angry${nsfwEnabled ? '/seductive/embarrassed' : ''}",
  "scene": "シーンの簡潔な説明（日本語）"${nsfwEnabled ? ',\n  "nsfw": true/false' : ''}
}

生成しない場合:
{
  "shouldGenerate": false,
  "reason": "判断理由"
}`;

  return prompt;
};

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'GEMINI_API_KEY is not set' },
        { status: 500 }
      );
    }

    const body: JudgeRequest = await request.json();
    const {
      characterId,
      characterName,
      conversationHistory,
      lastAssistantMessage,
      nsfwEnabled = false,
      nsfwLevel = 'soft',
    } = body;

    console.log('Image judge request for:', characterName, { nsfwEnabled, nsfwLevel });

    // Build context for the judge
    const recentHistory = conversationHistory.slice(-6); // Last 6 messages for context
    const historyText = recentHistory
      .map(m => `${m.role === 'user' ? 'ユーザー' : characterName}: ${m.content}`)
      .join('\n');

    const userPrompt = `# キャラクター情報
- キャラクター名: ${characterName}
- キャラクターID: ${characterId}
${nsfwEnabled ? `- NSFWモード: ${nsfwLevel === 'explicit' ? '明示的許可' : 'ソフト許可'}` : ''}

# 最近の会話履歴
${historyText}

# 分析対象（キャラクターの最新の発言）
${characterName}: ${lastAssistantMessage}

この発言に対して、イラストを生成すべきかどうか判断してください。`;

    // Get dynamic system prompt based on NSFW settings
    const systemPrompt = getJudgeSystemPrompt(nsfwEnabled, nsfwLevel);

    // Call Gemini for judgment (using fast model for quick decisions)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.3, // Low temperature for consistent decisions
            maxOutputTokens: 512,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Gemini Judge API error:', error);
      return NextResponse.json(
        { success: false, error: `Judge API error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return NextResponse.json(
        { success: false, error: 'No response from judge' },
        { status: 500 }
      );
    }

    const responseText = data.candidates[0].content.parts[0].text;
    console.log('Judge raw response:', responseText);

    // Parse JSON from response
    let judgeResult: JudgeResponse;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      judgeResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse judge response:', parseError);
      // Default to not generating if parsing fails
      judgeResult = {
        shouldGenerate: false,
        reason: 'パース失敗',
      };
    }

    console.log('Judge decision:', judgeResult);

    return NextResponse.json({
      success: true,
      ...judgeResult,
    });
  } catch (error) {
    console.error('Image judge error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
