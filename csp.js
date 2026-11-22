// Content Security Policy of the app – the single list of places the app may talk to.
//
// The browser enforces it: even if the app's own code tried to reach any other server, the
// request would be refused before it leaves the browser. Only connect-src allows anything
// outside the app's own origin: Hugging Face, where the models are downloaded from (pinned
// revision, SHA-256 checked, see models/catalog.json), and the internal AI in the cantonal
// intranet (src/llm/intranet.js), reachable only from inside that network.
//
// Used by vite.config.js (as <meta> in index.html). firebase.json sends the same policy as
// HTTP header; tests/csp.test.js makes sure the two never drift apart.
export const CSP = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets the ONNX Runtime compile its WebAssembly; no JavaScript eval
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    'connect-src \'self\' https://huggingface.co https://*.huggingface.co https://*.hf.co https://aiacoder-v001.kt.lunet.ch',
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
].join('; ');
