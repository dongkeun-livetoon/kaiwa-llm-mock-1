// Character definition (legacy, for backward compatibility)
export interface Character {
  id: string;
  name: string;
  displayName: string;
  description: string;
  personality: string[];
  speechPatterns: string[];
  avatarUrl: string;
  referenceImageUrl?: string; // vibe transfer용 전신 이미지
  emotions: string[];
  createdAt: string;
  updatedAt: string;
  hidden?: boolean;
}

// ========================================
// Unified Character Template System
// (Inspired by RisuAI character card format)
// ========================================

/** 외모 정보 (이미지 생성용 Danbooru 태그) */
export interface CharacterAppearance {
  /** 머리카락 (예: "blonde hair, long hair, twintails") */
  hair: string;
  /** 눈 (예: "blue eyes, sharp eyes") */
  eyes: string;
  /** 체형 (예: "medium breasts, slim") */
  body: string;
  /** 기본 의상 (예: "school uniform, white shirt") */
  outfit: string;
  /** 액세서리 (예: "heart necklace, hair ribbon") */
  accessories: string;
}

/** 성격 프로파일 */
export interface CharacterPersonality {
  /** 성격 특성 키워드 */
  traits: string[];
  /** Big Five 성격 지표 (optional, 0-100) */
  bigFive?: {
    E: number; // 외향성
    A: number; // 친화성
    C: number; // 성실성
    N: number; // 신경증
    O: number; // 개방성
  };
  /** 핵심 동기 */
  coreMotivations: string[];
  /** 감정 반응 패턴 */
  emotionPatterns?: { trigger: string; response: string }[];
}

/** 말투 정보 */
export interface CharacterSpeech {
  /** 1인칭 (예: "私", "ウチ", "俺") */
  firstPerson: string;
  /** 2인칭 (예: "あなた", "アンタ", "君") */
  secondPerson: string;
  /** 말투 스타일 설명 */
  style: string;
  /** 특징적 어미/표현 */
  patterns: string[];
  /** 상황별 대사 예시 */
  examples?: { situation: string; dialogue: string }[];
}

/** 배경 정보 */
export interface CharacterBackground {
  /** 나이 */
  age: string;
  /** 직업/소속 */
  occupation: string;
  /** 배경 스토리 */
  story: string;
  /** 외견 설명 (텍스트) */
  visualDescription?: string;
  /** 관계성 (유저와의 관계) */
  userRelation?: string;
}

/** 행동 규칙 */
export interface CharacterBehavior {
  /** 허용되는 행동/화제 */
  allowed?: string[];
  /** 금지된 행동/화제 */
  forbidden: string[];
  /** 특정 화제에 대한 반응 */
  topicResponses?: { trigger: string; response: string }[];
}

/** 통합 캐릭터 템플릿 */
export interface CharacterTemplate {
  // === 기본 정보 ===
  id: string;
  name: string;
  displayName: string;
  description: string;

  // === 비주얼 ===
  avatarUrl: string;
  referenceImageUrl?: string;
  appearance: CharacterAppearance;

  // === 캐릭터성 ===
  personality: CharacterPersonality;
  speech: CharacterSpeech;
  background: CharacterBackground;
  behavior: CharacterBehavior;

  // === 첫 인사 ===
  firstMessage: string;
  alternateGreetings?: string[];

  // === 메타 ===
  hidden?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Prompt version
export interface PromptVersion {
  id: string;
  characterId: string;
  version: string;
  content: string;
  description: string;
  createdAt: string;
  createdBy: string;
  isActive: boolean;
}

// Prompt change history
export interface PromptHistory {
  id: string;
  promptId: string;
  version: string;
  changeType: 'create' | 'update' | 'rollback';
  changeSummary: string;
  previousContent?: string;
  newContent: string;
  createdAt: string;
  createdBy: string;
}

// Conversation session
export interface ConversationSession {
  id: string;
  characterId: string;
  promptVersion: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  firstMessage?: string;
}

// Chat message
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
  timestamp: string;
}
