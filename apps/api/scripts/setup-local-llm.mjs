// Pulls the local models and builds the `edu-chat` model from ollama/edu-chat.Modelfile.
// Requires Ollama (https://ollama.com) installed and running on http://localhost:11434.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const modelfile = fileURLToPath(new URL('../ollama/edu-chat.Modelfile', import.meta.url));
const run = (...args) => execFileSync('ollama', args, { stdio: 'inherit' });

try {
  run('pull', 'qwen2.5:7b');
  run('pull', 'nomic-embed-text');
  run('create', 'edu-chat', '-f', modelfile);
  console.log('\nLocal LLM ready: chat=edu-chat, embeddings=nomic-embed-text (768 dims).');
} catch (err) {
  console.error('Local LLM setup failed — is Ollama installed and running?', err.message);
  process.exit(1);
}
