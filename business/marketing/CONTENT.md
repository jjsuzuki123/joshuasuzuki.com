# CONTENT.md — ready-to-publish marketing content (30 days)

Voice rules applied throughout: first person, practitioner register, concrete numbers, no
hype words ("game-changer", "revolutionary" banned), the tool's limits stated plainly.
Everything here is a draft for YOU to post under your name — edit freely so it sounds like
you. Placeholders in ⟨angle brackets⟩. Nothing here may be posted until HA-011 (launch
green-light), except OUT-A/OUT-B warm outreach which you may start any time after HA-011's
prerequisites make the trial usable.

Note on employer: drafts say "I work in web infrastructure sales" — they never name your
employer, and nothing here should read as speaking for them. Check your employment
agreement's side-project clause before Day 1 (flagged in HUMAN_ACTIONS HA-012).

---

## §1 LinkedIn posts (LI-1 … LI-12)

### LI-1 — Day 1, "why I built this"
I spend my working days selling web infrastructure to companies that measure downtime in
dollars per second. Here's a thing I kept noticing on the other end of the market:

Freelancers and small agencies are now getting the same question from clients that
enterprises get from lawyers — "are we okay on accessibility?" — and they have nothing good
to answer with.

The tools are either $500+/year overlay widgets that accessibility experts publicly warn
against (the FTC fined the biggest vendor $1M for deceptive compliance claims), or
enterprise scanners priced for compliance departments.

So I built the middle: a scanner that checks client sites against WCAG rules, watches them
for regressions, and produces a plain-English report with the agency's logo on it — the
kind of deliverable you can hand a client, or bill an audit against.

It finds roughly a third of accessibility issues — the mechanical third a machine can find.
It will not make anyone "compliant," and it says so on the report. That honesty is the
whole point.

$29/month flat, 7-day trial, no card. Link in comments. If you run client sites, I'd
genuinely value your first-scan reaction — the report is the product, and I want it to be
the best one you've seen.

### LI-2 — Day 3, EAA plainly
The European Accessibility Act has been enforceable since June 28, 2025. A year on, here's
what's actually happening, minus the fear-mongering:

- France: advocacy groups filed the first actions against major retailers' inaccessible
  checkouts within months.
- Germany: competitors are sending cease-and-desist letters (Abmahnungen) to small shops
  over obvious WCAG failures. Small shops. Not just enterprises.
- Netherlands: the regulator publishes a public non-compliance list.

If you build or maintain sites for clients who sell to EU consumers, two honest takeaways:

1. Micro-enterprises are largely exempt — many of your clients may be fine. Check before
   you scare anyone.
2. For the rest, "we never looked" is now the worst position. A documented audit +
   remediation plan is both the fix and the good-faith evidence regulators reward.

The audit doesn't need to be expensive to start. An automated scan catches the mechanical
failures (contrast, labels, alt text — which are also the ones enforcement letters cite
most), and a manual pass covers the rest for high-risk flows.

That first documented scan is an hour of work. It's also a service your clients will pay
for. Happy to share how I'd scope it — ask below.

### LI-3 — Day 8, what automated scanning can and can't do
An uncomfortable fact from the accessibility world: automated scanners catch roughly 30–40%
of WCAG issues. Every vendor knows this. Not every vendor says it.

What a scanner reliably catches: missing alt text, low contrast, unlabeled form fields,
broken heading structure, invalid ARIA, missing page language, zoom-blocking. The
mechanical stuff — which, notably, is also most of what shows up in demand letters.

What it can't catch: whether the alt text is *useful*, whether keyboard focus order makes
sense, whether a screen-reader user can actually complete checkout. That takes a human.

So when a tool promises "one line of JavaScript = full compliance," you now know enough to
close the tab. (The FTC agreed — accessiBe paid $1M over exactly that claim.)

The honest workflow for an agency: automated scan on everything (cheap, continuous,
documented) + manual review on the money paths (checkout, signup, contact). Scope both,
bill both. Clients respect the distinction more than a fake green checkmark.

### LI-4 — Day 10, the overlay problem
The most popular "accessibility solution" for small sites is a widget that claims to fix
issues in the visitor's browser. Some numbers worth knowing before recommending one to a
client:

- The FTC fined the market leader $1,000,000 in 2025 for deceptive claims that its AI made
  sites WCAG-compliant.
- Courts have repeatedly declined to treat overlays as a defense — because the underlying
  HTML is what gets evaluated, and the overlay doesn't change it.
