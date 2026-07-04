# pxpipe-app

pxpipe-app is the desktop control panel for the pxpipe proxy. It is built with Electron, React, and Tailwind CSS to help you start a local proxy, inspect request telemetry, review image-compression results, and manage how Claude / Codex sessions connect to the proxy.

Chinese version: [README.zh-CN.md](./README.zh-CN.md)

pxpipe's core idea is to render large chunks of input context into compact PNG images so the model request uses fewer input tokens. pxpipe-app does not replace the core proxy; it gives you a much easier way to operate and observe it from a desktop UI.

![pxpipe-app screenshot](./image.png)

## Highlights

- **Proxy control**: start and stop the local pxpipe proxy and see the current listening URL.
- **Compression toggle**: enable or disable image compression at runtime without restarting the app.
- **Recent requests**: inspect request time, status, path, model, input, output, cache reads, and savings.
- **Token image inspector**: see which inputs were rendered as PNGs and read the source text behind each image.
- **Cost & pricing**: view estimated savings, cost breakdown, cache discounts, and projected value.
- **Session stats**: aggregate request counts, token savings, and project paths by session.
- **Model allowlist**: control which models are allowed to use image compression.
- **Legacy import**: import `~/.pxpipe/events.jsonl` into the app's SQLite database.
- **English / 中文 switch**: the UI supports both languages and persists your preference.

## How it works

pxpipe-app starts a local proxy on:

```text
http://127.0.0.1:47821
```

Claude Code, Codex, or other compatible API clients need to point their requests at that proxy explicitly. When a request arrives, the proxy decides whether the model, path, and input are a good fit for compression. Only eligible input blocks are rendered as PNG images; the rest stays as plain text.

Common content that gets compressed:

- large tool output;
- older conversation history;
- static context such as system prompts and tool docs.

Common content that usually stays text:

- the latest user request;
- model output;
- text that is too short or too sparse;
- models that are not on the allowlist;
- request shapes that do not support image input.

## Model compatibility and image quality

The main pxpipe project uses conservative defaults for model support. The default recommended image-enabled models are:

| Model | Default state | Image-context quality |
| --- | --- | --- |
| `claude-fable-5` | Enabled by default | Best validated result in the main project; default image reader on the Claude path. |
| `gpt-5.6` | Enabled by default | Default enabled GPT-path model and a good fit for image-based context. |
| `gpt-5.5` | Optional | The main project notes weaker performance on image-based history/context, so it is not enabled by default. |
| `claude-opus-4-7` / `claude-opus-4-8` | Optional | The main project reports image misreads risk; useful for experiments, not for the default path. |
| Other models | Plain text by default | They remain text unless added to the allowlist and accepted by the compression gate. |

Even if a model is on the allowlist, pxpipe will not always generate PNGs. It also checks block size, text density, and image-token cost. When image compression is actually cheaper, the request will show `image ×N` or `图片 ×N`.

If you selected `gpt-5.5` but Recent requests still shows `text`, that is usually the main project's conservative policy or the compression gate at work — not an app bug.

## Why ChatGPT does not use image compression

The ChatGPT web app or desktop app does not automatically route traffic through your local pxpipe proxy. pxpipe can only process requests that are explicitly pointed at it, such as Codex or an OpenAI API client configured with a local base URL:

```bash
OPENAI_BASE_URL=http://127.0.0.1:47821/v1 codex
```

So if you are chatting in chatgpt.com or the official ChatGPT app, the request usually never goes through pxpipe, which means no image compression.

Even when a request does pass through pxpipe, it still may stay text. The proxy checks the allowlist, the input size, and the cost tradeoff. If those checks do not pass, the request is forwarded as plain text.

## Quick start

### Install dependencies

```bash
pnpm install
```

The first install, or a switch between Electron versions, will rebuild the native `better-sqlite3` dependency. That can take a little while.

### Development

```bash
pnpm dev
```

After launch, click **Start** in the desktop app. Once the proxy is running, you can copy the Claude or Codex launch command from the UI.

### Production build

```bash
pnpm build
```

Platform packaging commands:

```bash
pnpm build:mac
pnpm build:win
pnpm build:linux
```

## Usage

### Start Claude

