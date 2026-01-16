'use client';

import { useState, useEffect } from 'react';
import { mockCharacters } from '@/data/mockData';
import { getSessions, getSessionMessages, deleteSession, StoredSession, StoredMessage } from '@/lib/storage';

const characterEmojis: Record<string, string> = {
  'una-001': '🐰',
  'sakura-001': '🌸',
  'kai-001': '🏄',
};

export default function ConversationsPage() {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<StoredSession | null>(null);
  const [sessionMessages, setSessionMessages] = useState<StoredMessage[]>([]);

  // Load sessions from local storage
  useEffect(() => {
    setSessions(getSessions());
  }, []);

  // Load messages when session is selected
  useEffect(() => {
    if (selectedSession) {
      setSessionMessages(getSessionMessages(selectedSession.id));
    } else {
      setSessionMessages([]);
    }
  }, [selectedSession]);

  const handleDeleteSession = (sessionId: string) => {
    if (confirm('この会話を削除しますか？')) {
      deleteSession(sessionId);
      setSessions(getSessions());
      if (selectedSession?.id === sessionId) {
        setSelectedSession(null);
      }
    }
  };

  const getEmotionEmoji = (emotion?: string) => {
    switch (emotion) {
      case 'happy': return '😊';
      case 'excited': return '🤩';
      case 'sad': return '😢';
      case 'calm': return '😌';
      case 'shy': return '😳';
      case 'surprised': return '😲';
      default: return '😐';
    }
  };

  return (
    <div className="h-full animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 mb-2">会話履歴</h1>
          <p className="text-slate-500">過去の会話セッションを確認</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            {sessions.length} セッション
          </span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-220px)]">
        {/* Session List */}
        <div className="col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">セッション</h2>
            <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
              {sessions.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {sessions.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <p>会話履歴がありません</p>
                <p className="text-sm mt-1">会話を始めると、ここに保存されます</p>
              </div>
            ) : (
              sessions.map((session) => {
                const character = mockCharacters.find(c => c.id === session.characterId);
                return (
                  <button
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className={`w-full text-left p-4 rounded-xl transition-all ${
                      selectedSession?.id === session.id
                        ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-300 shadow-sm'
                        : 'bg-slate-50 hover:bg-slate-100 border-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white shrink-0">
                        {characterEmojis[session.characterId] || '👤'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-800">
                            {new Date(session.startedAt).toLocaleDateString('ja-JP')}
                          </span>
                          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded text-xs font-medium">
                            {session.promptVersion}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 line-clamp-2 mb-2">
                          {session.firstMessage || '(メッセージなし)'}
                        </p>
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>{character?.displayName || session.characterName}</span>
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            {session.messageCount}
                          </span>
                        </div>
                        {session.nsfwEnabled && (
                          <span className="inline-block mt-2 px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">
                            NSFW
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat View */}
        <div className="col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200/60 flex flex-col overflow-hidden">
          {selectedSession ? (
            <>
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-2xl shadow-lg">
                      {characterEmojis[selectedSession.characterId] || '👤'}
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-800">
                        {new Date(selectedSession.startedAt).toLocaleString('ja-JP')}
                      </h2>
                      <p className="text-sm text-slate-500">
                        {selectedSession.promptVersion} · {selectedSession.model} · {selectedSession.messageCount} メッセージ
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeleteSession(selectedSession.id)}
                      className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-slate-50/50 to-white">
                {sessionMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center mr-3 shrink-0 shadow-md">
                        <span className="text-sm">{characterEmojis[selectedSession.characterId] || '👤'}</span>
                      </div>
                    )}
                    <div
                      className={`max-w-[70%] p-4 rounded-2xl shadow-sm ${
                        message.role === 'user'
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                          : 'bg-white border border-slate-200'
                      }`}
                    >
                      {message.role === 'assistant' && message.emotion && (
                        <span className="text-lg mr-2">{getEmotionEmoji(message.emotion)}</span>
                      )}
                      <p className={message.role === 'user' ? 'text-white' : 'text-slate-700'}>{message.content}</p>
                      <p className={`text-xs mt-2 ${message.role === 'user' ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {new Date(message.timestamp).toLocaleTimeString('ja-JP')}
                      </p>
                    </div>
                    {message.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center ml-3 shrink-0 shadow-md">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Stats Footer */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80">
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">所要時間</p>
                    <p className="font-semibold text-slate-700 mt-1">
                      {selectedSession.endedAt
                        ? `${Math.round((new Date(selectedSession.endedAt).getTime() - new Date(selectedSession.startedAt).getTime()) / 60000)} 分`
                        : '進行中'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">メッセージ</p>
                    <p className="font-semibold text-slate-700 mt-1">{selectedSession.messageCount}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">モデル</p>
                    <p className="font-semibold text-slate-700 mt-1 text-xs">{selectedSession.model}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">状態</p>
                    <p className={`font-semibold mt-1 ${selectedSession.endedAt ? 'text-slate-500' : 'text-emerald-600'}`}>
                      {selectedSession.endedAt ? '終了' : 'アクティブ'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="text-slate-700 font-medium text-lg">会話を選択</p>
                <p className="text-slate-400 mt-1">左のリストからセッションを選んでください</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
