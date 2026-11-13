// Pulls the local chat model and builds `edu-chat` from ollama/edu-chat.Modelfile.
// Requires Ollama (https://ollama.com) installed and running on http://localhost:11434.
// Embeddings need no setup: they run inside the API (EMBEDDING_PROVIDER=local).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelfile = fileURLToPath(new URL('../ollama/edu-chat.Modelfile', import.meta.url));
// The Windows installer adds Ollama to PATH only for new terminals.
const windowsInstall = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe');
const ollama = process.platform === 'win32' && existsSync(windowsInstall) ? windowsInstall : 'ollama';
const run = (...args) => execFileSync(ollama, args, { stdio: 'inherit' });

try {
  run('pull', 'qwen3:4b-instruct');
  run('create', 'edu-chat', '-f', modelfile);
  console.log('\nLocal LLM ready: LLM_CHAT_MODEL=edu-chat at http://127.0.0.1:11434/v1');
} catch (err) {
  console.error('Local LLM setup failed — is Ollama installed and running?', err.message);
  process.exit(1);
}
