# Bringing a parent home: is the medicine list clear?

Dana Whitfield's Front Door: the four screens your visitors use (welcome, questions,
waiting screen and their result with an advisor), ready to run on your own
accounts. You own it, you pay only for what your visitors use, and their answers
stay with you.

## Put it online (about 10 minutes, once)

The setup video shows every click. First, get your AI key:

- **Anthropic** (console.anthropic.com) — the AI that writes each visitor's plan
  and answers their questions. Add credit with your card, then set a monthly
  spending limit under **Settings > Limits**. Create an API key under
  **API Keys** and keep it somewhere safe.

Then press **Deploy to Cloudflare** on your Second Act package page:

1. Sign in to Cloudflare, or create a free account. The free plan is enough.
2. Connect your GitHub account when asked (or create a free one), and tick
   **Create private Git repository**. Cloudflare puts your own copy there.
3. Where it asks for `ANTHROPIC_API_KEY`, paste your Anthropic key.
4. Select **Create and deploy**. When it finishes you'll see your address,
   ending in `.workers.dev`.

Open your address. Take the assessment once yourself: you should get your result,
your plan and the advisor. Paste the address on your package page, then link to
it from your own website.

If the key is missing or wrong, visitors still get their result and what needs
attention; the page tells them the personal plan isn't switched on yet. To add or
change it: in Cloudflare open the Worker's **Settings > Variables & Secrets**,
select **Add**, choose type **Secret**, name it `ANTHROPIC_API_KEY`, paste your
key and save.

### Setting it up again by hand

This repository is your copy, so you can always put it online again from here:
in Cloudflare open **Workers & Pages**, select **Create application**, next to
**Import a repository** select **Get started**, pick this repository, keep the
name **dana-whitfield-front-door** and select **Save and Deploy**. Then add your key as above.

## Stuck?

Add TechyAI as a member of your Cloudflare account (**Manage Account > Members >
Invite**, role **Administrator**) and send us a note. We finish the setup; you
paste your AI key yourself, so we never see it. Remove us when it's done.

## What it costs you

- Cloudflare: free on the free plan for normal traffic.
- Anthropic: roughly 10 to 20 cents for each visitor who gets a plan and asks the
  advisor a few questions. Your spending limit in Anthropic, and the daily limit
  here (`DAILY_LIMIT_USD`, set to $5 a day), stop the bill growing past what you
  allow. When the day's limit is reached, visitors still get their result; the
  plan and the advisor return the next day.

## What visitors see

- **Welcome**: Find out where your parent's medicine list stands
- **Questions**: 6 questions, about 2 minutes.
- **Waiting screen**: a short animation and a game while their plan is written.
- **Their result**: one of three answers (Stop. Get help today. / You can't judge this yet. / Nothing alarming so far.),
  what needs attention and why, a first step, a 7-day plan following
  The Discharge List Walkthrough, and Dana's advisor.
- **Next step**: "Ask Dana about the course" goes to dana.whitfield@example.com.

## Privacy

Answers, results and advisor conversations are stored only in your Cloudflare
account. Each result has its own private link. Nothing is sent to TechyAI.
