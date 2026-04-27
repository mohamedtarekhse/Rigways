# AI Integration Guide - OpenRouter + MiniMax M2.5

## Overview

This guide explains how to integrate AI capabilities into the Rigways ERP system using **OpenRouter** and the **MiniMax M2.5 (Free)** model. The integration provides an intelligent chat assistant that helps users with asset management, certificate tracking, job scheduling, and compliance questions.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend UI   │────▶│  Cloudflare      │────▶│   OpenRouter    │
│  (ai-module.js) │     │  Worker API      │     │ (MiniMax M2.5)  │
│                 │◀────│  (_worker.js)    │◀────│   API           │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Components

1. **Frontend Module** (`ai-module.js`)
   - Chat widget UI
   - Conversation history management
   - Context-aware prompts

2. **Backend Handler** (`_worker.js`)
   - Secure API proxy
   - Authentication & authorization
   - OpenRouter API integration

3. **AI Provider** (OpenRouter)
   - MiniMax M2.5:free model (FREE tier)
   - Multi-language support (EN/AR)
   - Cost-effective pricing (FREE)

---

## Setup Instructions

### Step 1: Create OpenRouter Account

1. Visit [https://openrouter.ai](https://openrouter.ai)
2. Sign up for an account
3. Navigate to **API Keys** section
4. Create a new API key
5. Copy the key (format: `sk-or-...`)

### Step 2: Configure Worker Environment

Add the API key as a **secret** in your Cloudflare Worker:

```bash
# Using Wrangler CLI
wrangler secret put OPENROUTER_API_KEY
# Paste your API key when prompted
```

Or via Cloudflare Dashboard:
1. Go to Workers & Pages → rigways → Settings
2. Scroll to **Environment Variables**
3. Click **Add variable**
4. Set:
   - Variable name: `OPENROUTER_API_KEY`
   - Type: **Secret** (encrypted)
   - Value: Your OpenRouter API key

### Step 3: Include AI Module in HTML Pages

Add the script tag to your HTML pages (e.g., `assets.html`, `certificates.html`):

```html
<!-- Add before closing </body> tag -->
<script src="ai-module.js"></script>
```

The AI chat widget will automatically initialize on page load.

### Step 4: Deploy Changes

```bash
# Commit changes
git add .
git commit -m "feat: Add AI integration with OpenRouter MiniMax M2.5 (free)"

# Deploy to Cloudflare Pages
git push origin main
```

---

## Features

### 1. Chat Assistant

- **Floating Action Button**: Bottom-right corner of every page
- **Conversation History**: Maintained per browser session
- **Context Awareness**: Knows current page, user role, and selected items
- **Multi-language**: Supports English and Arabic

### 2. Smart Suggestions

The AI can help with:

- Certificate expiry analysis
- Asset maintenance recommendations
- Job scheduling optimization
- Compliance gap identification
- Report generation assistance

### 3. Example Queries

Users can ask:

```
- "Which certificates are expiring this month?"
- "What assets need maintenance soon?"
- "Generate a compliance report for Acme Corp"
- "How do I upload a new certificate?"
- "Show me pending jobs for technician John"
```

---

## API Endpoints

### POST `/api/ai/chat`

Send a message to the AI assistant.

**Request:**
```json
{
  "messages": [
    {"role": "system", "content": "You are an ERP assistant..."},
    {"role": "user", "content": "Which certificates expire soon?"}
  ],
  "model": "minimax/minimax-m2.5:free"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "response": "Based on your system, 3 certificates expire within 30 days...",
    "model": "minimax/minimax-m2.5:free",
    "usage": {
      "prompt_tokens": 150,
      "completion_tokens": 85,
      "total_tokens": 235
    },
    "timestamp": "2026-01-15T10:30:00Z"
  }
}
```

### GET `/api/ai/status`

Check AI configuration status.

**Response:**
```json
{
  "success": true,
  "data": {
    "configured": true,
    "model": "minimax/minimax-m2.5:free",
    "provider": "OpenRouter",
    "message": "AI is properly configured and ready to use."
  }
}
```

---

## Configuration Options

### Model Selection

Available models on OpenRouter:

| Model | ID | Best For |
|-------|-----|----------|
| MiniMax M2.5 | `minimax/minimax-m2.5:free` | **FREE tier**, general ERP tasks (default) |
| Qwen 3.5 Instruct | `qwen/qwen-3.5-instruct` | Advanced reasoning (~$0.04/1M tokens) |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | Complex reasoning |
| GPT-4o Mini | `openai/gpt-4o-mini` | Balanced performance |

To change the model, update `AI_CONFIG.MODEL` in `ai-module.js`:

```javascript
const AI_CONFIG = {
  MODEL: 'minimax/minimax-m2.5:free', // Change here
  // ...
};
```

### System Prompt Customization

Modify the AI's behavior by editing the system prompt:

```javascript
SYSTEM_PROMPT: `You are an intelligent ERP assistant for Rigways...
[Customize this text to match your business needs]`
```

### Response Parameters

Adjust in `handleAI()` function:

```javascript
max_tokens: 2048,      // Max response length
temperature: 0.7,      // Creativity (0.0-1.0)
```

---

## Security Considerations

### ✅ Implemented

1. **API Key Protection**: Key stored server-side, never exposed to client
2. **Authentication Required**: Only logged-in users can access AI
3. **Role-Based Access**: Respects existing user roles
4. **Input Validation**: Sanitizes all user inputs
5. **Error Handling**: Graceful degradation if AI fails

### 🔒 Best Practices

1. **Rate Limiting**: Consider adding request limits per user
2. **Usage Monitoring**: Track token consumption for cost control
3. **Data Privacy**: Avoid sending sensitive PII to AI
4. **Audit Logging**: Log AI interactions for compliance

---

## Cost Management

### OpenRouter Pricing (MiniMax M2.5)

- **FREE Tier**: $0.00 (limited requests per day)
- **Average query**: Free!
- **Rate Limits**: Check OpenRouter dashboard for current free tier limits

### Budget Tips

1. **Free Usage**: MiniMax M2.5 is completely free on OpenRouter
2. **Upgrade Path**: Switch to paid models only if you need advanced features
3. **Monitor Usage**: Track API calls in Worker logs
4. **Cache Responses**: Store common answers to reduce API calls

### Usage Tracking

Check token usage in Worker logs:

```
AI Usage - Tokens: 235, Model: minimax/minimax-m2.5:free
```

---

## Troubleshooting

### Issue: "AI not configured" error

**Solution:** Verify `OPENROUTER_API_KEY` is set:

```bash
wrangler secret list
# Should show OPENROUTER_API_KEY
```

### Issue: "Insufficient credits" error

**Solution:** Top up OpenRouter account:
1. Go to openrouter.ai
2. Navigate to Billing
3. Add credits (minimum $5)

### Issue: Slow responses

**Solutions:**
1. Free tier may have rate limits - consider upgrading to paid model if needed
2. Reduce `max_tokens` parameter
3. Check network connectivity to OpenRouter

### Issue: Widget not appearing

**Solutions:**
1. Verify `ai-module.js` is loaded (check browser DevTools → Network)
2. Clear browser cache
3. Check console for JavaScript errors

---

## Advanced Usage

### Programmatic Access

Use AI functions in your code:

```javascript
// Get smart suggestions
const suggestion = await AiClient.suggestAction('certificate_renewal', {
  expiry_date: '2026-02-15',
  cert_name: 'ISO 9001'
});

// Analyze data
const insights = await AiClient.analyzeData('certificates', certList);
```

### Custom Integrations

Extend AI capabilities:

```javascript
// Add custom task types
const prompts = {
  ...AiClient.prompts,
  safety_audit: `Conduct safety audit for ${data.location}...`
};
```

### Analytics Dashboard

Track AI usage metrics:

```sql
-- Example: Store interactions in database
CREATE TABLE ai_interactions (
  id UUID PRIMARY KEY,
  user_id UUID,
  prompt TEXT,
  response TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMP
);
```

---

## Support & Resources

- **OpenRouter Docs**: https://openrouter.ai/docs
- **Qwen Model Info**: https://huggingface.co/Qwen
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/
- **Issue Reporting**: Contact your system administrator

---

## Changelog

### v1.1.0 (2026-01-15)
- Switched to MiniMax M2.5:free model (FREE tier)
- Updated documentation for free tier usage
- Added cost management section for free models

### v1.0.0 (2026-01-15)
- Initial AI integration
- Qwen 3.5 Instruct model
- Chat widget UI
- Conversation history
- Multi-language support

---

**Note**: This integration now uses **MiniMax M2.5:free** which is completely free on OpenRouter. The modular design allows easy model upgrades to paid models when advanced features are needed.
