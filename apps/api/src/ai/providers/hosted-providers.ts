/**
 * The hosted providers a student can connect with their own API key.
 *
 * The base URLs are fixed here on purpose: letting users type an endpoint would let them
 * make this server send requests (with their key) to any address, including internal
 * services (SSRF). Adding a provider is a code change.
 */
export interface HostedProvider {
  id: string;
  label: string;
  /** 'anthropic' uses the Anthropic SDK; 'openai' any OpenAI-compatible Chat Completions API. */
  api: 'anthropic' | 'openai';
  baseURL?: string;
  /** Where the student creates a key. */
  keysUrl: string;
  /** Shown first in the model picker; any model the key can use is accepted. */
  suggestedModels: { id: string; note: string }[];
  /** Ask for JSON with response_format (true) or only in the prompt (false). */
  jsonMode: boolean;
  /** Newer OpenAI models take max_completion_tokens and only the default temperature. */
  openaiReasoningParams?: boolean;
}

export const HOSTED_PROVIDERS: readonly HostedProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    api: 'anthropic',
    keysUrl: 'https://platform.claude.com/settings/keys',
    suggestedModels: [
      { id: 'claude-haiku-5-5', note: 'fastest, lowest cost' },
      { id: 'claude-sonnet-5-5', note: 'balanced' },
      { id: 'claude-opus-5-5', note: 'most capable' },
    ],
    jsonMode: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseURL: 'https://api.openai.com/v1',
    keysUrl: 'https://platform.openai.com/api-keys',
    suggestedModels: [],
    jsonMode: true,
    openaiReasoningParams: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    api: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keysUrl: 'https://aistudio.google.com/apikey',
    suggestedModels: [],
    jsonMode: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    api: 'openai',
    baseURL: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    suggestedModels: [],
    jsonMode: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/keys',
    suggestedModels: [],
    jsonMode: false,
  },
];

export function findHostedProvider(id: string | null | undefined): HostedProvider | undefined {
  return HOSTED_PROVIDERS.find((p) => p.id === id);
}