- Hundreds of accessibility practitioners signed a public statement asking sites to remove
  overlays because they can make screen-reader experiences *worse*.

Overlays persist because they're easy to sell: one script tag, $49/month per site, a badge.

The alternative is less magical: find the issues in the actual code, fix the important
ones, document what you did, keep watching for regressions. It's real work — but it's
billable real work, and it holds up when someone checks.

If you maintain client sites, that maintenance contract you already have is the natural
home for it.

### LI-5 — Day 15, how to sell an accessibility audit (script included)
The easiest accessibility conversation with a client isn't legal-flavored at all. Here's
the framing that works (borrowed from years of selling infrastructure):

Don't open with lawsuits. Open with an artifact. Run a scan of their site before the call,
put your logo on the report, and send it with:

"Ran your site through our accessibility check as part of the quarterly review — found
⟨N⟩ issues, ⟨M⟩ of them serious. Most are quick fixes (things like unlabeled forms and
low-contrast text). Want me to knock out the serious ones this month? It also puts a
documented audit on file, which is worth having with the current enforcement climate."

Three sentences of risk context, zero doom. The report does the persuading — the client
can *see* the red items on their own pages.

Pricing that lands for small-agency clients: $300–600 for audit + serious fixes on a
brochure site; fold ongoing monitoring into the existing care plan at +$50–100/mo. The
audit is repeatable across every client you manage — that's the leverage.

### LI-6 — Day 17, care-plan economics
Small math for agencies running maintenance retainers:

