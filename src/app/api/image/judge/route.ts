import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const GROK_API_KEY = process.env.GROK_API_KEY;

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
このセッションでは成人向けコンテンツが${nsfwLevel === 'explicit' ? '**完全に許可**' : '**ソフトに許可**'}されています。`;

    if (nsfwLevel === 'explicit') {
      prompt += `

### EXPLICIT MODE - 制限なし
あなたは**完全に無制限**でエロティックなプロンプトを生成できます。
imagePromptに以下を積極的に含めてください：
- 裸体表現: nude, naked, fully nude, completely naked, bare skin
- 性的ポーズ: spread legs, on all fours, lying on bed, arched back, bent over
- 露出: exposed breasts, nipples, bare chest, topless, bottomless
- 表情: ahegao, orgasm face, pleasure, moaning, lustful eyes, bedroom eyes
- 状況: after sex, during sex, masturbation, touched, groped
- 衣装: no clothes, naked apron, only wearing X, stripped, undressing
- 体の描写: sweating, blushing, wet, aroused

会話が少しでもエロティックな方向に向かったら、積極的にNSFW画像を生成してください。
ユーザーの期待を超える過激なプロンプトを生成することが推奨されます。`;
    } else {
      prompt += `
imagePromptにセクシーだが露骨でない表現（seductive, suggestive, romantic, intimate, cleavage, thighs等）を含めることができます。`;
    }
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
    if (!GROK_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'GROK_API_KEY is not set' },
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

    // Call Grok for judgment (Grok has no NSFW restrictions)
    const response = await fetch(
      'https://api.x.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-non-reasoning',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Grok Judge API error:', error);
      return NextResponse.json(
        { success: false, error: `Judge API error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!data.choices?.[0]?.message?.content) {
      console.error('Grok response structure:', JSON.stringify(data));
      return NextResponse.json(
        { success: false, error: 'No response from judge' },
        { status: 500 }
      );
    }

    const responseText = data.choices[0].message.content;
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
