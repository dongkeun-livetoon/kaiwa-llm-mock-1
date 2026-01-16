'use client';

import { useState, useRef, useEffect } from 'react';
import { mockCharacters, mockPromptVersions } from '@/data/mockData';

const characterEmojis: Record<string, string> = {
  'una-001': '🐰',
  'sakura-001': '🌸',
  'kai-001': '🏄',
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
  timestamp: Date;
}

const LLM_MODELS = [
  { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
  { id: 'gemini-pro', name: 'Gemini Pro', provider: 'Google' },
];

export default function ChatPage() {
  const [selectedCharacterId, setSelectedCharacterId] = useState(mockCharacters[0].id);
  const [selectedModel, setSelectedModel] = useState(LLM_MODELS[0].id);
  const [nsfwEnabled, setNsfwEnabled] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);

  const [isConversationStarted, setIsConversationStarted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedCharacter = mockCharacters.find(c => c.id === selectedCharacterId);
  const activePrompt = mockPromptVersions.find(p => p.characterId === selectedCharacterId && p.isActive);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startConversation = () => {
    setIsConversationStarted(true);
    // Add initial greeting from character
    const greetings: Record<string, string> = {
      'una-001': 'うなな〜！やっほー！うーなだよ！今日は何して遊ぶ？',
      'sakura-001': 'あの…こんにちは。図書室へようこそ。何かお探しですか？',
      'kai-001': 'よっ！元気？今日もいい天気だね〜！',
    };

    setMessages([{
      id: Date.now().toString(),
      role: 'assistant',
      content: greetings[selectedCharacterId] || 'こんにちは！',
      emotion: 'happy',
      timestamp: new Date(),
    }]);
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    // Mock response (simulating LLM)
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

    const mockResponses: Record<string, string[]> = {
      'una-001': [
        'うなな〜！それ面白そう！もっと教えてよん！',
        'うぬぬ…そうなんだ〜。月にはそういうのないからびっくりだよ！',
        'ぴょんぴょこ！うーなもそれ好き！地球って楽しいね〜！',
      ],
      'sakura-001': [
        'なるほど…そうですか。それは興味深いですね。',
        'あの…私もそう思います。本で読んだことがあるかもしれません。',
        'そうですね…少し考えさせてください。',
      ],
      'kai-001': [
        'マジで？それいいね〜！俺も興味あるっしょ！',
        'へー、そうなんだ！今度一緒にやってみようぜ！',
        'いいね〜！そういうの好きだわ〜',
      ],
    };

    const responses = mockResponses[selectedCharacterId] || ['なるほど！'];
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: randomResponse,
      emotion: ['happy', 'excited', 'calm'][Math.floor(Math.random() * 3)],
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, assistantMessage]);
    setIsLoading(false);
  };

  const endConversation = () => {
    setIsConversationStarted(false);
    setMessages([]);
  };

  const getEmotionEmoji = (emotion?: string) => {
    switch (emotion) {
      case 'happy': return '😊';
      case 'excited': return '🤩';
      case 'sad': return '😢';
      case 'calm': return '😌';
      case 'shy': return '😳';
      default: return '';
    }
  };

  return (
    <div className="h-full animate-fadeIn">
      <div className="grid grid-cols-12 gap-6 h-[calc(100vh-120px)]">
        {/* Main Chat Area */}
        <div className="col-span-8 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          {!isConversationStarted ? (
            /* Start Screen */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-xl">
                  <span className="text-5xl">{characterEmojis[selectedCharacterId] || '👤'}</span>
                </div>
                <h1 className="text-2xl font-bold text-slate-800 mb-2">
                  {selectedCharacter?.displayName}と会話する
                </h1>
                <p className="text-slate-500 mb-6">
                  {selectedCharacter?.description}
                </p>
                <button
                  onClick={startConversation}
                  className="px-8 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
                >
                  会話を始める
                </button>
                <p className="text-xs text-slate-400 mt-4">
                  プロンプト: {activePrompt?.version} · モデル: {LLM_MODELS.find(m => m.id === selectedModel)?.name}
                </p>
              </div>
            </div>
          ) : (
            /* Chat Interface */
            <>
              {/* Chat Header */}
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl shadow-lg">
                    {characterEmojis[selectedCharacterId] || '👤'}
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-800">{selectedCharacter?.displayName}</h2>
                    <p className="text-xs text-slate-500">
                      {activePrompt?.version} · {LLM_MODELS.find(m => m.id === selectedModel)?.name}
                    </p>
                  </div>
                </div>
                <button
                  onClick={endConversation}
                  className="px-4 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium"
                >
                  会話を終了
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-slate-50/50 to-white">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center mr-3 shrink-0 shadow-md">
                        <span className="text-sm">{characterEmojis[selectedCharacterId]}</span>
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
                        <span className="text-lg mr-1">{getEmotionEmoji(message.emotion)}</span>
                      )}
                      <span className={message.role === 'user' ? 'text-white' : 'text-slate-700'}>
                        {message.content}
                      </span>
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
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center mr-3 shrink-0 shadow-md">
                      <span className="text-sm">{characterEmojis[selectedCharacterId]}</span>
                    </div>
                    <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-slate-100 bg-white">
                <div className="flex gap-3">
                  <textarea
                    ref={inputRef}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="メッセージを入力..."
                    className="flex-1 px-4 py-3 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    rows={1}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!inputMessage.trim() || isLoading}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all"
                  >
                    送信
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Settings Panel */}
        <div className="col-span-4 space-y-4 overflow-y-auto">
          {/* Character Selection */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">キャラクター選択</h3>
            <div className="space-y-2">
              {mockCharacters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => !isConversationStarted && setSelectedCharacterId(char.id)}
                  disabled={isConversationStarted}
                  className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all ${
                    selectedCharacterId === char.id
                      ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-300'
                      : 'bg-slate-50 hover:bg-slate-100 border-2 border-transparent'
                  } ${isConversationStarted ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span className="text-2xl">{characterEmojis[char.id]}</span>
                  <div className="text-left">
                    <p className="font-medium text-slate-800">{char.displayName}</p>
                    <p className="text-xs text-slate-500">{char.personality.slice(0, 2).join(', ')}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* LLM Settings */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">LLM設定</h3>

            <div className="space-y-4">
              {/* Model Selection */}
              <div>
                <label className="block text-sm text-slate-600 mb-2">モデル</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isConversationStarted}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                >
                  {LLM_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>

              {/* Temperature */}
              <div>
                <label className="block text-sm text-slate-600 mb-2">
                  Temperature: {temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  disabled={isConversationStarted}
                  className="w-full accent-indigo-500 disabled:opacity-60"
                />
              </div>

              {/* Max Tokens */}
              <div>
                <label className="block text-sm text-slate-600 mb-2">
                  Max Tokens: {maxTokens}
                </label>
                <input
                  type="range"
                  min="256"
                  max="4096"
                  step="256"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                  disabled={isConversationStarted}
                  className="w-full accent-indigo-500 disabled:opacity-60"
                />
              </div>

              {/* Stream */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={streamEnabled}
                  onChange={(e) => setStreamEnabled(e.target.checked)}
                  disabled={isConversationStarted}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60"
                />
                <span className="text-sm text-slate-700">ストリーミング応答</span>
              </label>
            </div>
          </div>

          {/* Content Settings */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">コンテンツ設定</h3>

            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nsfwEnabled}
                  onChange={(e) => setNsfwEnabled(e.target.checked)}
                  disabled={isConversationStarted}
                  className="w-5 h-5 rounded border-slate-300 text-red-600 focus:ring-red-500 disabled:opacity-60"
                />
                <div>
                  <span className="text-sm text-slate-700 font-medium">NSFW許可</span>
                  <p className="text-xs text-slate-400">成人向けコンテンツフィルター解除</p>
                </div>
              </label>
            </div>
          </div>

          {/* Prompt Info */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">プロンプト情報</h3>
            {activePrompt && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">バージョン</span>
                  <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                    {activePrompt.version}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">説明</span>
                  <span className="text-xs text-slate-500">{activePrompt.description}</span>
                </div>
                <div className="pt-2 border-t border-slate-100 mt-2">
                  <p className="text-xs text-slate-400 line-clamp-3">{activePrompt.content.slice(0, 150)}...</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
