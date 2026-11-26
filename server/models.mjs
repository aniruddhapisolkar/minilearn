import { createHash, randomUUID } from 'node:crypto';
import { AppError, requiredText } from './storage.mjs';

const PROVIDERS = {
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  google: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta',
  },
  opencode: {
    name: 'OpenCode (pay-as-you-go)',
    url: 'https://opencode.ai/inference',
  },
  'opencode-go': {
    name: 'OpenCode Go',
    url: 'https://opencode.ai/inference/go',
  },
  custom: { name: 'OpenAI-compatible', url: 'http://localhost:11434/v1' },
};
export const providerNames = Object.fromEntries(
  Object.entries(PROVIDERS).map(([key, p]) => [key, p.name]),
);

export function normalizeConnection(input, previous = null, needModel = true) {
  if (!input || !Object.hasOwn(PROVIDERS, input.provider))
    throw new AppError('Choose a supported provider.');
  const provider = input.provider;
  const rawKey = input.apiKey === undefined ? previous?.apiKey : input.apiKey;
  const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (apiKey.length > 12000 || /[\r\n]/.test(apiKey))
    throw new AppError('Invalid API key.');
  if (provider !== 'custom' && !apiKey)
    throw new AppError('Enter your API key.');
  let baseUrl = PROVIDERS[provider].url;
  if (provider === 'custom') {
    try {
      const url = new URL(input.baseUrl?.trim() || baseUrl);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error();
      if (url.pathname === '/') url.pathname = '/v1';
      baseUrl = url.href.replace(/\/+$/, '');
    } catch {
      throw new AppError(
        'Enter a valid HTTP or HTTPS API base URL, such as http://localhost:11434/v1.',
      );
    }
  }
  const model = needModel ? requiredText(input.model, 'Model', 300) : '';
  return {
    id: previous?.id || randomUUID(),
    provider,
    label:
      typeof input.label === 'string' && input.label.trim()
        ? input.label.trim().slice(0, 100)
        : PROVIDERS[provider].name,
    apiKey,
    baseUrl,
    model,
  };
}
export function publicConnection(c) {
  const { apiKey, ...safe } = c;
  return { ...safe, hasKey: Boolean(apiKey) };
}
export function getConnections(storage) {
  const s = storage.settings();
  return {
    activeConnection: s.activeConnection,
    connections: s.connections.map(publicConnection),
    providers: providerNames,
  };
}
export function selectedConnection(storage) {
  const s = storage.settings();
  const c = s.connections.find((c) => c.id === s.activeConnection);
  if (!c)
    throw new AppError(
      'Connect an AI model in Settings before continuing.',
      409,
    );
  return c;
}
function nativeOpenCode(c) {
  return c.provider === 'opencode' || c.provider === 'opencode-go';
}
function isOpenCode(c) {
  // Also support existing custom connections to documented OpenCode URLs.
  // Never attach OpenCode-specific routing data to unrelated custom hosts.
  return (
    nativeOpenCode(c) ||
    (c.provider === 'custom' &&
      /^https:\/\/opencode\.ai\/(?:zen(?:\/go)?\/v1|inference(?:\/go)?\/openai\/v1)$/.test(
        c.baseUrl,
      ))
  );
}
function requestHeaders(c, conversationId) {
  const h = { 'content-type': 'application/json' };
  if (c.provider === 'anthropic') {
    h['x-api-key'] = c.apiKey;
    h['anthropic-version'] = '2023-06-01';
  } else if (c.provider === 'google') h['x-goog-api-key'] = c.apiKey;
  else if (c.apiKey) h.authorization = `Bearer ${c.apiKey}`;
  if (isOpenCode(c)) {
    h['user-agent'] = 'minilearn/0.1.0';
    // Opaque, stable within this connection and conversation; no learner data
    // or raw project identifiers need to be sent as routing metadata.
    h['x-opencode-session'] = `ses_${createHash('sha256')
      .update(JSON.stringify([c.id, conversationId ?? randomUUID()]))
      .digest('hex')}`;
  }
  return h;
}
async function request(
  c,
  endpoint,
  { body, signal, conversationId, timeout = 120000 } = {},
) {
  let response;
  try {
    const effective = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    response = await fetch(c.baseUrl + endpoint, {
      method: body ? 'POST' : 'GET',
      headers: requestHeaders(c, conversationId),
      body: body ? JSON.stringify(body) : undefined,
      signal: effective,
      redirect: 'error',
    });
  } catch (error) {
    if (signal?.aborted) throw new AppError('Generation cancelled.', 499);
    throw new AppError(
      error.name === 'TimeoutError'
        ? 'The model did not respond in time.'
        : 'Could not reach the provider. Check the API URL, key, and network connection.',
      502,
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    if (signal?.aborted) throw new AppError('Generation cancelled.', 499);
    throw new AppError(
      `The provider returned an unexpected response (${response.status}).`,
      502,
    );
  }
  if (!response.ok) {
    let message = String(
      result.error?.message ||
        result.message ||
        `Provider returned HTTP ${response.status}.`,
    );
    if (c.apiKey) message = message.split(c.apiKey).join('[redacted]');
    throw new AppError(message.slice(0, 600), 502);
  }
  return result;
}
export async function discoverModels(connection, signal) {
  let data;
  if (connection.provider === 'google') {
    data = await request(connection, '/models?pageSize=100', {
      signal,
      timeout: 20000,
    });
    return (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        name: m.displayName || m.name,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  data = await request(
    connection,
    nativeOpenCode(connection)
      ? '/v1/models'
      : connection.provider === 'anthropic'
        ? '/models?limit=100'
        : '/models',
    { signal, timeout: 20000 },
  );
  return (data.data || [])
    .filter(
      (m) =>
        typeof m.id === 'string' &&
        (!nativeOpenCode(connection) || !m.type || m.type === 'chat') &&
        !/embedding|moderation|whisper|^tts|dall-e|^gpt-image|audio|realtime|rerank/i.test(
          m.id,
        ),
    )
    .map((m) => ({
      id: m.id,
      name: m.display_name || (nativeOpenCode(connection) && m.name) || m.id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Provider-neutral messages. Binary references are explicitly selected by the learner.
function openAIContent(message) {
  if (!message.attachments?.length) return message.content;
  return [
    { type: 'text', text: message.content },
    ...message.attachments.map((f) => {
      const data = `data:${f.mime};base64,${f.data}`;
      if (f.mime === 'application/pdf')
        return { type: 'file', file: { filename: f.name, file_data: data } };
      return { type: 'image_url', image_url: { url: data } };
    }),
  ];
}
function anthropicContent(message) {
  if (!message.attachments?.length) return message.content;
  return [
    { type: 'text', text: message.content },
    ...message.attachments.map((f) => ({
      type: f.mime === 'application/pdf' ? 'document' : 'image',
      source: { type: 'base64', media_type: f.mime, data: f.data },
    })),
  ];
}
function geminiContent(message) {
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [
      { text: message.content },
      ...(message.attachments || []).map((f) => ({
        inlineData: { mimeType: f.mime, data: f.data },
      })),
    ],
  };
}

export async function generate(
  connection,
  system,
  messages,
  { signal, test = false, conversationId } = {},
) {
  const model = connection.model;
  let answer;
  if (connection.provider === 'anthropic') {
    const result = await request(connection, '/messages', {
      signal,
      body: {
        model,
        system,
        max_tokens: test ? 128 : 8192,
        messages: messages.map((m) => ({
          role: m.role,
          content: anthropicContent(m),
        })),
      },
    });
    answer = result.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  } else if (connection.provider === 'google') {
    const result = await request(
      connection,
      `/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
      {
        signal,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(geminiContent),
          generationConfig: { maxOutputTokens: test ? 512 : 8192 },
        },
      },
    );
    answer = result.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  } else {
    const endpoint = nativeOpenCode(connection)
      ? '/openai/v1/chat/completions'
      : '/chat/completions';
    const result = await request(connection, endpoint, {
      signal,
      conversationId,
      body: {
        model,
        messages: [
          { role: 'system', content: system },
          ...messages.map((m) => ({ role: m.role, content: openAIContent(m) })),
        ],
        ...(test
          ? connection.provider === 'openai'
            ? { max_completion_tokens: 512 }
            : { max_tokens: isOpenCode(connection) ? 1024 : 128 }
          : {}),
      },
    });
    const content = result.choices?.[0]?.message?.content;
    answer = Array.isArray(content)
      ? content
          .filter((p) => typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n')
      : content;
  }
  if (typeof answer !== 'string' || !answer.trim())
    throw new AppError(
      'The model returned an empty response. Check that the selected model supports text generation.',
      502,
    );
  return answer.trim();
}

export async function connect(storage, input, signal) {
  const settings = storage.settings();
  const previous = input.id
    ? settings.connections.find((c) => c.id === input.id)
    : null;
  if (input.id && !previous) throw new AppError('Connection not found.', 404);
  const c = normalizeConnection(input, previous);
  if (input.test !== false)
    await generate(
      c,
      'You are testing a connection. Reply with OK.',
      [{ role: 'user', content: 'Say OK.' }],
      { signal, test: true },
    );
  // Reread after the network request in case another connection was changed.
  const fresh = storage.settings();
  storage.saveSettings({
    connections: [...fresh.connections.filter((v) => v.id !== c.id), c],
    activeConnection: c.id,
  });
  return publicConnection(c);
}

export function activateConnection(storage, connectionId) {
  const settings = storage.settings();
  if (!settings.connections.some((c) => c.id === connectionId))
    throw new AppError('Connection not found.', 404);
  storage.saveSettings({ ...settings, activeConnection: connectionId });
  return getConnections(storage);
}
export function deleteConnection(storage, connectionId) {
  const settings = storage.settings();
  const connections = settings.connections.filter((c) => c.id !== connectionId);
  storage.saveSettings({
    connections,
    activeConnection:
      settings.activeConnection === connectionId
        ? connections[0]?.id || null
        : settings.activeConnection,
  });
  return getConnections(storage);
}
