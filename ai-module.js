/**
 * ================================================================
 *  AI Integration Module - OpenRouter + MiniMax M2.5
 *  For Rigways ERP System
 * ================================================================
 *  Features:
 *    - Chat assistant for ERP queries
 *    - Smart suggestions for certificates/assets
 *    - Auto-generation of descriptions/reports
 *    - Multi-language support (EN/AR)
 * ================================================================
 */

/* ================================================================
   AI CONFIGURATION
================================================================ */
const AI_CONFIG = {
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  MODEL: 'minimax/minimax-m2.5:free', // Free MiniMax M2.5 model
  MAX_TOKENS: 2048,
  TEMPERATURE: 0.7,
  SYSTEM_PROMPT: `You are an intelligent ERP assistant for Rigways Asset & Certificate Management System.
Your role is to help users with:
1. Asset management queries and recommendations
2. Certificate expiry tracking and compliance advice
3. Job scheduling and workflow optimization
4. Report generation and data analysis
5. General ERP navigation and usage guidance

Always be professional, concise, and helpful.
Support English language only.
When providing dates, use ISO format (YYYY-MM-DD).
For critical alerts (expired certs, safety issues), emphasize urgency.`,
};

/* ================================================================
   AI SESSION MANAGER
   Maintains conversation context per user session
================================================================ */
const AiSession = (() => {
  const STORAGE_KEY = 'sap_ai_conversation';
  let _history = [];

  function getHistory() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      _history = stored ? JSON.parse(stored) : [];
    } catch (e) {
      _history = [];
    }
    return _history;
  }

  function addMessage(role, content) {
    _history.push({ role, content, timestamp: Date.now() });
    // Keep last 20 messages to avoid token overflow
    if (_history.length > 20) {
      _history = _history.slice(-20);
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_history));
  }

  function clearHistory() {
    _history = [];
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function getContextMessages() {
    // Return formatted messages for API call
    return _history.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  return { getHistory, addMessage, clearHistory, getContextMessages };
})();

/* ================================================================
   AI API CLIENT
   Handles communication with OpenRouter API
================================================================ */
const AiClient = (() => {
  let _apiKey = null;

  /**
   * Initialize AI client with API key
   * Key should be stored securely in environment variables
   */
  function init(apiKey) {
    _apiKey = apiKey;
  }

  /**
   * Send message to AI and get response
   * @param {string} userMessage - User's input
   * @param {object} context - Optional ERP context data
   * @returns {Promise<string>} AI response
   */
  async function chat(userMessage, context = {}) {
    if (!_apiKey) {
      throw new Error('AI API key not configured. Please set OPENROUTER_API_KEY in Worker environment.');
    }

    // Add system context based on current ERP state
    const systemContext = buildSystemContext(context);
    
    // Get conversation history
    const messages = [
      { role: 'system', content: AI_CONFIG.SYSTEM_PROMPT + '\n\n' + systemContext },
      ...AiSession.getContextMessages(),
      { role: 'user', content: userMessage }
    ];

    try {
      // Call our Worker's AI endpoint (proxy to hide API key)
      const response = await apiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages, model: AI_CONFIG.MODEL })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'AI request failed');
      }

      const result = await response.json();
      
      // Store user message and AI response in history
      AiSession.addMessage('user', userMessage);
      AiSession.addMessage('assistant', result.response || result.message || 'No response received');

      return result.response || result.message || 'Sorry, I could not process your request.';
    } catch (error) {
      console.error('AI Chat Error:', error);
      throw error;
    }
  }

  /**
   * Build contextual information from current ERP state
   */
  function buildSystemContext(context) {
    const parts = [];
    
    if (context.currentUser) {
      parts.push(`Current User: ${context.currentUser.name} (${context.currentUser.role})`);
    }
    
    if (context.currentPage) {
      parts.push(`Current Page: ${context.currentPage}`);
    }
    
    if (context.selectedAsset) {
      parts.push(`Selected Asset: ${context.selectedAsset.name || context.selectedAsset.id}`);
    }
    
    if (context.selectedCertificate) {
      parts.push(`Selected Certificate: ${context.selectedCertificate.name || context.selectedCertificate.cert_number}`);
    }
    
    if (context.stats) {
      parts.push(`System Stats: ${JSON.stringify(context.stats)}`);
    }
    
    parts.push('User Language: English');

    return parts.length > 0 ? 'Context:\n' + parts.join('\n') : '';
  }

  /**
   * Quick helper for specific ERP tasks
   */
  async function suggestAction(taskType, data) {
    const prompts = {
      certificate_renewal: `This certificate expires on ${data.expiry_date}. Should we start renewal process? What documents are needed?`,
      asset_maintenance: `Asset ${data.asset_name} has been in operation for ${data.operating_hours} hours. Recommend maintenance schedule.`,
      report_generation: `Generate a summary report for ${data.report_type} covering period ${data.startDate} to ${data.endDate}.`,
      compliance_check: `Review compliance status for client ${data.client_name}. Any gaps or upcoming requirements?`
    };

    const prompt = prompts[taskType];
    if (!prompt) {
      throw new Error(`Unknown task type: ${taskType}`);
    }

    return await chat(prompt, { currentPage: taskType });
  }

  /**
   * Analyze ERP data and provide insights
   */
  async function analyzeData(dataType, data) {
    const analysisPrompts = {
      certificates: `Analyze these certificates and identify: 1) Expired items 2) Expiring within 30 days 3) Compliance gaps. Data: ${JSON.stringify(data)}`,
      assets: `Review asset portfolio and suggest: 1) Maintenance priorities 2) Replacement candidates 3) Cost optimization opportunities. Data: ${JSON.stringify(data)}`,
      jobs: `Optimize job scheduling based on: 1) Technician availability 2) Priority levels 3) Geographic locations. Data: ${JSON.stringify(data)}`
    };

    const prompt = analysisPrompts[dataType];
    if (!prompt) {
      throw new Error(`Unknown data type: ${dataType}`);
    }

    return await chat(prompt, { currentPage: `analysis_${dataType}` });
  }

  return { init, chat, suggestAction, analyzeData };
})();

