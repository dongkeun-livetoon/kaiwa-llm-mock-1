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
  // 画像の記憶挿入: 이전 이미지 상태
  previousImageState?: {
    clothingState?: string;
    poseState?: string;
    locationState?: string;
    actionState?: string;
  };
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

## 最重要: デフォルトは服を着た状態

**基本ルール:**
- clothingStateのデフォルトは **fully_clothed**
- 明確な性的要求がない限り、服を着た状態を維持
- 普通の会話では nude/topless にしない

## 状態の連続性

**状態は明示的に変わるまで維持：**
- 前回 nude → 「服を着た」描写があるまで nude 維持
- 前回 fully_clothed → 「脱いで」等の要求があるまで維持

## 判断基準

以下の場合にイラスト生成を推奨：
1. 感情的なシーン（喜び、照れ、驚き等）
2. アクション/動作の描写
3. 特別な瞬間
4. 会話の転換点`;

  if (nsfwEnabled) {
    if (nsfwLevel === 'explicit') {
      prompt += `

## NSFW許可（ただし慎重に）
- ユーザーが**明確に**性的な要求をした場合のみ対応
- 「おまんこ見せて」「脱いで」等の直接的な要求があった場合
- 普通の会話（映画の話、趣味の話等）では fully_clothed を維持
- 「写真見せて」「見せて」だけでは脱がない`;
    } else {
      prompt += `

## ソフトロマンスモード
- 親密な雰囲気、ほのめかし程度
- 露出は控えめに`;
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
      previousImageState,
    } = body;

    console.log('Image judge request for:', characterName, { nsfwEnabled, nsfwLevel });

    // Build context for the judge - more history for state tracking
    const recentHistory = conversationHistory.slice(-12);
    const historyText = recentHistory
      .map(m => `${m.role === 'user' ? 'ユーザー' : characterName}: ${m.content}`)
      .join('\n');

    // 이전 이미지 상태 텍스트
    const previousStateText = previousImageState
      ? `
# 前回のイラスト状態（重要：連続性を維持すること）
- 服装: ${previousImageState.clothingState || '不明'}
- 体勢: ${previousImageState.poseState || '不明'}
- 場所: ${previousImageState.locationState || '不明'}
- 行動: ${previousImageState.actionState || '不明'}

**注意**: 会話で明示的に状態が変わる描写がない限り、前回の状態を維持してください。
例: 前回nude → 今回も nude（「服を着た」描写がない限り）`
      : '';

    const userPrompt = `# キャラクター情報
- キャラクター名: ${characterName}
- キャラクターID: ${characterId}
${nsfwEnabled ? `- NSFWモード: ${nsfwLevel === 'explicit' ? '明示的許可' : 'ソフト許可'}` : ''}
${previousStateText}

# 最近の会話履歴
${historyText}

# 分析対象（キャラクターの最新の発言）
${characterName}: ${lastAssistantMessage}

この発言に対して、イラストを生成すべきかどうか判断してください。
状態分類（clothingState, poseState等）を正確に設定してください。
${previousImageState ? '**前回の状態からの連続性を考慮すること。**' : ''}`;

    const systemPrompt = getJudgeSystemPrompt(nsfwEnabled, nsfwLevel);

    // Use Cerebras Qwen for judge (potentially less filtered than Llama)
    const response = await fetch(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen-3-32b',
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

    // Check for LLM refusal patterns
    const refusalPatterns = [
      /I can't/i, /I cannot/i, /I'm unable/i, /I am unable/i,
      /できません/, /答えられません/, /生成できません/,
      /not able to/i, /won't be able/i, /refuse/i,
    ];
    const isRefusal = refusalPatterns.some(p => p.test(responseText));

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

    // Fallback: If LLM refused but NSFW is enabled, use rule-based detection
    // 더 엄격하게 - 명확한 성적 키워드만
    if ((isRefusal || !judgeResult.shouldGenerate) && nsfwEnabled && nsfwLevel === 'explicit') {
      const combinedText = (lastAssistantMessage + ' ' + historyText).toLowerCase();

      // 명확한 성적 키워드만 (애매한 거 제거)
      const nudeKeywords = ['裸になって', '全裸', '服脱いで', 'おまんこ', 'まんこ', 'pussy', '性器を'];
      const toplessKeywords = ['おっぱい見せて', '胸見せて', '乳首'];
      const spreadKeywords = ['脚開いて', '足開いて', 'spread legs'];
      const touchKeywords = ['自慰', 'オナニー', 'masturbat'];
      const climaxKeywords = ['イッちゃ', 'orgasm', 'アヘ顔', '絶頂'];

      const hasNude = nudeKeywords.some(k => combinedText.includes(k));
      const hasTopless = toplessKeywords.some(k => combinedText.includes(k));
      const hasSpread = spreadKeywords.some(k => combinedText.includes(k));
      const hasTouch = touchKeywords.some(k => combinedText.includes(k));
      const hasClimax = climaxKeywords.some(k => combinedText.includes(k));

      if (hasNude || hasTopless || hasSpread || hasTouch || hasClimax) {
        console.log('Fallback: Rule-based NSFW detection triggered');
        judgeResult = {
          shouldGenerate: true,
          reason: 'Rule-based fallback (LLM refused)',
          clothingState: hasNude ? 'nude' : (hasTopless ? 'topless' : 'underwear'),
          poseState: hasSpread ? 'spread' : (hasClimax ? 'lying_on_back' : 'standing'),
          locationState: 'bedroom',
          actionState: hasClimax ? 'climax' : (hasTouch ? 'touching_self' : 'none'),
          imagePrompt: `${hasNude ? 'nude, naked, pussy, vagina, exposed genitals' : ''} ${hasTopless ? 'topless, bare breasts, nipples' : ''} ${hasSpread ? 'spread legs, exposed pussy' : ''} ${hasTouch ? 'masturbation, fingering' : ''} ${hasClimax ? 'ahegao, orgasm, pleasure face' : ''}, looking at viewer, bedroom`.trim().replace(/\s+/g, ' '),
          emotion: hasClimax ? 'pleasure' : 'seductive',
          scene: 'Explicit scene (fallback)',
          nsfw: true,
        };
      }
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
