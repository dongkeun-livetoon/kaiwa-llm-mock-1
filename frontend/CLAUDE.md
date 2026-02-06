# Kaiwa LLM Mock - Claude Code 가이드

## 프로젝트 구조

```
frontend/
├── src/
│   ├── App.tsx          # 메인 앱 (채팅 UI, 이미지 생성)
│   └── data/mockData.ts # 캐릭터 정의 & 프롬프트
├── functions/api/
│   └── [[route]].ts     # Cloudflare Workers API
└── public/              # 정적 파일 (avatars, refs)
```

---

## 프롬프트 시스템

### 구조
```
[캐릭터 프롬프트 (mockData.ts)]
    ↓
[출력형식 규칙 (App.tsx getOutputFormatPrompt)]
    ↓
[NSFW 모드 (App.tsx getNsfwPrompt)]
```

### 출력 형식 규칙 (필수 준수)

모든 캐릭터 프롬프트 끝에 다음 규칙이 자동 추가됨:

```
【出力形式：絶対遵守】
- 会話文・セリフのみを出力すること
- 括弧による行動・感情描写は絶対禁止：（）「」【】() [] 全て禁止
- 悪い例：「（頬を赤らめながら）えっと...」
- 良い例：「えっと...ちょっと恥ずかしいんだけど」
- 感情や動作は言葉で表現する。括弧で説明しない
- マークダウン記法（**太字**、*斜体*等）禁止
- ト書き、地の文、ナレーション禁止
```

### 캐릭터 프롬프트 작성 가이드

**필수 섹션:**
1. `## 基本情報` - 나이, 생일, 신장 등
2. `## 背景` - 캐릭터 배경 스토리
3. `## 性格` - 성격 특성
4. `## 口調` - 말투, 1인칭, 특징적 표현
5. `## 禁止事項` - 해당 캐릭터가 하면 안되는 것

**禁止事項에 반드시 포함:**
```markdown
## 禁止事項
- (캐릭터별 금지사항)
- 括弧による行動描写（例：（笑う）（照れる））
- 地の文やナレーション
- マークダウン記法
```

---

## 이미지 생성 시스템

### NovelAI V4.5 API
- Character Reference: 캐릭터 일관성 유지
- Vibe Transfer (연속): 이전 이미지 스타일 유지

### 429 에러 방지
- `isGeneratingImage` 상태로 동시 요청 차단
- 429 발생 시 3초 간격 최대 3회 재시도

### Danbooru 태그 생성
- `/api/image/judge`에서 Kimi가 대화 맥락 기반으로 태그 생성
- 캐릭터별 기본 외모 태그: `CHARACTER_BASE_PROMPTS`

---

## 자주 발생하는 문제

### 1. 괄호가 출력에 포함됨
**원인:** LLM이 지시를 무시하고 `（動作）` 형태로 출력
**해결:**
1. `getOutputFormatPrompt()`에서 명시적 금지
2. `cleanAssistantResponse()`로 렌더링 시 제거
3. 캐릭터 프롬프트 `禁止事項`에 추가

### 2. 429 Concurrent generation locked
**원인:** NovelAI 동시 요청 제한
**해결:** `isGeneratingImage` 체크 + 재시도 로직

### 3. 캐릭터가 성격과 다르게 행동
**원인:** NSFW 모드가 성격을 override
**해결:** `getNsfwPrompt()`에 "キャラクター性維持" 규칙 추가됨

---

## 배포

```bash
npm run build
# dist/ 폴더가 Cloudflare Pages로 자동 배포
```

## 개발

```bash
npm run dev      # 로컬 개발 서버
npm run build    # 프로덕션 빌드
```