/* ================================================================
   AI UI COMPONENTS
   Chat widget, floating button, message display
================================================================ */
const AiUI = (() => {
  let _isOpen = false;
  let _isLoading = false;
  let _chatContainer = null;

  /**
   * Initialize AI chat widget
   */
  function init() {
    createChatWidget();
    bindEvents();
  }

  /**
   * Create floating chat button and chat window
   */
  function createChatWidget() {
    // Floating action button
    const fab = document.createElement('button');
    fab.id = 'aiChatFab';
    fab.className = 'ai-chat-fab';
    fab.setAttribute('aria-label', 'Open AI Assistant');
    fab.innerHTML = `
      <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    `;
    document.body.appendChild(fab);

    // Chat container
    const chat = document.createElement('div');
    chat.id = 'aiChatContainer';
    chat.className = 'ai-chat-container';
    chat.style.display = 'none';
    chat.innerHTML = `
      <div class="ai-chat-header">
        <div class="ai-chat-title">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>AI Assistant</span>
        </div>
        <button class="ai-chat-close" aria-label="Close chat">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="ai-chat-messages" id="aiChatMessages"></div>
      <div class="ai-chat-input-area">
        <textarea 
          id="aiChatInput" 
          placeholder="Ask about assets, certificates, jobs..." 
          rows="2"
          aria-label="Type your message"
        ></textarea>
        <button id="aiChatSend" class="ai-chat-send" aria-label="Send message">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    `;
    document.body.appendChild(chat);
    _chatContainer = chat;

    // Add styles
    addStyles();
  }

  /**
   * Add CSS styles for chat widget
   */
  function addStyles() {
    const style = document.createElement('style');
    style.id = 'aiChatStyles';
    style.textContent = `
      .ai-chat-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        cursor: pointer;
        z-index: 9999;
        transition: transform 0.2s, box-shadow 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ai-chat-fab:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
      }
      .ai-chat-container {
        position: fixed;
        bottom: 90px;
        right: 24px;
        width: 380px;
        max-width: calc(100vw - 48px);
        height: 500px;
        max-height: calc(100vh - 120px);
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #e2e8f0;
      }
      .ai-chat-header {
        padding: 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .ai-chat-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 16px;
      }
      .ai-chat-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ai-chat-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .ai-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #f8fafc;
      }
      .ai-message {
        max-width: 85%;
        padding: 12px 16px;
        border-radius: 12px;
        line-height: 1.5;
        font-size: 14px;
        animation: messageSlide 0.3s ease-out;
      }
      @keyframes messageSlide {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .ai-message.user {
        align-self: flex-end;
        background: #667eea;
        color: white;
        border-bottom-right-radius: 4px;
      }
      .ai-message.assistant {
        align-self: flex-start;
        background: white;
        color: #1e293b;
        border: 1px solid #e2e8f0;
        border-bottom-left-radius: 4px;
      }
      .ai-message.error {
        background: #fee2e2;
        color: #dc2626;
        border: 1px solid #fecaca;
      }
      .ai-chat-input-area {
        padding: 16px;
        background: white;
        border-top: 1px solid #e2e8f0;
        display: flex;
        gap: 8px;
      }
      #aiChatInput {
        flex: 1;
        resize: none;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 12px;
        font-family: inherit;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      }
      #aiChatInput:focus {
        border-color: #667eea;
      }
      .ai-chat-send {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        background: #667eea;
        color: white;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      .ai-chat-send:hover {
        background: #5568d3;
      }
      .ai-chat-send:disabled {
        background: #cbd5e1;
        cursor: not-allowed;
      }
      .ai-typing-indicator {
        display: flex;
        gap: 4px;
        padding: 12px 16px;
        align-self: flex-start;
      }
      .ai-typing-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #94a3b8;
        animation: typingBounce 1.4s infinite;
      }
      .ai-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .ai-typing-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typingBounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-8px); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Bind event listeners
   */
  function bindEvents() {
    const fab = document.getElementById('aiChatFab');
    const closeBtn = document.querySelector('.ai-chat-close');
    const sendBtn = document.getElementById('aiChatSend');
    const input = document.getElementById('aiChatInput');

    fab.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);
    
    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  /**
   * Toggle chat visibility
   */
  function toggleChat() {
    _isOpen = !_isOpen;
    const chat = document.getElementById('aiChatContainer');
    const fab = document.getElementById('aiChatFab');
    
    if (chat) {
      chat.style.display = _isOpen ? 'flex' : 'none';
    }
    
    if (_isOpen) {
      fab.style.opacity = '0';
      setTimeout(() => {
        const messagesEl = document.getElementById('aiChatMessages');
        if (messagesEl && messagesEl.children.length === 0) {
          loadHistory();
        }
        focusInput();
      }, 200);
    } else {
      fab.style.opacity = '1';
    }
  }

  /**
   * Load conversation history into UI
   */
  function loadHistory() {
    const history = AiSession.getHistory();
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;

    messagesEl.innerHTML = '';
    
    if (history.length === 0) {
      // Welcome message
      appendMessage('assistant', 'Hello! I\'m your AI assistant. How can I help you with your ERP system today? You can ask about assets, certificates, jobs, or any compliance questions.');
    } else {
      history.forEach(msg => {
        appendMessage(msg.role, msg.content, false);
      });
    }
  }

  /**
   * Send message to AI
   */
  async function sendMessage() {
    const input = document.getElementById('aiChatInput');
    const message = input.value.trim();
    
    if (!message || _isLoading) return;

    // Clear input and show user message
    input.value = '';
    appendMessage('user', message);
    
    // Show typing indicator
    showTypingIndicator();
    _isLoading = true;
    updateSendButton();

    try {
      // Get current context
      const session = SapSession?.get?.();
      const context = {
        currentUser: session ? { name: session.name, role: session.role } : null,
        currentPage: getCurrentPageName(),
        language: SapLang?.current?.() || 'en'
      };

      // Send to AI
      const response = await AiClient.chat(message, context);
      
      // Remove typing indicator and show response
      removeTypingIndicator();
      appendMessage('assistant', response);
    } catch (error) {
      removeTypingIndicator();
      appendMessage('error', `Error: ${error.message}. Please ensure the AI API key is configured.`);
    } finally {
      _isLoading = false;
      updateSendButton();
      focusInput();
    }
  }

  /**
   * Append message to chat UI
   */
  function appendMessage(role, content, animate = true) {
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `ai-message ${role}`;
    msgDiv.textContent = content;
    
    messagesEl.appendChild(msgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /**
   * Show typing indicator
   */
  function showTypingIndicator() {
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;

    const typing = document.createElement('div');
    typing.id = 'aiTypingIndicator';
    typing.className = 'ai-typing-indicator';
    typing.innerHTML = `
      <div class="ai-typing-dot"></div>
      <div class="ai-typing-dot"></div>
      <div class="ai-typing-dot"></div>
    `;
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /**
   * Remove typing indicator
   */
  function removeTypingIndicator() {
    const typing = document.getElementById('aiTypingIndicator');
    if (typing) typing.remove();
  }

  /**
   * Update send button state
   */
  function updateSendButton() {
    const sendBtn = document.getElementById('aiChatSend');
    if (sendBtn) {
      sendBtn.disabled = _isLoading;
    }
  }

  /**
   * Focus input field
   */
  function focusInput() {
    const input = document.getElementById('aiChatInput');
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }

  /**
   * Get current page name for context
   */
  function getCurrentPageName() {
    const path = window.location.pathname.split('/').pop() || 'assets.html';
    const pageNames = {
      'assets.html': 'Assets Management',
      'certificates.html': 'Certificates Management',
      'jobs.html': 'Jobs & Work Orders',
      'files.html': 'Files Repository',
      'notifications.html': 'Notifications Center',
      'dashboard.html': 'Admin Dashboard',
      'clients.html': 'Client Management',
      'functional-locations.html': 'Functional Locations',
      'inspectors.html': 'Inspectors Directory',
      'reports.html': 'Reports & Analytics'
    };
    return pageNames[path] || 'Unknown Page';
  }

  return { init, toggleChat, sendMessage };
})();

/* ================================================================
   AUTO-INITIALIZATION
================================================================ */
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Initialize AI UI components
    AiUI.init();
    
    // Log initialization
    console.log('🤖 AI Assistant initialized with Qwen 3.5 via OpenRouter');
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AI_CONFIG, AiSession, AiClient, AiUI };
}
