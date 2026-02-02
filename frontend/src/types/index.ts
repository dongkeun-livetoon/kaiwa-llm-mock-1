// Character definition
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
