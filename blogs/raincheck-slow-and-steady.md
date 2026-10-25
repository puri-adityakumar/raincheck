---
title: "Raincheck: the lazy, kind way to cancel a plan"
published: false
description: A small open-source desk for calling off a plan honestly and offering one real next time. Open data for the forecast, an open-weight model adapter kept behind a closed gate.
tags: devchallenge, hf26challenge, opensource, python
cover_image: https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/banner.png
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19)*

Cancelling a plan is a two-minute job that people stretch into an evening. You open the chat, type an apology, delete it, type a longer one, and then a second round of messages to agree on a new day. Most of us end up either over-explaining or going quiet. Raincheck is for the lazy middle path: say it once, say it kindly, offer one real next time, and let the other person answer with one click.

![Raincheck landing page with the fishing dock diorama](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/screenshots/01-landing.png)

## What I Built

Raincheck is a small writing desk for cancelling a plan without disappearing.

You fill in four short sections. Who it's for and what the plan was. One replacement time, with an optional city. Your note. Then two checkboxes: "I've read this" and "I understand anyone with the link can read it". Only then does Raincheck make a ticket: one unguessable link that expires in 30 days. You copy it and send it wherever you already talk to that person. Raincheck sends nothing.

The person on the other end opens the link and sees your note, the suggested time, and, if you picked a city, a real forecast for that day. They press **Accept this suggestion**, and that's it. There's an optional `.ics` file marked tentative, so the time can go into their calendar if they want it there. No account on either side. No invite. No calendar access.

![The writing desk, with the live ticket preview on the right](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/screenshots/02-composer.png)

**Who gets to be lazier.** The person cancelling skips the draft-delete-redraft loop and the "so when are you free?" thread that usually follows. The person receiving it skips the reply. A yes is one click. A no is just not clicking.

**Kind, not sneaky.** The desk keeps saying the same things in small print: only say what's true, don't invent illness or emergencies, the date is a suggestion and nobody's availability has been checked. There's a **Theatrical** tone for when you want to be silly, and it's labelled as a joke on both the draft and the ticket so nobody mistakes it for a real excuse.

The landing page is a WebGL fishing dock I made earlier, ported to React with the shader, palette, fish and Bayer dithering kept as they were. Move the pointer and the fish follow. Click and the water ripples. It pauses when it scrolls offscreen, and it stands still if your system asks for reduced motion.

## Demo

<!-- To play the video inline on DEV, upload blogs/assets/video/raincheck-demo.mp4 to YouTube or Vimeo and replace the image link below with {% embed <video URL> %}. -->

