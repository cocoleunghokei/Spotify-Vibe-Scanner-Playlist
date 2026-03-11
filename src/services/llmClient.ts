import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const PROXY_URL_RAW = process.env.LITELLM_PROXY_URL?.replace(/\/$/, '') ?? '';
// OpenAI SDK appends /chat/completions; many LiteLLM proxies expect /v1/chat/completions
const PROXY_URL = PROXY_URL_RAW && !PROXY_URL_RAW.endsWith('/v1')
  ? `${PROXY_URL_RAW}/v1`
  : PROXY_URL_RAW;
const PROXY_KEY = process.env.LITELLM_PROXY_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
// Set to "true" to bypass proxy and use direct Gemini (when proxy returns 404, etc.)
const USE_DIRECT_GEMINI = process.env.USE_DIRECT_GEMINI === 'true' || process.env.USE_DIRECT_GEMINI === '1';

let _openai: OpenAI | null = null;
let _gemini: GoogleGenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    if (!PROXY_URL || !PROXY_KEY) throw new Error('LITELLM_PROXY_URL and LITELLM_PROXY_API_KEY required');
    _openai = new OpenAI({ baseURL: PROXY_URL, apiKey: PROXY_KEY });
  }
  return _openai;
}

function getGeminiClient(): GoogleGenAI {
  if (!_gemini) {
    if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY required');
    _gemini = new GoogleGenAI({ apiKey: GEMINI_KEY });
  }
  return _gemini;
}

export function isProxyConfigured(): boolean {
  return !!(PROXY_URL && PROXY_KEY) && !USE_DIRECT_GEMINI;
}

export function isLlmConfigured(): boolean {
  return isProxyConfigured() || !!GEMINI_KEY;
}

export function getLlmMode(): 'proxy' | 'direct' {
  if (USE_DIRECT_GEMINI && GEMINI_KEY) return 'direct';
  return isProxyConfigured() ? 'proxy' : 'direct';
}

const PROXY_MODEL = 'gemini/gemini-2.5-flash';

export function getModelName(): string {
  return isProxyConfigured() ? PROXY_MODEL : 'gemini-2.0-flash';
}

export interface ImagePart {
  mimeType: string;
  data: string;
}

async function callDirectGeminiWithImages(
  images: ImagePart[],
  text: string,
  maxTokens: number,
  temperature: number,
  responseMimeType?: string
): Promise<string> {
  const client = getGeminiClient();
  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = images.map((img) => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }));
  parts.push({ text });
  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: responseMimeType ?? undefined,
      maxOutputTokens: maxTokens,
      temperature,
    },
  });
  return response.text?.trim() ?? '';
}

async function callDirectGeminiChat(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  responseMimeType?: string
): Promise<string> {
  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: responseMimeType ?? undefined,
      maxOutputTokens: maxTokens,
      temperature,
    },
  });
  return response.text?.trim() ?? '';
}

