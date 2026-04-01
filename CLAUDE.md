# AZ-104 Trainer v2 — Claude Context

## What This Is
A single-file AI-powered exam trainer for the Microsoft AZ-104 (Azure Administrator) certification.
Live at: https://az-104trainer.netlify.app (Mallu848/AZ-104-Trainer-v2 on GitHub)

## File Structure
```
AZ-104-v2/
├── index.html                  ← entire app (HTML + CSS + JS, ~4000 lines, single file)
├── netlify.toml                ← points Netlify to functions folder
├── netlify/functions/claude.js ← API proxy (keeps ANTHROPIC_API_KEY server-side)
└── CLAUDE.md                   ← this file
```

## Tech Stack
- **Frontend**: Single-file HTML, all CSS and JS inline, no build step
- **Backend**: Netlify serverless function (`claude.js`) proxying Anthropic API
- **AI model**: `claude-haiku-4-5-20251001` — fast and cheap for question generation
- **Storage**: localStorage under `az104v2_` prefix
- **Deployment**: GitHub → Netlify auto-deploy on push to main

## Architecture: Key Constants & State

```javascript
const LS = 'az104v2_';                    // localStorage prefix
const MODEL = 'claude-haiku-4-5-20251001';
const API = '/.netlify/functions/claude';
const PASS_SCORE = 700;                   // Microsoft scaled score passing threshold
```

**State** (`state` object, persisted to localStorage):
- `domainPerf` — per-domain `{ correct, total, score }`, drives adaptive weighting
- `wrongLog` — array of missed questions with your answer vs correct
- `sessionHistory` — last 20 sessions
- `streak` / `lastStudyDate` — daily streak tracking

**Session state** (`session` object, not persisted):
- `questions`, `idx`, `answers`, `submitted`
- `lastApiCall` / `debounceMs` — prevents rapid re-calls

**Exam sim state** (`simState` object, not persisted):
- Separate from session, has its own `answers` dict and timer

## Question Schema (v2)

```json
{
  "type": "mc|yn|ms|dnd",
  "domain": "identity|storage|compute|networking|monitoring",
  "q": "question text",
  "opts": ["A","B","C","D"],
  "ans": 1,
  "pick": 2,
  "exp": "A: reason. B: CORRECT because... C: reason. D: reason.",
  "tip": "one-line memory trick",
  "ref": "2-5 word MS Learn search query"
}
```

## Critical Rules When Editing

### 504 Timeout Fix
`fetchQuestionsInBatches()` uses **BATCH_SIZE=4** — never increase this above 4-5.
Netlify functions time out at 26 seconds. 4 questions per call stays safely under that.
Must also reset `session.lastApiCall = 0` between batches or the debounce blocks them.

### Button Color Inheritance Bug
`button` elements do NOT inherit `color` from `body`. Always set `color: var(--txt)` explicitly
on button rules (`.ms-option` is the one that burned us — black text on dark background).

### CSS Scoping
`.filter-select` CSS must be **global** (not scoped to `#review`). The same class is used in
Configure Session and Exam Sim dropdowns.

### Score Counter
Two separate spans with separate color classes — NOT one span. Wrong answers = red, correct = green:
```html
<span class="q-score-correct">✓ <span id="q-correct-count">0</span></span>
<span class="q-score-wrong">✗ <span id="q-wrong-count">0</span></span>
```

### DND in Exam Sim
`renderSimQuestion()` must route `dnd` to `renderDNDSim()` — never let it fall through to `renderMCSim()`.
`renderDNDSim` has its own `initDNDSim(wrap, saveCallback)` that saves order to `simState.answers[qIdx]`.

### Explanation Cards
`parseOptionExplanations(exp, count)` parses the AI's "A: reason. B: reason." format into
individual entries, then renders green cards for correct options and red cards for wrong ones.

## AI Prompt Rules
The system prompt includes two critical blocks:

**CURRENT NAMING** — must use these names:
- Microsoft Entra ID (not "Azure AD")
- Microsoft Entra PIM (not "Azure AD PIM")
- Microsoft Defender for Cloud (not "Azure Security Center")
- Azure Monitor Agent / AMA (not "MMA" or "Log Analytics Agent")
- Microsoft Sentinel (not "Azure Sentinel")

**DEPRECATED** — never test these:
- Classic deployment model, Classic VMs/VNets/Storage
- OMS, MMA, Log Analytics Agent
- ADAL, Azure AD Graph API
- Azure Container Service (replaced by AKS)

## Domains & Weights
```
identity   22%  — Entra ID, RBAC, Policy, PIM, Conditional Access, Cost Mgmt
storage    17%  — Blob, Files, File Sync, SAS, AzCopy, Import/Export
compute    22%  — VMs, VMSS, App Service, ACI, ACR, AKS basics, ARM/Bicep
networking 17%  — VNet, NSG, UDR, Bastion, VPN, Load Balancer, DNS, Firewall
monitoring 12%  — Azure Monitor, AMA, Log Analytics, Backup, Site Recovery
```

## Validate JS Before Pushing
```bash
node -e "const fs=require('fs');const html=fs.readFileSync('index.html','utf8');const m=html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);try{new Function(m[1]);console.log('JS OK');}catch(e){console.error('JS ERROR:',e.message);process.exit(1);}"
```

## Deployment
- Push to `main` → Netlify auto-deploys in ~30 seconds
- `ANTHROPIC_API_KEY` is set in Netlify environment variables — never put it in code
- Netlify function timeout: 26 seconds (this is why BATCH_SIZE=4 is critical)