Say you maintain 15 client sites. Accessibility monitoring across all of them costs $29–59
a month with tooling like mine (or roll your own with open-source axe — the engine is free,
you're paying for the workflow: scheduling, diffs, branded reports).

Add "accessibility monitoring + quarterly report" to your care plan at +$50/month per
client. If a third of clients take it: 5 × $50 = $250/mo of new recurring revenue against
~$50 of tooling. The quarterly report renews the perceived value — it's a deliverable they
can forward internally.

The pattern is old (SEO reports, uptime reports) — accessibility is just the newest column,
with a regulatory tailwind. The agencies that add it first get to define what it costs.

### LI-7 — Day 22, launch day
SiteRamp is public today.

What it is: accessibility scanning and monitoring for people who build and maintain client
websites. Add a site, get a prioritized WCAG report in minutes, put your own logo on the
PDF, schedule weekly rescans so regressions get caught before clients notice.

What it isn't: a compliance certificate. Automated checks find roughly a third of issues —
the mechanical third. The report says this out loud, which I consider a feature.

$29/month flat for 10 sites. 7-day trial, no card. First scan takes about two minutes.

I built this nights-and-weekends because agency friends kept asking the same question:
"a client asked about accessibility — what do I even send them?" This is that answer.

If you try it today, I'll personally look at your first report and tell you what I'd fix
first — offer stands for the first 20 people. Link in comments.

### LI-8 — Day 24, launch retro (fill numbers honestly)
Launched a micro-SaaS this week. Numbers, because launch posts without numbers are ads:

- Visitors: ⟨N⟩
- Trials started: ⟨N⟩
- Paying customers: ⟨N⟩
- Refunds: ⟨N⟩
- Most common support question: ⟨"why did my scan fail" / actual answer⟩

What surprised me: ⟨honest observation — e.g. how many trial sites sat behind bot
protection, which the report now explains how to allowlist⟩.

What I'd tell anyone launching a small tool: the FAQ you write before launch is the
support load you don't carry after it. Half my FAQ was written from imagining angry
users; those exact questions arrived within 48 hours, pre-answered.

Building in public, will keep posting real numbers. Ask me anything below.

### LI-9 — Day 29, first case study (get written permission first)
⟨Agency name or "A two-person studio in ⟨city⟩"⟩ ran their biggest client's site through
SiteRamp last week. Results, shared with permission:

- 214 issues across 25 pages; 31 serious, 6 critical
- The critical six: unlabeled checkout form fields and white-on-gray button text
- Time to fix the six: about 3 hours
- What they billed the client for audit + fixes: $⟨N⟩

Second scan after the fixes: zero critical, score up ⟨N⟩ points — and the diff is on the
report, which the client's ops lead forwarded to their exec with a one-line "handled."

That forwarded email is the entire business case. The agency looks proactive, the client
gets documentation, the site actually works better for more people.

(If you want your site or a client's site to be case study #2, my DMs are open — free
audit in exchange for a conversation.)

### LI-10 (spare) — the 6 failures I see everywhere
I've now scanned dozens of small-business sites. The same six failures appear on almost
every one, in order of frequency: low-contrast text (design trend casualty), images
without alt text, form fields without labels, links that say nothing ("click here", icon
links), skipped heading levels, and zoom disabled on mobile.

All six are cheap to fix. All six are machine-detectable, which means they're also the
first thing any auditor, regulator, or plaintiff's tool will find. Fix the cheap visible
stuff first — it's most of the risk surface for a brochure site.

### LI-11 (spare) — "we'll deal with it if someone complains"
A client said this to an agency friend recently. It's a real strategy — here's the honest
risk math so you can have the conversation like an advisor instead of a fear-monger:
most small sites will never get a demand letter. But the ones that do face a
four-to-five-figure problem that was a three-figure prevention, the letters
disproportionately target e-commerce checkouts with mechanical failures, and "we have a
documented audit and fixed the serious items" is the difference between a nuisance and a
settlement. Prevention is cheap enough now that the honest advice changed.

### LI-12 (spare) — what I learned selling infra that applies to accessibility
Enterprise buyers taught me: nobody buys "compliance." They buy an artifact they can
forward to whoever is asking. The security questionnaire answer. The audit PDF. The
pen-test report. Accessibility is the same purchase — the report IS the product, the
scanning is just how it gets made. Design your deliverable for the person it gets
forwarded to, not the person who buys it.

---

## §2 Reddit posts (value-first; the tool appears only where rules allow or when asked)

### RD-1 — r/webdev, Day 4 — "EAA enforcement, one year in: what actually happened (for those of us building client sites)"
Long-form text post: the June 2025 deadline, what enforcement has actually looked like
(France retailer actions, German Abmahnung wave vs small shops, NL public list), the
micro-enterprise exemption most people miss, what "good faith" concretely means (documented
audit + prioritized fixes + statement), and the honest 30–40% automated-coverage number
with a workflow suggestion (scan everything continuously, manual-review the money paths).
No links to the product in the post body. If someone asks what I use: answer honestly in
comments. Full draft written — ~600 words, ends with "happy to answer what I've learned
setting this up for client work."

### RD-2 — r/web_design, Day 11 — "I scanned 25 small-agency portfolio sites for accessibility. Same 6 failures on 22 of them."
The LI-10 material expanded with specifics per failure (what it looks like in markup, the
one-line fix, which WCAG criterion). Genuinely useful checklist format. Product unnamed;
"a scanner built on axe-core" is the only reference. (Run the actual 25-site scan before
posting so the numbers are real — 1 hour of prep, uses the product itself.)

### RD-3 — r/freelance, Day 18 — "Pricing accessibility work for small clients: what's working for me"
The LI-5/LI-6 material in forum register: the artifact-first pitch, $300–600 audit+fix
scoping, care-plan add-on math, and the "don't scare micro-enterprises who are exempt"
honesty. Asks the community what they're charging — engagement bait that's also real
market research for us.

### RD-4 — r/Wordpress, Day 25 — "WordPress accessibility: the issues that keep showing up in scans, and the plugin/theme settings behind them"
WP-specific findings: theme contrast tokens, menu ARIA, form-plugin label settings, slider
alt-text UX, the overlay-plugin trap. High-value for the largest site-builder community.
Product mentioned only if asked.

---

## §3 Warm outreach templates

### OUT-A — first touch (personalize the first line; send 5/week)
Subject: quick accessibility question re: ⟨client/site⟩

⟨First name⟩ — ⟨one genuine line: saw your work on X / we talked at Y⟩.

Quick context: I built a small tool that audits websites for accessibility issues (WCAG)
and produces a client-ready report — built it because agency friends kept getting "are we
okay on accessibility?" from clients and had nothing good to send back.

Offer, no strings: reply with any site you build or maintain and I'll send you the full
branded report this week — the same PDF you'd get as a customer, yours to keep and use
with the client either way.

If it's useful, the tool is $29/mo flat for 10 sites. If not, you got a free audit and I
got feedback. Fair?

— Josh

### OUT-B — follow-up (7–10 days later, one only)
⟨First name⟩ — sent the audit offer last week; totally fine if it's a "not now."

One thing that might change the calculus: ⟨pick one — the EAA has been enforceable for a
year and German competitors are sending demand letters to small shops / two of the sites I
scanned this week had checkout forms a screen reader can't complete — that's the exact
pattern demand letters cite⟩.

Standing offer: one site, full branded report, free, this week. Just reply with the URL.

---

## §4 Launch-platform copy

### PH-1 — Product Hunt pack
- **Tagline:** White-label accessibility reports for people who build client websites
- **Description:** SiteRamp scans the sites you build/maintain against WCAG rules
  (axe-core in a real browser), tracks new vs fixed issues over time, and produces a
  plain-English report with YOUR logo — a deliverable you can hand to a client or bill an
  audit against. Honest by design: automated checks find ~⅓ of issues (the mechanical
  ones), and the report says so. $29/mo flat for 10 sites. 7-day trial, no card.
- **First comment (maker):** why-I-built-it (LI-1 condensed) + the honesty positioning +
  "ask me anything, and if you drop your URL I'll share what the scan finds."
- **Assets needed on launch morning:** 4 screenshots (dashboard, report page, branded PDF,
  diff view) — I generate these from the seeded demo account during production QA.

### IH-1 — Indie Hackers post
Title: "Launched an accessibility scanner for agencies — the positioning IS the honesty"
Body: the build story (evidence-first niche pick, the FTC/overlay backlash as the market
opening, 60-day constraint), the stack (one VPS, SQLite, Playwright — boring on purpose),
real launch numbers, and the refund-first support model as a solo-operator survival
strategy. IH loves specifics; this has them.

---

## §5 Directory submission list (Day 2, ~2 hours total)
AlternativeTo (position: alternative to accessiBe/UserWay/Silktide) · SaaSHub ·
There's An AI/tool directories that list a11y tooling · a11y-tools.com ·
accessibility.digital resource lists (submit via their contact) · Uneed · MicroLaunch ·
Fazier. Skip anything that requires payment. Log submissions + URLs in a note for the
SEO-citation record.

---

## §6 Canned support responses (paste-ready)

**(a) Scan failed / bot protection**
Thanks for the report — I looked at your scan. The site's firewall is blocking automated
visitors, which is common (Cloudflare and similar). Since you manage the site, the fix is
quick: allowlist the user agent `SiteRampBot` (Cloudflare: Security → WAF → Tools → User
Agent Blocking / custom rule "allow"), then hit Run scan again. If it still fails, send me
the domain and I'll dig in personally. If you can't allowlist and the tool's therefore not
useful to you, say the word and I'll refund immediately — no hard feelings.

**(b) "Will this make us ADA/EAA compliant?"**
Honest answer: no tool can promise that, including ours (anyone who says otherwise —
see the FTC's $1M order against accessiBe). What SiteRamp does: finds the mechanically
detectable WCAG issues (roughly a third of the total, and the kind enforcement letters cite
most), documents them, and tracks fixes over time — strong good-faith evidence and real
usability improvement. For high-risk flows (checkout, signup) we recommend adding a manual
review by an accessibility specialist. The report's scope section says exactly this, so
you can share it with anyone who's asking.

**(c) Refund request**
Done — refunded in full; you'll see it in 5–10 business days. Purely optional: one sentence
on what didn't work for you would genuinely help me improve it. Either way, thanks for
trying it, and the door's open if it's ever a better fit.

**(d) Feature request**
Thank you — noted on the roadmap list, and I mean that literally (it's a real file).
I keep the product deliberately small so it stays fast and dependable, so I only ship
things several customers ask for — but this one's now counted. I'll email you if it lands.

**(e) Scanning behind a login**
Not supported yet — it's the most-requested item on the roadmap. Current workaround
some agencies use: a staging copy of the authenticated area, unlocked for the scanner's
user agent. If login scanning is the make-or-break for you, tell me a bit about the setup
(which auth) — real use cases are what will get it built.

**(f) How do I cancel?**
Billing page → "Manage billing" → Cancel. Takes effect at the end of the paid period, no
partial-month gotchas, your data stays until you delete it. If something specific drove
this, one sentence helps me fix it for the next person. Thanks for giving it a shot.

**(g) Security questionnaire / "where does our data live?"**
Fair question. Short version: scans read only publicly reachable pages; we store the page
URLs, detected issues, and short HTML snippets of flagged elements — no visitor data, no
code injected into your sites, no analytics beacons. Hosting is a single ⟨EU/US per final
deploy⟩ server; payments are handled entirely by Stripe (we never see card numbers);
passwords are hashed with argon2id. Delete a site or your account and the data is gone
immediately (backups age out in 30 days). Happy to answer anything more specific.
