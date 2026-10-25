# Tinker integration

Status: **adapter implemented and checked offline; live inference, training, and quality evaluation remain blocked**. No paid model was called. No training, benchmark improvement, cost, or model-quality result is claimed.

## Public API verified, 2026-10-25

- [ServiceClient reference](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/serviceclient/index.md) and [SamplingClient reference](https://tinker-docs.thinkingmachines.ai/tinker/api-reference/samplingclient/index.md) are generated from **Tinker 0.34.0**, commit `64eef5e00c4dc4f55ef6521e14defde58c891c52`.
- [Official quickstart](https://tinker-docs.thinkingmachines.ai/tinker/quickstart/index.md) documents asynchronous sampling, model chat templates with thinking disabled, token decoding, and saved `tinker://` sampler paths.
- [Current models](https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/) include `Qwen/Qwen3-8B`, `Qwen/Qwen3.5-4B`, and `Qwen/Qwen3.5-9B`. These are the adapter's explicitly supported chat models; no default model is selected.
- [RetryConfig source](https://github.com/thinking-machines-lab/tinker/blob/64eef5e00c4dc4f55ef6521e14defde58c891c52/src/tinker/lib/retry_handler.py) documents the sampler retry switch used by the adapter.

These are public-document checks, not evidence that this account can access a model or that live inference works. `requirements-tinker.txt` pins the optional SDK; normal app installation does not install or contact it.

## Implemented boundary

`backend/app/services/generation/service.py` exposes `generate_draft` and `generator_ready`.

- Default provider is `none`. A key alone never activates inference: explicit `TINKER_ALLOW_PAID_INFERENCE=true`, the Tinker provider, credentials, a supported model, and the pinned SDK must all be present.
- SDK import and client creation occur only after all gates pass. Ambient `TINKER_BASE_URL` overrides are rejected. Credentials are supplied directly, never returned or logged.
- At most two in-flight generations per process, one sample, 256 output tokens, a 4,096-token input bound, a 25-second application timeout, and disabled sampler retry logic. Session cleanup is bounded.
- Prompt fields are JSON data, not system instructions; proofs and unrecognized top-level fields are not forwarded. Only backend-verified weather summaries may be quoted.
- Medical excuses, explicit availability claims, markup/reasoning blocks, empty/truncated output, and ungrounded weather are rejected. These are conservative heuristic checks, **not a proven semantic safety guarantee**. Every result still requires human review.
- No sample inference, provider fallback, prompt persistence, or output logging.

The offline tests use explicit SDK doubles. They check gate closure, prompt separation, output validation, token/request caps, no sampler retry, timeout translation, and cleanup. They do not measure real model behavior.

## Before any live AI use

Obtain fresh credentials privately, explicit authorization for spending and data use, and a provider-side budget. Only then install the optional requirements in the backend environment and configure the gates. Keep them disabled in this run. Application timeouts and token caps are **not a dollar spending guarantee**, and a timed-out remote job may continue.

The guarded training entry point still refuses paid execution, even after its preliminary environment gates. `prepare_dataset.py` validates a local chat JSONL interchange format; a real trainer must convert it to tokenized Tinker `Datum` objects with assistant-only loss weights. `evaluate.py` counts local prediction heuristics only, not model quality or improvement over a baseline. A consented/synthetic training set, disjoint held-out set, authorized training run, and measured baseline comparison remain outstanding.

Never paste secrets into chat, source, logs, tests, or Git.