[![55-second narrated walkthrough of Raincheck](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/video/raincheck-demo-poster.png)](https://github.com/puri-adityakumar/raincheck/blob/main/blogs/assets/video/raincheck-demo.mp4)

A 55-second narrated walkthrough, recorded against a local build: write a note, pick Lisbon, see the real forecast, try AI drafting and get an honest "not configured", create the ticket, open it as the recipient, and accept.

There's no hosted demo yet. The repo has a Render blueprint (`render.yaml`, one Docker web service plus Postgres), but I haven't deployed it. It runs locally in two commands, shown below.

| The recipient's view | After one click |
| --- | --- |
| ![Recipient ticket page](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/screenshots/07-recipient.png) | ![Suggestion accepted](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/screenshots/08-accepted.png) |

## Code

{% embed https://github.com/puri-adityakumar/raincheck %}

The parts worth opening first:

- `backend/app/services/tickets.py`: token hashing, expiry, and the one-statement accept.
- `backend/app/services/weather_tokens.py`: the signed forecast proof.
- `backend/app/services/generation/service.py`: the open-weight model adapter, its prompt, and its output checks.
- `frontend/src/components/Composer.tsx`: the writing desk and the review gate.
- `frontend/src/components/FishingDiorama.tsx`: the dock.

## How I Built It

![How the pieces fit: React SPA, FastAPI, SQLite or Postgres, Open-Meteo, signed weather, and the optional open-weight AI adapter](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/diagrams/architecture.png)

It's one small service. A React 19 single-page app (Vite, TypeScript, Tailwind 4, Geist fonts bundled locally) talks to a FastAPI backend over `/api/*`. In production the same container serves both, so there's no CORS to configure. Storage is SQLAlchemy over SQLite locally. The Render blueprint points it at Postgres, which I haven't run against a live server yet.

**The open data: Open-Meteo.** City search and forecasts come from Open-Meteo's geocoding and forecast APIs. They're free and keyless, so there's no account and no key to leak. The server fetches the forecast for the chosen city and day, writes a plain summary like "Overcast, 17–25°C, 5% chance of rain", and signs it with HMAC-SHA256. The browser gets that signed proof and sends it back when it creates the ticket. The server checks the signature and the expiry before it puts any weather on the ticket. So a ticket can't show a forecast the server didn't fetch, and the attribution and fetch time are always printed next to it. If Open-Meteo is down, you get no weather, not invented weather.

![The forecast block with Open-Meteo attribution and fetch time](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/screenshots/04-preview.png)

**The open-weight model: Qwen, through a Tinker adapter, switched off.** This is the part I want to be plain about. Raincheck has an AI drafting boundary, `POST /api/generate`, built for small open-weight models. The adapter accepts only `Qwen/Qwen3-8B`, `Qwen/Qwen3.5-4B`, or `Qwen/Qwen3.5-9B` through Tinker's sampling API, with an optional `tinker://` fine-tuned adapter path. It caps replies at 256 tokens, runs at temperature 0.5, allows two requests at a time, and never retries a paid call on its own.

The prompt treats every user field as data, not instructions. It forbids invented illness, emergencies, shared history, calendar access, or the other person's availability. It may mention weather only by quoting the signed summary word for word. Then the reply is checked anyway, after Unicode normalisation: no Markdown or HTML, no medical words, no "you're free then", no weather words outside the signed summary. A draft that fails comes back as a typed error, and the note box keeps whatever you'd already written. Even a draft that passes still needs the same two checkboxes before it can become a ticket.

All of that is tested offline against an SDK double. None of it has called a real model. Live inference needs `AI_PROVIDER=tinker`, a separate `TINKER_ALLOW_PAID_INFERENCE=true`, credentials, and the pinned SDK, and every one of those is off. So with the default settings the endpoint returns `503 ai_unavailable`, the health check reports `ai_generation: false`, and the desk tells you so.

![AI drafting is not configured, and the desk says so](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/screenshots/03-ai-unavailable.png)

I'd rather ship a desk that says "write your own" than one that shows a canned sample and calls it AI.

**The ticket.** A share token is 32 random bytes from `secrets.token_urlsafe`. Only its SHA-256 hash is stored, so a copy of the database can't open anyone's ticket. Tickets expire after 30 days. Accepting is a single `UPDATE … WHERE accepted_at IS NULL`, so two people tapping at once, or one person tapping twice, record one acceptance and keep the first time. The private "anything to help with drafting?" field never leaves the composer. The ticket request strips it before it's sent.

![The life of one ticket: write, review, create, share, accept](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/diagrams/ticket-flow.png)

The `.ics` file is `STATUS:TENTATIVE`, with no organiser, no attendees, and no `METHOD`, so no calendar treats it as an invitation. Names and notes in any script, emoji included, are folded safely.

**Tests.** `./checks.sh` runs everything without network, installs, or AI calls: 234 backend tests, 32 adapter and tooling tests, and 66 frontend tests, plus Ruff, TypeScript, and a production build. Backend tests use throwaway SQLite databases and recorded Open-Meteo fixtures. The Docker image runs as a non-root user and refuses to start in production without a weather-signing secret.

I built it with a coding agent doing the typing. Separate workers owned the frontend, backend, and AI adapter, and an independent reviewer went through the result. That review found six real issues, including text in unusual Unicode forms slipping past the output checks, and an older database schema that would have broken group tickets. All six were fixed before I published.

**Limits, said plainly.**

- AI drafting is off. No live model has generated a note, and I'm not claiming any quality numbers.
- No fine-tune has run. The training script is a guarded dry run that refuses to spend money.
- Not deployed. The Render blueprint exists. Live Postgres, rate limits, and platform log redaction are still to do.
- One replacement time per ticket. No back-and-forth, no counter-proposal. That's on purpose, but it's still a limit.
- Anyone with the link can read the ticket. The desk says so before it makes one.
- Forecasts only reach about two weeks out. For a date further away, the ticket has no weather.
- Older databases from an earlier build are refused at startup, not migrated. That's safer than guessing, but it's manual.

## Why Does Open Innovation Matter?

Raincheck is built on things that are already open, so the expensive parts didn't need building.

The forecast is the clearest case. Open-Meteo is free and needs no key, so a tiny side project can show real weather without an account, a bill, or a secret in the repo. Because the data is open, the server can fetch it, sign it, and stand behind it. The rest of the stack is open too: FastAPI, SQLAlchemy, React, Vite, Tailwind, and the Geist fonts under the OFL. And `.ics` is an open standard, so "add it to your calendar" didn't need a Google or Microsoft integration.

The model side is about what happens when I turn it on. A cancellation note is small, personal text: a name, a plan, sometimes a reason. With an open-weight model, I choose which model reads it and where it runs, and I can swap it. Qwen 3.5 4B is plenty for a 700-character note. I can also fine-tune it on a small, consented set of honest notes, so it learns "no fake excuses" from examples and not only from a prompt. A closed API gives me none of those choices: not the weights, not the version, and not a guarantee the model won't change underneath the safety checks.

There's one more reason, and it's why I'm comfortable shipping with AI switched off. Because the model is just one swappable part behind a gate, the app doesn't depend on it. The desk works fully without a model. It doesn't fake one. And it's ready for an open model the day I decide to pay for inference.

## The Lazy Payoff

![Things I didn't build, because open work already did them](https://raw.githubusercontent.com/puri-adityakumar/raincheck/main/blogs/assets/diagrams/lazy-payoff.png)

For the person cancelling, the payoff is one message, not a thread. You write it once, with the new time already in it. For the person receiving it, a yes is one click and needs no reply.

For me, the lazy payoff was everything I didn't build. No weather service, no calendar integrations, no messaging, no accounts, and no dependency on a closed model. Each of those is a whole project with its own bugs and secrets, and an open piece or an open standard covered it.

I haven't timed anyone using it yet, so I won't put a number on it. The honest version: if you've ever spent twenty minutes on a two-line cancellation, this is for you.

## Prize Categories

I'm not entering a partner category this week. Raincheck has a Render blueprint, but the app isn't deployed on Render. Its open-weight adapter targets Tinker, but the Tinker category asks for a measured fine-tune against a baseline, and I haven't run one. The narration in the demo is macOS text-to-speech, not ElevenLabs. I'd rather say that than claim categories I haven't earned.
