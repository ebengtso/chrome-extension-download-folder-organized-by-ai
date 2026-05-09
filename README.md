# Download Domain Router + Local AI

A Manifest V3 Chrome extension that routes downloads into subfolders using:

1. A deterministic domain-to-folder registry.
2. Optional Chrome local AI / Gemini Nano classification for unmatched downloads.
3. Optional OpenAI API classification for unmatched downloads.
4. A configurable prompt template.

## What it does

- Watches downloads using `chrome.downloads.onDeterminingFilename`.
- Checks the source domain against your registry.
- If no rule matches and AI is enabled, classifies metadata using either:
  - Chrome local AI / Prompt API / Gemini Nano, or
  - OpenAI Responses API.
- OpenAI mode can optionally send file content when the original download URL can be fetched and the file is below the configured size limit.
- Chrome local AI mode uses metadata only in this version.
- Saves the file under a folder relative to Chrome's default Downloads folder.

Example:

```text
~/Downloads/Law/Cases/opinion.pdf
~/Downloads/Research/Doctrine/article.pdf
~/Downloads/IR/Articles/report.pdf
~/Downloads/To Review/unknown.pdf
```

## Important Chrome limitation

Chrome extensions cannot freely move downloads into arbitrary macOS folders using the downloads API. Suggested filenames must be relative to Chrome's default Downloads directory. For example, `Law/Cases/file.pdf` is allowed, but `/Users/you/Documents/Law/Cases/file.pdf` is not.

## Install locally

1. Unzip this folder.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the `download-domain-router-ai-local` folder.
7. Click the extension icon and choose **Open registry**.

## Chrome local AI setup

1. Open the extension options.
2. Set **AI provider** to **Chrome local AI / Gemini Nano**.
3. Click **Check Chrome local AI availability**.
4. If Chrome reports unavailable, your Chrome version/profile/device may not support the Prompt API yet, or the model may not be installed.
5. If it is downloadable/downloading, Chrome may download the local model. After it is ready, unmatched downloads can be classified locally.

## Prompt template

The prompt can be edited in the options page. Supported placeholders:

- `{{allowedFolders}}`
- `{{allowedFoldersJson}}`
- `{{defaultFolder}}`
- `{{metadataJson}}`
- `{{filename}}`
- `{{hostname}}`
- `{{url}}`
- `{{mime}}`
- `{{referrer}}`

Keep the instruction to return JSON with:

```json
{
  "folder": "Law/Cases",
  "confidence": 0.92,
  "reason": "Downloaded from a legal case source",
  "suggested_domain_rule": "example.com -> Law/Cases",
  "suggested_filename": "file.pdf"
}
```

## Privacy notes

- Registry rules are stored in `chrome.storage.local`.
- The OpenAI API key is stored locally if you use OpenAI mode. Do not publish or share the extension with your key inside it.
- Exported JSON deliberately omits the API key.
- Chrome local AI mode does not send data to OpenAI.
- OpenAI metadata-only mode sends URL/domain/filename/MIME/referrer.
- OpenAI file mode sends the file content when enabled and fetchable.


## Version 0.3 diagnostic changes

- AI is enabled by default with Chrome local AI as the provider.
- Recent routes now show whether AI was skipped, unavailable, low-confidence, or successful.
- Added an **Additional folders AI is allowed to choose** text area. Gemini/OpenAI cannot invent folders, so a shipping brochure can only route to a shipping folder if that folder is listed here or already appears in a domain rule.
- If AI returns below the confidence threshold, the route reason appears as `chrome-low-confidence` and the item goes to the default folder.
