// Local Storage keys
const STORAGE_KEYS = {
  SESSIONS: 'kaiwa_sessions',
  MESSAGES: 'kaiwa_messages',
} as const;

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
  timestamp: string;
}

export interface StoredSession {
  id: string;
  characterId: string;
  characterName: string;
  promptVersion: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  firstMessage?: string;
  nsfwEnabled: boolean;
}

// Get all sessions from local storage
export function getSessions(): StoredSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Save sessions to local storage
export function saveSessions(sessions: StoredSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
}

// Add a new session
export function addSession(session: StoredSession): void {
  const sessions = getSessions();
  sessions.unshift(session); // Add to beginning
  saveSessions(sessions);
}

// Update a session
export function updateSession(sessionId: string, updates: Partial<StoredSession>): void {
  const sessions = getSessions();
  const index = sessions.findIndex(s => s.id === sessionId);
  if (index !== -1) {
    sessions[index] = { ...sessions[index], ...updates };
    saveSessions(sessions);
  }
}

// Delete a session and its messages
export function deleteSession(sessionId: string): void {
  const sessions = getSessions();
  saveSessions(sessions.filter(s => s.id !== sessionId));

  const messages = getMessages();
  saveMessages(messages.filter(m => m.sessionId !== sessionId));
}

// Get all messages from local storage
export function getMessages(): StoredMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Save messages to local storage
export function saveMessages(messages: StoredMessage[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
}

// Get messages for a specific session
export function getSessionMessages(sessionId: string): StoredMessage[] {
  return getMessages().filter(m => m.sessionId === sessionId);
}

// Add a message to a session
export function addMessage(message: StoredMessage): void {
  const messages = getMessages();
  messages.push(message);
  saveMessages(messages);

  // Update session message count
  const sessions = getSessions();
  const session = sessions.find(s => s.id === message.sessionId);
  if (session) {
    session.messageCount = messages.filter(m => m.sessionId === message.sessionId).length;
    if (!session.firstMessage && message.role === 'assistant') {
      session.firstMessage = message.content.slice(0, 50);
    }
    saveSessions(sessions);
  }
}

// Clear all data
export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.SESSIONS);
  localStorage.removeItem(STORAGE_KEYS.MESSAGES);
}
