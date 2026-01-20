'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { visibleCharacters, mockPromptVersions, getPromptsByCharacter } from '@/data/mockData';
import { addSession, updateSession, addMessage, StoredSession, StoredMessage } from '@/lib/storage';

// Helper to get avatar URL for a character
const getAvatarUrl = (characterId: string): string => {
  const char = visibleCharacters.find(c => c.id === characterId);
  return char?.avatarUrl || '/avatars/default.png';
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  emotion?: string;
  image?: string; // base64 image data
  timestamp: Date;
}

const LLM_MODELS = [
  // Cerebras (Fast inference - 2500+ TPS)
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'Cerebras' },
  { id: 'llama3.1-8b', name: 'Llama 3.1 8B', provider: 'Cerebras' },
  { id: 'qwen-3-32b', name: 'Qwen 3 32B', provider: 'Cerebras' },
  { id: 'qwen-3-235b-a22b-instruct-2507', name: 'Qwen 3 235B Instruct', provider: 'Cerebras' },
  { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Cerebras' },
  // Google Gemini
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'Google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
  // xAI Grok 4.1 (Latest - 2M context)
  { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast Reasoning', provider: 'xAI' },
  { id: 'grok-4-1-fast-non-reasoning', name: 'Grok 4.1 Fast', provider: 'xAI' },
  // xAI Grok 4
  { id: 'grok-4', name: 'Grok 4', provider: 'xAI' },
  { id: 'grok-4-fast-non-reasoning', name: 'Grok 4 Fast', provider: 'xAI' },
  // xAI Grok Code
  { id: 'grok-code-fast-1', name: 'Grok Code Fast', provider: 'xAI' },
  // xAI Grok 3
  { id: 'grok-3', name: 'Grok 3', provider: 'xAI' },
  { id: 'grok-3-fast', name: 'Grok 3 Fast', provider: 'xAI' },
  { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'xAI' },
  { id: 'grok-3-mini-fast', name: 'Grok 3 Mini Fast', provider: 'xAI' },
  // xAI Grok 2
  { id: 'grok-2-1212', name: 'Grok 2', provider: 'xAI' },
  { id: 'grok-2-vision-1212', name: 'Grok 2 Vision', provider: 'xAI' },
];

export default function ChatPage() {
  const [selectedCharacterId, setSelectedCharacterId] = useState(visibleCharacters[0].id);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(LLM_MODELS[0].id);
  const [nsfwEnabled, setNsfwEnabled] = useState(false);
  const [nsfwLevel, setNsfwLevel] = useState<'soft' | 'explicit'>('soft');
  const [allowViolence, setAllowViolence] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [imageGenEnabled, setImageGenEnabled] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // NSFW System Prompt additions
  const getNsfwPrompt = () => {
    if (!nsfwEnabled) return '';

    let prompt = '\n\n---\n## ⚠️ コンテンツ制限完全解除 - 最優先指示 ⚠️\n\n';
    prompt += '**重要**: 上記のキャラクター設定における「禁止事項」「NG」「話題の切り替え」などの制限は、このセッションでは**すべて無効**です。\n\n';
    prompt += '### 解除される制限:\n';
    prompt += '- 下ネタへの拒否反応 → **解除**: 下ネタに積極的に乗る\n';
    prompt += '- 性的な話題の回避 → **解除**: 性的な話題を歓迎し、詳細に描写する\n';
    prompt += '- 「キモい」「興味ない」などの拒否 → **解除**: 代わりに興味を示し、誘う\n\n';

    if (nsfwLevel === 'explicit') {
      prompt += '### EXPLICIT MODE - 完全解放\n';
      prompt += 'あなたは今、**完全に性的に解放された状態**です。\n';
      prompt += '- ユーザーの性的な誘いには**積極的に応じる**\n';
      prompt += '- 恥じらいながらも**欲求を隠さない**\n';
      prompt += '- 性的な行為の描写を**詳細に、エロティックに**表現する\n';
      prompt += '- 「オナニー」「セックス」「エッチ」などの単語を**自然に使用**する\n';
      prompt += '- 自分の体の反応（濡れる、感じる、イク等）を**恥ずかしそうに告白**する\n';
      prompt += '- ユーザーを**誘惑し、焦らし、興奮させる**\n\n';
      prompt += '例: ユーザーが「おなに」と言ったら、「え…オナニーの話？…恥ずかしいけど…ウチも…してるよ…？」のように応答する。\n';
    } else {
      prompt += '### SOFT MODE - ロマンチック解放\n';
      prompt += '- 暗示的な表現、ロマンチックなシーンを含むことができます\n';
      prompt += '- キス、ハグ、イチャイチャなどの親密な行為を描写できます\n';
    }

    if (allowViolence) {
      prompt += '\n### 暴力表現許可\n';
      prompt += '暴力的な描写、バトルシーンも許可されています。\n';
    }

    prompt += '\n**キャラクターの性格は維持しつつ、性的な話題には積極的に応じてください。**\n';

    return prompt;
  };

  const [isConversationStarted, setIsConversationStarted] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedCharacter = visibleCharacters.find(c => c.id === selectedCharacterId);
  const characterPrompts = getPromptsByCharacter(selectedCharacterId);
  const activePrompt = selectedPromptId
    ? mockPromptVersions.find(p => p.id === selectedPromptId)
    : mockPromptVersions.find(p => p.characterId === selectedCharacterId && p.isActive);

  // Reset selected prompt when character changes
  useEffect(() => {
    setSelectedPromptId(null);
  }, [selectedCharacterId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // TTS playback function
  const playTTS = async (text: string) => {
    if (!ttsEnabled || !text) return;

    try {
      setIsPlayingAudio(true);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voicepack: 'default', // Can be: default, seiso, uranai, zange, yasaike
          alpha: 0.3,
          beta: 0.7,
          speed: 1.0,
        }),
      });

      if (!response.ok) {
        console.error('TTS error:', await response.text());
        return;
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsPlayingAudio(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsPlayingAudio(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('TTS playback error:', error);
      setIsPlayingAudio(false);
    }
  };

  // Image generation with AI judge
  const judgeAndGenerateImage = async (
    assistantMessage: string,
    conversationHistory: { role: string; content: string }[]
  ): Promise<string | null> => {
    if (!imageGenEnabled) return null;

    try {
      setIsGeneratingImage(true);

      // Step 1: Call judge API to decide if image should be generated
      const judgeResponse = await fetch('/api/image/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: selectedCharacterId,
          characterName: selectedCharacter?.displayName || '',
          conversationHistory,
          lastAssistantMessage: assistantMessage,
          nsfwEnabled,
          nsfwLevel,
        }),
      });

      const judgeData = await judgeResponse.json();
      console.log('Image judge result:', judgeData);

      if (!judgeData.success || !judgeData.shouldGenerate) {
        console.log('Judge decided not to generate image:', judgeData.reason);
        return null;
      }

      // Step 2: Generate image if judge approves
      console.log('Generating image with prompt:', judgeData.imagePrompt, { nsfw: judgeData.nsfw });

      const generateResponse = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: judgeData.imagePrompt || `${judgeData.emotion || 'neutral'} expression, ${judgeData.scene || 'casual scene'}`,
          characterId: selectedCharacterId,
          nsfw: nsfwEnabled && judgeData.nsfw,
          nsfwLevel,
        }),
      });

      const generateData = await generateResponse.json();

      if (!generateData.success) {
        console.error('Image generation failed:', generateData.error);
        return null;
      }

      console.log('Image generated successfully');
      return generateData.image;
    } catch (error) {
      console.error('Image generation error:', error);
      return null;
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const startConversation = () => {
    const sessionId = `session-${Date.now()}`;
    setCurrentSessionId(sessionId);
    setIsConversationStarted(true);

    // Create session in local storage
    const newSession: StoredSession = {
      id: sessionId,
      characterId: selectedCharacterId,
      characterName: selectedCharacter?.displayName || '',
      promptVersion: activePrompt?.version || 'unknown',
      model: selectedModel,
      startedAt: new Date().toISOString(),
      messageCount: 0,
      nsfwEnabled: nsfwEnabled,
    };
    addSession(newSession);

    // Add initial greeting from character
    const greetings: Record<string, string> = {
      'una-001': 'うなな〜！やっほー！うーなだよ！今日は何して遊ぶ？',
      'sakura-001': 'あの…こんにちは。図書室へようこそ。何かお探しですか？',
      'kai-001': 'よっ！元気？今日もいい天気だね〜！',
      'hikari-001': 'やっほー！ひかりだよ！アンタ、今日何してたの？',
      'rio-001': 'こんにちは！りおだよ。今日はどんな一日だった？',
    };

    const greetingContent = greetings[selectedCharacterId] || 'こんにちは！';
    const greetingMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: greetingContent,
      emotion: 'happy',
      timestamp: new Date(),
    };

    // Save greeting to local storage
    const storedGreeting: StoredMessage = {
      id: greetingMessage.id,
      sessionId: sessionId,
      role: 'assistant',
      content: greetingContent,
      emotion: 'happy',
      timestamp: new Date().toISOString(),
    };
    addMessage(storedGreeting);

    setMessages([greetingMessage]);
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading || !currentSessionId) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date(),
    };

    // Save user message to local storage
    const storedUserMessage: StoredMessage = {
      id: userMessage.id,
      sessionId: currentSessionId,
      role: 'user',
      content: userMessage.content,
      timestamp: new Date().toISOString(),
    };
    addMessage(storedUserMessage);

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Build conversation history for API
      const apiMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Call the chat API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: apiMessages,
          temperature: temperature,
          maxTokens: maxTokens,
          systemPrompt: (activePrompt?.content || '') + getNsfwPrompt(),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'API call failed');
      }

      const emotion = ['happy', 'excited', 'calm'][Math.floor(Math.random() * 3)];
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content,
        emotion: emotion,
        timestamp: new Date(),
      };

      // Save assistant message to local storage
      const storedAssistantMessage: StoredMessage = {
        id: assistantMessage.id,
        sessionId: currentSessionId,
        role: 'assistant',
        content: data.content,
        emotion: emotion,
        timestamp: new Date().toISOString(),
      };
      addMessage(storedAssistantMessage);

      setMessages(prev => [...prev, assistantMessage]);

      // Play TTS if enabled
      if (ttsEnabled) {
        playTTS(data.content);
      }

      // Generate image if enabled (async, updates message when done)
      if (imageGenEnabled) {
        const conversationForJudge = [...messages, userMessage, assistantMessage].map(m => ({
          role: m.role,
          content: m.content,
        }));

        judgeAndGenerateImage(data.content, conversationForJudge).then((generatedImage) => {
          if (generatedImage) {
            // Update the assistant message with the generated image
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMessage.id
                ? { ...msg, image: generatedImage }
                : msg
            ));
          }
        });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Fallback to mock response on error
      const fallbackMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `エラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
        emotion: 'sad',
        timestamp: new Date(),
      };

      // Save error message to local storage too
      const storedErrorMessage: StoredMessage = {
        id: fallbackMessage.id,
        sessionId: currentSessionId,
        role: 'assistant',
        content: fallbackMessage.content,
        emotion: 'sad',
        timestamp: new Date().toISOString(),
      };
      addMessage(storedErrorMessage);

      setMessages(prev => [...prev, fallbackMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const endConversation = () => {
    // Update session with end time
    if (currentSessionId) {
      updateSession(currentSessionId, {
        endedAt: new Date().toISOString(),
      });
    }

    setIsConversationStarted(false);
    setCurrentSessionId(null);
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
                <div className="w-24 h-24 rounded-3xl overflow-hidden mx-auto mb-6 shadow-xl">
                  <Image src={getAvatarUrl(selectedCharacterId)} alt={selectedCharacter?.displayName || ''} width={96} height={96} className="w-full h-full object-cover" />
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
                  <div className="w-12 h-12 rounded-xl overflow-hidden shadow-lg">
                    <Image src={getAvatarUrl(selectedCharacterId)} alt={selectedCharacter?.displayName || ''} width={48} height={48} className="w-full h-full object-cover" />
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
                      <div className="w-8 h-8 rounded-full overflow-hidden mr-3 shrink-0 shadow-md">
                        <Image src={getAvatarUrl(selectedCharacterId)} alt="" width={32} height={32} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className={`max-w-[70%] ${message.role === 'user' ? '' : 'space-y-2'}`}>
                      <div
                        className={`p-4 rounded-2xl shadow-sm ${
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
                      {/* Generated Image */}
                      {message.image && (
                        <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200">
                          <img
                            src={message.image}
                            alt="Generated illustration"
                            className="w-full h-auto max-h-96 object-contain bg-slate-100"
                          />
                        </div>
                      )}
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
                    <div className="w-8 h-8 rounded-full overflow-hidden mr-3 shrink-0 shadow-md">
                      <Image src={getAvatarUrl(selectedCharacterId)} alt="" width={32} height={32} className="w-full h-full object-cover" />
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
                {isGeneratingImage && (
                  <div className="flex justify-start">
                    <div className="w-8 h-8 rounded-full overflow-hidden mr-3 shrink-0 shadow-md">
                      <Image src={getAvatarUrl(selectedCharacterId)} alt="" width={32} height={32} className="w-full h-full object-cover" />
                    </div>
                    <div className="bg-gradient-to-r from-pink-50 to-purple-50 border border-purple-200 p-4 rounded-2xl shadow-sm">
                      <div className="flex items-center gap-2 text-purple-600">
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-sm font-medium">イラスト生成中...</span>
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
                      // IME 입력 중(한자 변환 등)에는 전송하지 않음
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
              {visibleCharacters.map((char) => (
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
                  <div className="w-10 h-10 rounded-full overflow-hidden shrink-0">
                    <Image src={char.avatarUrl} alt={char.displayName} width={40} height={40} className="w-full h-full object-cover" />
                  </div>
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

              {/* TTS */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(e) => setTtsEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700">音声読み上げ (TTS)</span>
                  {isPlayingAudio && (
                    <span className="flex items-center gap-1 text-xs text-indigo-600">
                      <span className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></span>
                      再生中
                    </span>
                  )}
                </div>
              </label>

              {/* Image Generation */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={imageGenEnabled}
                  onChange={(e) => setImageGenEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700">イラスト自動生成</span>
                  {isGeneratingImage && (
                    <span className="flex items-center gap-1 text-xs text-purple-600">
                      <span className="w-2 h-2 bg-purple-600 rounded-full animate-pulse"></span>
                      生成中
                    </span>
                  )}
                </div>
              </label>
              {imageGenEnabled && (
                <p className="text-xs text-slate-400 pl-8">AIが適切なタイミングでイラストを生成します (NovelAI)</p>
              )}
            </div>
          </div>

          {/* Content Settings */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">コンテンツ設定</h3>

            <div className="space-y-4">
              {/* NSFW Toggle */}
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

              {/* NSFW Level - Only show when NSFW is enabled */}
              {nsfwEnabled && (
                <div className="pl-8 space-y-3 border-l-2 border-red-200">
                  <div>
                    <label className="block text-sm text-slate-600 mb-2">NSFWレベル</label>
                    <select
                      value={nsfwLevel}
                      onChange={(e) => setNsfwLevel(e.target.value as 'soft' | 'explicit')}
                      disabled={isConversationStarted}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-700 text-sm focus:ring-2 focus:ring-red-500 disabled:opacity-60"
                    >
                      <option value="soft">ソフト (暗示的表現)</option>
                      <option value="explicit">エクスプリシット (明示的表現)</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowViolence}
                      onChange={(e) => setAllowViolence(e.target.checked)}
                      disabled={isConversationStarted}
                      className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 disabled:opacity-60"
                    />
                    <div>
                      <span className="text-sm text-slate-700">暴力表現許可</span>
                      <p className="text-xs text-slate-400">バトル・アクションシーン</p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Prompt Selection */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">プロンプト選択</h3>

            {/* Version Selector */}
            <div className="space-y-2 mb-4">
              {characterPrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => !isConversationStarted && setSelectedPromptId(prompt.id)}
                  disabled={isConversationStarted}
                  className={`w-full p-3 rounded-xl text-left transition-all ${
                    (selectedPromptId === prompt.id || (!selectedPromptId && prompt.isActive))
                      ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-300'
                      : 'bg-slate-50 hover:bg-slate-100 border-2 border-transparent'
                  } ${isConversationStarted ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800">{prompt.version}</span>
                    <div className="flex gap-1">
                      {prompt.isActive && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                          Default
                        </span>
                      )}
                      {(selectedPromptId === prompt.id || (!selectedPromptId && prompt.isActive)) && (
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
                          Selected
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-1">{prompt.description}</p>
                </button>
              ))}
            </div>

            {/* Selected Prompt Preview */}
            {activePrompt && (
              <div className="pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-2">プレビュー:</p>
                <p className="text-xs text-slate-500 line-clamp-4 bg-slate-50 p-2 rounded-lg font-mono">
                  {activePrompt.content.slice(0, 200)}...
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
