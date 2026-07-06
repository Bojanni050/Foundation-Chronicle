# Chronicle Chat Sender (Chrome Extension)

A small Manifest V3 utility that scrapes the visible conversation on
**claude.ai**, **chatgpt.com**, or **gemini.google.com** and POSTs it to your
local Chronicle API server.

## Install (Load unpacked)

1. Start the local server first: from `/server`, run `npm install && npm start`.
   Copy the printed **token**.
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** and select this `extension/` folder
5. Click the Chronicle icon → paste the **Local API URL** (`http://127.0.0.1:4577`)
   and the **token**, then Save.

## Use

1. Open a conversation on Claude, ChatGPT, or Gemini.
2. Click the Chronicle extension icon → **Send this chat to Chronicle**.
3. The Chronicle web app polls the local server every few seconds and imports
   the chat automatically.

> Note: DOM selectors are best-effort per provider and may need updating if a
> provider changes its markup. There is no bundled icon.png; add one if desired
> or remove the `icons` block from `manifest.json`.
