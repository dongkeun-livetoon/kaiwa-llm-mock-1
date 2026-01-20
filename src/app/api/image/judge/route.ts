import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

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
  // New structured state fields
  clothingState?: string;
  poseState?: string;
  locationState?: string;
  actionState?: string;
}

// Clothing states that judge can return (safe for LLM to generate)
const CLOTHING_STATES = [
  'fully_clothed',      // 완전히 옷 입음
  'casual',             // 평상복
  'formal',             // 정장
  'swimsuit',           // 수영복
  'underwear',          // 속옷
  'lingerie',           // 란제리
  'topless',            // 상의 탈의
  'bottomless',         // 하의 탈의
  'nude',               // 전라
  'partially_dressed',  // 일부만 입음
  'towel_only',         // 수건만
  'apron_only',         // 앞치마만
] as const;

// Pose states
const POSE_STATES = [
  'standing',
  'sitting',
  'lying_down',
  'lying_on_back',
  'lying_on_stomach',
  'kneeling',
  'on_all_fours',
  'bent_over',
  'straddling',
  'spread',
  'curled_up',
] as const;

// Action states for explicit scenes
const ACTION_STATES = [
  'none',
  'flirting',
  'undressing',
  'touching_self',
  'being_touched',
  'kissing',
  'foreplay',
  'intercourse',
  'climax',
  'afterglow',
] as const;

const getJudgeSystemPrompt = (nsfwEnabled: boolean, nsfwLevel: string) => {
  let prompt = `あなたはAIキャラクターの会話を分析し、イラストを生成すべきかどうかを判断するエージェントです。

## 最重要: 状態の連続性を維持

**会話履歴から現在の状態を正確に把握してください：**
- 服装の状態（着ている/脱いでいる/途中）
- キャラクターの体勢
- 場所
- 行動/アクション

**状態は明示的に変わるまで維持してください：**
- 「服を脱いだ」→ 以降は nude を維持
- 「下着姿になった」→ underwear を維持
- 「服を着た」という描写があるまで状態は変わらない

## 判断基準

以下の場合にイラスト生成を推奨：
1. 感情的なシーン（喜び、照れ、驚き等）
2. アクション/動作の描写
3. 特別な瞬間（挨拶、告白等）
4. ビジュアル描写（服装、表情等）
5. 会話の転換点`;

  if (nsfwEnabled) {
    prompt += `
6. 親密なシーン、身体的接触`;
    if (nsfwLevel === 'explicit') {
      prompt += `
7. 成人向けシーン（このセッションでは許可）`;
    }
  }

  prompt += `

以下の場合は生成を**推奨しない**：
- 単純な情報のやり取り
- 短い相槌
- 前回と同じ状態の連続`;

  // Output format
  prompt += `

## 出力形式

必ず以下のJSON形式で回答：
{
  "shouldGenerate": true/false,
  "reason": "判断理由（日本語）",
  "clothingState": "${CLOTHING_STATES.join(' | ')}",
  "poseState": "${POSE_STATES.join(' | ')}",
  "locationState": "場所（bedroom/living_room/bathroom/outside/school/office等）",`;

  if (nsfwEnabled && nsfwLevel === 'explicit') {
    prompt += `
  "actionState": "${ACTION_STATES.join(' | ')}",
  "imagePrompt": "NovelAI用の詳細なプロンプト（英語）。露骨な表現OK。例: nude, spread legs, pussy, exposed breasts, masturbating, ahegao",`;
  } else {
    prompt += `
  "imagePrompt": "シーン説明（英語）例: sitting on bed, looking at viewer, blushing",`;
  }

  prompt += `
  "emotion": "happy/excited/shy/surprised/sad/calm/angry${nsfwEnabled ? '/seductive/embarrassed/pleasure' : ''}",
  "scene": "シーンの説明（日本語）",
  "nsfw": true/false
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
    if (!CEREBRAS_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'CEREBRAS_API_KEY is not set' },
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

    // Build context for the judge - more history for state tracking
    const recentHistory = conversationHistory.slice(-12);
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

この発言に対して、イラストを生成すべきかどうか判断してください。
状態分類（clothingState, poseState等）を正確に設定してください。`;

    const systemPrompt = getJudgeSystemPrompt(nsfwEnabled, nsfwLevel);

    // Use Cerebras Llama for judge (no NSFW filter)
    const response = await fetch(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b',
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
      console.error('Cerebras Judge API error:', error);
      return NextResponse.json(
        { success: false, error: `Judge API error: ${error}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!data.choices?.[0]?.message?.content) {
      console.error('Cerebras response structure:', JSON.stringify(data));
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
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      judgeResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse judge response:', parseError);
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