export async function chatWithImages(
  images: ImagePart[],
  text: string,
  options?: { responseMimeType?: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const maxTokens = options?.maxTokens ?? 500;
  const temperature = options?.temperature ?? 0.8;

  const doCall = async (): Promise<string> => {
    // #region agent log
    fetch('http://127.0.0.1:7536/ingest/69e8a2c0-63e2-4285-bb8c-a6b53689f553',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2bd3e8'},body:JSON.stringify({sessionId:'2bd3e8',location:'llmClient.ts:doCall-entry',message:'chatWithImages doCall entry',data:{isProxy:isProxyConfigured(),proxyModel:PROXY_MODEL,maxTokens,hasGeminiKey:!!GEMINI_KEY,imageCount:images.length},timestamp:Date.now(),hypothesisId:'H1,H3'})}).catch(()=>{});
    // #endregion
    if (isProxyConfigured()) {
      const client = getOpenAIClient();
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
      }));
      content.push({ type: 'text', text });
      // #region agent log
      fetch('http://127.0.0.1:7536/ingest/69e8a2c0-63e2-4285-bb8c-a6b53689f553',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2bd3e8'},body:JSON.stringify({sessionId:'2bd3e8',location:'llmClient.ts:proxy-call-start',message:'About to call proxy',data:{model:PROXY_MODEL,maxTokens},timestamp:Date.now(),hypothesisId:'H1,H2'})}).catch(()=>{});
      // #endregion
      const response = await client.chat.completions.create({
        model: PROXY_MODEL,
        messages: [{ role: 'user', content }],
        max_tokens: maxTokens,
        temperature,
        ...(options?.responseMimeType === 'application/json' && {
          response_format: { type: 'json_object' as const },
        }),
      });
      const raw = response.choices[0]?.message?.content as string | Array<{ type?: string; text?: string }> | null | undefined;
      // #region agent log
      fetch('http://127.0.0.1:7536/ingest/69e8a2c0-63e2-4285-bb8c-a6b53689f553',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2bd3e8'},body:JSON.stringify({sessionId:'2bd3e8',location:'llmClient.ts:proxy-response',message:'Proxy response received',data:{rawType:typeof raw,isNull:raw===null,isArray:Array.isArray(raw),preview:typeof raw==='string'?raw.slice(0,100):JSON.stringify(raw)?.slice(0,100),model:response.model,usage:response.usage},timestamp:Date.now(),hypothesisId:'H1,H2'})}).catch(()=>{});
      // #endregion
      let out = '';
      if (typeof raw === 'string') {
        out = raw.trim() ?? '';
      } else if (Array.isArray(raw)) {
        const texts = raw.filter((p) => p?.type === 'text').map((p) => p?.text ?? '').filter(Boolean);
        out = texts.join(' ').trim();
      }
      if (!out) {
        fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llmClient.ts:chatWithImagesEmpty',message:'Proxy returned empty',data:{choicesLen:response.choices?.length,contentType:typeof raw,isArray:Array.isArray(raw),rawPreview:JSON.stringify(raw).slice(0,300)},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
      }
      return out || '';
    }

    // #region agent log
    fetch('http://127.0.0.1:7536/ingest/69e8a2c0-63e2-4285-bb8c-a6b53689f553',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2bd3e8'},body:JSON.stringify({sessionId:'2bd3e8',location:'llmClient.ts:direct-gemini-path',message:'Taking DIRECT Gemini path (no proxy)',data:{model:'gemini-2.0-flash',maxTokens,imageCount:images.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    const client = getGeminiClient();
    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));
    parts.push({ text });
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: options?.responseMimeType ?? undefined,
        maxOutputTokens: maxTokens,
        temperature,
      },
    });
    const out = response.text?.trim() ?? '';
    if (!out) {
      fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llmClient.ts:chatWithImagesEmpty',message:'Direct Gemini returned empty',data:{textLen:response.text?.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    }
    return out;
  };

  let result = await doCall();
  if (!result) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await doCall();
  }
  // #region agent log
  if (!result && GEMINI_KEY && isProxyConfigured()) {
    fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llmClient.ts:chatWithImagesRetryFailed',message:'Proxy returned empty twice, will try direct Gemini fallback',data:{hasGeminiKey:!!GEMINI_KEY},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  }
  // #endregion
  if (!result && GEMINI_KEY && isProxyConfigured()) {
    const directResult = await callDirectGeminiWithImages(images, text, maxTokens, temperature, options?.responseMimeType);
    if (directResult) {
      fetch('http://127.0.0.1:7243/ingest/b6582ae1-0a13-456b-8a77-95ca8421cc62',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'llmClient.ts:chatWithImagesDirectFallbackOk',message:'Direct Gemini fallback succeeded',data:{len:directResult.length},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      return directResult;
    }
  }
  return result;
}

export async function chatText(
  systemPrompt: string,
  userMessage: string,
  options?: { responseMimeType?: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const maxTokens = options?.maxTokens ?? 300;
  const temperature = options?.temperature ?? 0.8;

  // #region agent log
  fetch('http://127.0.0.1:7536/ingest/69e8a2c0-63e2-4285-bb8c-a6b53689f553',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2bd3e8'},body:JSON.stringify({sessionId:'2bd3e8',location:'llmClient.ts:chatText-entry',message:'chatText entry',data:{isProxy:isProxyConfigured(),proxyModel:PROXY_MODEL,maxTokens},timestamp:Date.now(),hypothesisId:'H1,H3'})}).catch(()=>{});
  // #endregion
  if (isProxyConfigured()) {
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: PROXY_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature,
      ...(options?.responseMimeType === 'application/json' && {
        response_format: { type: 'json_object' as const },
      }),
    });
    const proxyOut = response.choices[0]?.message?.content?.trim() ?? '';
    if (!proxyOut && GEMINI_KEY) {
      const directOut = await callDirectGeminiChat(systemPrompt, userMessage, maxTokens, temperature, options?.responseMimeType);
      if (directOut) return directOut;
    }
    return proxyOut;
  }

  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: options?.responseMimeType ?? undefined,
      maxOutputTokens: maxTokens,
      temperature,
    },
  });
  return response.text?.trim() ?? '';
}