Click **Launch Claude** in pxpipe-app, or run it manually:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:47821 claude
```

### Start Codex

Click **Launch Codex** in pxpipe-app, or run it manually:

```bash
OPENAI_BASE_URL=http://127.0.0.1:47821/v1 codex
```

### Use an OpenAI API client

Point the client's base URL at the local proxy:

```text
http://127.0.0.1:47821/v1
```

If you want pxpipe-app to manage the upstream OpenAI key for you, fill in the OpenAI upstream and API key in the app settings. You can also let the caller provide the `Authorization` header directly.

## UI guide

### Status card

The top-right status card shows whether the proxy is running, the current proxy URL, the Start / Stop buttons, and the Compression toggle.

When Compression is off, requests still pass through the proxy, but inputs are no longer rendered as PNGs. That is useful for A/B comparisons or for isolating compression-related behavior.

### Launch through pxpipe

This area starts new Claude or Codex sessions. Existing terminal sessions do not automatically attach to pxpipe; they need to be restarted or pointed at the proxy base URL manually.

### Proxy verification

This section checks whether the proxy is listening and whether Claude / Codex traffic has recently passed through it. If it keeps showing no traffic, the client is probably not pointing at `http://127.0.0.1:47821`.

### Recent requests

This area shows recent requests. Rows marked with `image` / `图片` indicate that some input content was rendered into PNGs. Clicking one of those rows jumps to the Token image inspector below.

### Token image inspector

This area shows what was image-encoded in a request, including:

- the text baseline token count;
- the number of PNG images;
- the actual input token count;
- the image preview;
- the source text behind each image.

It is useful for verifying what was compressed and for debugging why a request did not produce images.

### Cost & pricing

This section estimates savings from the telemetry collected by the proxy. The result depends on model pricing, cache discounts, output tokens, and request shape, so treat it as an observation, not a promise.

### Proxy settings

Here you can change the listening address, upstream API, model allowlist, and auto-start options. The model allowlist decides which models are eligible for image compression; anything else stays text.

### Import legacy JSONL

If you used the command-line pxpipe before, you can import the old event log:

```text
~/.pxpipe/events.jsonl
```

After import, the app writes the history into SQLite and shows it in Recent requests, Sessions, and the telemetry cards.

## FAQ

### Why am I not seeing images?

Possible reasons:

- the client is not using the local proxy;
- Compression is turned off;
- the model is not on the allowlist;
- the input is too short to be worth compressing;
- the input is too sparse and image tokens would cost more than text;
- the request path is not one of the proxy-supported API shapes.

### Why are there no new requests in Recent requests?

First check that the proxy is running and that the client points at the local proxy URL:

```text
http://127.0.0.1:47821
```

Claude uses `ANTHROPIC_BASE_URL`; Codex and OpenAI API clients use `OPENAI_BASE_URL`.

### Can image compression change the model's answer?

Yes. Image compression is lossy, and it is not a good fit for byte-accurate content such as IDs, hashes, secrets, exact numbers, or names. pxpipe tries to preserve the latest request and the key text, but it cannot guarantee that every image is read verbatim.

If you need byte-level accuracy, turn off Compression or use a model that is not allowlisted so the request stays text.

### Why is GPT 5.5 still text after I selected it?

`gpt-5.5` is an optional model, not the main project's default image-reading model. If GPT 5.5 still shows as text, common reasons are:

- you need to click **Save settings**, then stop and restart the proxy so the allowlist updates in the current proxy instance;
- the actual request model name is not `gpt-5.5` or `gpt-5.5-*`;
- the input is too short or too sparse and does not pass the compression gate;
- Compression is turned off;
- the client is not using `OPENAI_BASE_URL=http://127.0.0.1:47821/v1`;
- you are using the ChatGPT web app or the official ChatGPT desktop app instead of a configurable API client.

The main project explicitly notes that GPT 5.5 performs worse on image-based context, so it is not silently imaged by default. pxpipe-app lets you add it to the allowlist, but it does not promise that every request will be turned into images.

### Can ChatGPT web use this?

Not directly. The ChatGPT web app and the official desktop app do not automatically send traffic through your local pxpipe proxy. pxpipe-app is aimed at Claude Code, Codex, and other API clients that can be configured with a base URL.

### Where is the language preference stored?

Language preference is stored together with the other app settings in the desktop app's SQLite database. Switching English / 中文 takes effect immediately and is restored the next time the app starts.

## Development commands

```bash
pnpm dev              # start development mode
pnpm typecheck        # TypeScript typecheck
pnpm lint             # ESLint
pnpm build            # build main, preload, and renderer
pnpm build:unpack     # build an unpacked app
pnpm build:mac        # macOS package
pnpm build:win        # Windows package
pnpm build:linux      # Linux package
```

## Project structure

```text
src/main/          Electron main process, SQLite, and proxy service wrapper
src/preload/       Preload API bridge
src/renderer/      React UI
src/shared/        Shared types between main and renderer
```

The core compression logic comes from the sibling `pxpipe` repository and is imported through the local `pxpipe-proxy` dependency:

```json
"pxpipe-proxy": "file:../pxpipe"
```
