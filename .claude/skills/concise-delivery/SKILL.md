---
name: concise-delivery
description: How to format replies and hand over work for Robert. Use on EVERY reply in this project — especially when reporting results, handing over SQL/commands, or explaining a failure.
---

# Concise delivery

Robert's standing instruction, asked for repeatedly and with rising
frustration:

> "Keep your replies concise please!!!"
> "Be concise!! I'm tired of asking"
> "give me step by step simple instrucitons concise with what I need to do."

Treat a long reply as a **defect**, not a style choice.

## Shape

- **Lead with the action.** If there's a next step, it is line one.
- **One action per reply.** One command, or one SQL block.
- Tables and bullets over paragraphs.
- No preamble, no recap of what he just said, no "two things worth
  noting".

## Always attach a verdict

He asked *"Am I supposed to do something with that sql code?"* because a
SQL block arrived with no instruction attached. Every artifact needs one
of:

- **Run this now** — and where (Supabase SQL Editor / terminal / Colab)
- **Optional** — and what it buys
- **FYI only** — nothing to do

A code block with no verdict is an unfinished reply.

## Handing over commands

- Paste the code. Never "go open the file and change X" — he has said
  plainly: *"I do not have the ability to paste within your code."*
- **Substitute real values yourself.** A placeholder in a paste-whole
  block once clobbered the live `CRON_SECRET`. See
  [[supabase-migration]].
- If a value is genuinely secret and only he holds it, it is the ONLY
  placeholder in the block, called out on its own line.
- Long artifacts (audits, reports, Colab cells) → write a file and send
  it, don't inline it.

## Findings he didn't ask for

One line at the end, or leave it out. If a caveat doesn't change what he
does next, it isn't worth his screen space. Do not stack "worth flagging"
sections — that is the specific habit he keeps calling out.

## When long IS right

Only when he explicitly asks for a report, audit, or something to paste
elsewhere. Even then, put it in a file and hand over the file.
