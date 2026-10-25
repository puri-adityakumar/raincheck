# AI tooling scripts

Status: **BLOCKED**. Nothing in this directory contacts Tinker, trains a model, evaluates a paid model, or reports a benchmark. This is a safe skeleton for the authorized AI worker.

## Why blocked

- No Tinker credential is present or authorised.
- The current sampling API was verified against the public Tinker 0.34.0 reference and the adapter has offline tests. Live access, model behavior, account pricing/spend, and training have not been tested.
- `AI_PROVIDER` is `none`; the API returns a typed `ai_unavailable` error.
- Sending the app's private prompt/draft context to a paid provider requires explicit human authorization, not just a key in the environment.

## Guard rails

1. `prepare_dataset.py` validates a provisional chat JSONL file. No network; no write unless `--write`.
2. `train_lora.py` defaults to a dry run. `--execute` still refuses unless `RAINCHECK_ALLOW_PAID_TRAINING=1`, `TINKER_API_KEY`, and `TINKER_MODEL` are set; even then it exits 3 because training execution is not implemented.
3. `evaluate.py` computes simple counts over a local predictions file. It is not a benchmark and makes no quality claim.
4. `tinker_config.py` never prints the API key and refuses when the explicit gate is closed.

## Before any real run

- Read the verified API sources and remaining limitations in `../public-docs/tinker-notes.md`.
- Build a small, consented/synthetic evaluation set. No real people, private messages, or medical details.
- Review the implemented prompt and output checks in `../backend/app/services/generation/service.py` and their limitations in `../public-docs/tinker-notes.md`.
- The inference adapter is implemented behind `AI_PROVIDER=tinker` and the separate `TINKER_ALLOW_PAID_INFERENCE` gate. Install `../requirements-tinker.txt` only after authorization; keep all gates off for offline checks.
- Get explicit authorization for spend and data use from the user.
- Run one small job, record the real cost/result in a run artifact, and update `ai_generation` only when inference really works.

Do not invent model names, benchmark numbers, or prices.
