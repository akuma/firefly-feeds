import type { Article, Feed, Story } from "../types";
import { readingTime } from "../reading";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SAMPLE EDITION — invented publications and invented writers.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This exists so the reader has something to show the first time it is opened:
 * the stream's five layouts, the type scale, the rhythm of a real edition. It
 * is the only fabricated content in the project, and it is fabricated all the
 * way down —
 *
 *   • every publication is invented and sits on a reserved `.example` host,
 *     which by RFC 2606 can never resolve to a real site;
 *   • every byline is an invented writer;
 *   • sample stories carry no outbound link at all, so "open original" stays
 *     disabled rather than pointing somewhere plausible and wrong.
 *
 * An earlier draft attributed these essays to real, named writers at real
 * publications. That is misattribution whatever the intent, and it is why the
 * sample is fenced off here instead of masquerading as subscriptions.
 *
 * Nothing in this directory is fetched, synced, or stored. Delete
 * `lib/sample/` and the application still runs.
 */

export const SAMPLE_FEEDS: Feed[] = [
  {
    id: "slowweb",
    name: "The Slow Web",
    folder: "independent",
    host: "slowweb.example",
    mark: "SW",
    sample: true,
  },
  {
    id: "longcontext",
    name: "Long Context",
    folder: "ai",
    host: "longcontext.example",
    mark: "LC",
    sample: true,
  },
  {
    id: "roughdraft",
    name: "Rough Draft",
    folder: "design",
    host: "roughdraft.example",
    mark: "RD",
    sample: true,
  },
  {
    id: "commonplace",
    name: "Commonplace",
    folder: "culture",
    host: "commonplace.example",
    mark: "CM",
    sample: true,
  },
  {
    id: "boringlayer",
    name: "The Boring Layer",
    folder: "technology",
    host: "boringlayer.example",
    mark: "BL",
    sample: true,
  },
  {
    id: "presscheck",
    name: "Press Check",
    folder: "design",
    host: "presscheck.example",
    mark: "PC",
    sample: true,
  },
  {
    id: "uniteconomics",
    name: "Unit Economics",
    folder: "technology",
    host: "uniteconomics.example",
    mark: "UE",
    sample: true,
  },
];

export const SAMPLE_FEED_BY_ID = new Map(SAMPLE_FEEDS.map((feed) => [feed.id, feed]));

export const ARTICLES: Article[] = [
  /* ----------------------------------------------------------- 12 min --- */
  {
    id: "quiet-return",
    title: "The Quiet Return of the Personal Website",
    feedId: "slowweb",
    dek: "After a decade of renting space on other people’s platforms, a small number of writers are buying domain names again — and finding out what that actually buys them.",
    minutesAgo: 12,
    layout: "feature",
    plate: 0,
    byline: "Nadia Ferrer",
    body: [
      {
        kind: "p",
        text: "For a while, the personal website seemed to disappear.",
      },
      {
        kind: "p",
        text: "Social networks absorbed the conversations, publishing platforms absorbed the writing, and profile pages replaced homepages.",
      },
      { kind: "p", text: "But something has started to change." },
      {
        kind: "p",
        text: "People are building small corners of the web again.",
      },
      {
        kind: "p",
        text: "Not because they expect millions of visitors, but because they want somewhere that belongs to them.",
      },
      { kind: "h2", text: "The economics of a small room" },
      {
        kind: "p",
        text: "The numbers are unimpressive on purpose. A domain costs about twelve dollars a year. Static hosting costs nothing until it costs five dollars a month. The entire operation fits on a laptop, a text editor, and an afternoon of mild confusion about DNS records.",
      },
      {
        kind: "p",
        text: "That is the point. A personal website is the only publishing format whose economics do not require an audience to justify its existence. A newsletter needs subscribers. A social account needs reach. A homepage needs nobody at all — which is precisely what makes it possible to keep writing on it for eleven years.",
      },
      {
        kind: "quote",
        text: "The homepage is the only page on the internet that has no opinion about how many people are reading it.",
        cite: "Nadia Ferrer, in conversation",
      },
      {
        kind: "p",
        text: "There is a nostalgic version of this argument, and it is mostly wrong. Nobody seriously expects the open web of 2006 to reassemble itself, and the people building these sites are not trying to reassemble it. They are doing something narrower and more practical: they are giving themselves one address that they control, and treating everything else as distribution.",
      },
      { kind: "h2", text: "What actually changed" },
      {
        kind: "p",
        text: "Three things, roughly, over the last two years.",
      },
      {
        kind: "list",
        items: [
          "Building stopped being a barrier. Static site generators, plain HTML, and a generation of tools that assume you would rather write Markdown than configure a database mean the distance between an idea and a published page is now measured in minutes.",
          "The costs collapsed. Hosting a site that gets four hundred visits a month is functionally free, and it has been functionally free for long enough that people have stopped noticing it as a constraint.",
          "The feeds came back. RSS never died; it was merely unfashionable. Reader apps, newsletters that publish a feed, and the slow return of link blogs have made it possible again to follow a few dozen sites without an algorithm mediating every encounter.",
        ],
      },
      {
        kind: "p",
        text: "The third one matters more than the first two. A personal website without a way to be read is a diary. A personal website with a feed is a publication. The infrastructure for the second thing has been sitting there the whole time, unglamorous and unmonetised, waiting for people to get tired of the alternative.",
      },
      {
        kind: "figure",
        seed: 0,
        caption:
          "FIG. 01 — Fourteen months of traffic to a personal site. The spike is a single link from a popular newsletter. The floor — forty to ninety readers a day, steadily — is the interesting part.",
      },
      { kind: "h2", text: "A slower kind of publishing" },
      {
        kind: "p",
        text: "What changes when you own the page is not the quality of the writing. It is the tempo. There is no metric refresh, no draft sitting in a queue waiting for the optimal posting window, no fifteen-minute window after publishing in which a post either finds an audience or is quietly buried.",
      },
      {
        kind: "p",
        text: "You publish something. It sits there. Someone finds it in four months and sends you an email about it. This is a much slower feedback loop than most writers are now accustomed to, and after the initial discomfort of it, a lot of people find they prefer it.",
      },
      {
        kind: "note",
        text: "A note on measurement: page views are a poor instrument for a small site. They reward frequency and punish depth. If you must look at a number, look at the number of people who came back — the returning-reader count is the only figure that tracks whether the writing is doing anything.",
      },
      {
        kind: "p",
        text: "The people doing this well are not hermetic about it. They post links everywhere, they syndicate, they send the newsletter, they show up in the places where readers already are. They simply keep the canonical version somewhere they control. Distribution is rented; the text is owned.",
      },
      { kind: "h2", text: "The case for owning the address" },
      {
        kind: "p",
        text: "Platforms do not usually die dramatically. They degrade. The editing tools get worse, the recommendations get more aggressive, the export gets more limited, and the terms change in ways that are technically permissible and practically irreversible. None of this is a catastrophe on any given Tuesday. It is a slow erosion of the assumption that the thing you made will still be where you left it.",
      },
      {
        kind: "p",
        text: "A domain name is a hedge against that erosion. It is not a business model, it is not a growth strategy, and it will not make anyone famous. It is a small, boring piece of infrastructure that means the next eleven years of your writing do not depend on a product decision made by someone you have never met.",
      },
      {
        kind: "p",
        text: "Which is why the return is quiet. There is no launch, no announcement, no migration post. There is just a new page, a working feed, and a very small number of people who found it. That turns out to be enough.",
      },
    ],
  },

  /* ----------------------------------------------------------- 38 min --- */
  {
    id: "small-models",
    title: "Why Small Models Are Getting Interesting Again",
    feedId: "longcontext",
    dek: "The frontier keeps moving, but the floor has risen much faster. A four-billion-parameter model on a laptop now does work that needed a cluster two years ago.",
    minutesAgo: 38,
    layout: "standard",
    plate: 3,
    byline: "Dmitri Vance",
    body: [
      {
        kind: "p",
        text: "There is a particular kind of whiplash in watching the small-model space right now. The headlines are all about the frontier — the enormous, expensive models that keep getting better at everything — while the genuinely surprising movement is happening several orders of magnitude below them.",
      },
      {
        kind: "p",
        text: "Two years ago, running a language model locally meant accepting a steep quality tax. You got a model that could summarise a paragraph, sort of, and hallucinated confidently the moment you asked it to do anything with structure. It was a novelty. It was not a tool.",
      },
      { kind: "p", text: "That tax has almost entirely disappeared." },
      { kind: "h2", text: "The floor rose" },
      {
        kind: "p",
        text: "The interesting metric is not how good the best model is. It is what quality of output you can get from a model that fits in eight gigabytes of unified memory. That number has moved further in eighteen months than the frontier has moved in the same period, and it is doing so for structural reasons rather than a single breakthrough.",
      },
      {
        kind: "list",
        items: [
          "Training recipes got better. A large fraction of the gains come from data curation and post-training, not parameter count — techniques that transfer down the size ladder quickly.",
          "Quantisation stopped being destructive. Four-bit and even two-bit quantisation now preserve most of the capability, which effectively quarters the memory a given model needs.",
          "Inference runtimes matured. Continuous batching, paged attention, and speculative decoding turned local inference from a curiosity into something that runs at a usable speed on hardware people already own.",
          "Distillation became routine. Labs now train small models explicitly against the outputs of large ones, which is a much more efficient use of a compute budget than training small models from scratch.",
        ],
      },
      {
        kind: "p",
        text: "Put those together and you get a model that fits on a laptop, answers in under a second, and is good enough for a wide band of real work: extracting structured data, classifying, rewriting, writing commit messages, summarising a document you are already holding.",
      },
      { kind: "h2", text: "Why this changes tooling more than research" },
      {
        kind: "p",
        text: "Frontier models make new things possible. Small local models make existing things cheap, private, and instant. That is a different kind of change and it lands in a different place — not in research labs, but in editors, terminals, note apps, and the small utilities that people build for themselves.",
      },
      {
        kind: "p",
        text: "The constraint that disappears is the round trip. When a model call costs nothing and returns in three hundred milliseconds, you stop designing around it. You stop batching. You stop caching. You stop asking whether this feature is worth an API call, and you start treating inference as a local primitive, like a sort function or a regular expression.",
      },
      {
        kind: "code",
        text: "// the whole integration, if you already have a runtime\nconst out = await llama.complete({\n  prompt: `Summarise in one sentence:\\n${text}`,\n  maxTokens: 80,\n});",
      },
      {
        kind: "quote",
        text: "The moment inference becomes free at the point of use, the interesting question stops being what a model can do and starts being where you would put one.",
      },
      { kind: "h2", text: "The awkward middle" },
      {
        kind: "p",
        text: "There is still a band where local models are not good enough and hosted models are overkill: long-context reasoning, multi-step agentic work, anything where a wrong answer is expensive. That band is real, and it is where most production systems currently live.",
      },
      {
        kind: "p",
        text: "But the band is narrowing from both sides. Small models keep improving, and the price of hosted inference keeps falling. The honest position is that the local option is now good enough to be the default for a large category of features, and the interesting engineering work has moved to routing — deciding, per request, which of the two you actually need.",
      },
      {
        kind: "p",
        text: "The models are not getting smarter at the rate the press suggests. They are getting smaller at a rate that is much more useful.",
      },
    ],
  },

  /* ----------------------------------------------------------- 1 hr ----- */
  {
    id: "calm-software",
    title: "Designing Software That Feels Calm",
    feedId: "roughdraft",
    dek: "Calm is not the absence of features. It is a set of specific, unglamorous decisions about timing, motion, colour and restraint.",
    minutesAgo: 64,
    layout: "standard",
    plate: 6,
    byline: "Iris Lindqvist",
    body: [
      {
        kind: "p",
        text: "Ask ten designers what makes an interface feel calm and you will get ten variations on “less stuff”. That is not wrong, but it is not useful either. Minimalism is a style. Calm is a behaviour, and it is produced by a fairly small number of decisions that are mostly invisible when they are made well.",
      },
      {
        kind: "p",
        text: "The most useful definition I have found is this: calm software is software whose state you can predict. Everything follows from that. An interface feels agitated when you cannot tell what it is about to do, or what it just did, or whether the thing you clicked actually registered.",
      },
      { kind: "h2", text: "Three sources of noise" },
      {
        kind: "list",
        items: [
          "Unrequested motion. Something animates that you did not cause. A panel slides, a badge bounces, a number ticks upward. Each one is a small demand for attention, and they compound quickly.",
          "Ambiguous state. The button looks the same before and after you pressed it. The save is happening, or it happened, or it failed — the interface declines to say which.",
          "Competing emphasis. Four things on screen are all shouting at the same volume, so nothing is emphasised and everything requires reading.",
        ],
      },
      {
        kind: "p",
        text: "Almost every interface I would describe as stressful has at least two of these. Almost every one I would describe as calm has none of them.",
      },
      {
        kind: "quote",
        text: "An animation is a promise about where something came from. If you cannot say what the promise is, delete the animation.",
      },
      { kind: "h2", text: "Motion is a promise" },
      {
        kind: "p",
        text: "Motion earns its place by explaining a spatial or causal relationship. A sheet that rises from the bottom tells you it can be dismissed downward. A row that expands tells you where the detail came from. Motion that only exists to make a transition feel “designed” is a tax the reader pays on every interaction, forever, in exchange for nothing.",
      },
      {
        kind: "p",
        text: "The practical rule: durations between 120 and 240 milliseconds for direct manipulation, longer only when a large surface is moving. One easing curve, applied consistently, so that everything in the product appears to obey the same physics. And an unconditional respect for reduced-motion preferences — not as an accessibility afterthought, but because the people who set that flag are usually the people who were most annoyed by the motion in the first place.",
      },
      { kind: "h2", text: "The discipline of the default" },
      {
        kind: "p",
        text: "Calm interfaces take a position. They decide what most people want most of the time and then make that the path, rather than presenting a wall of equally weighted options and calling it flexibility. Configuration is not a feature; it is a deferred design decision, and every setting you add is one you declined to make.",
      },
      {
        kind: "figure",
        seed: 6,
        caption:
          "FIG. 02 — Emphasis is a budget. Four elements of equal weight produce no hierarchy at all; the quiet version of the same screen reads in a single glance.",
      },
      {
        kind: "p",
        text: "The same discipline applies to colour. A restrained palette is not an aesthetic preference; it is what makes the one accent colour mean something. If everything is tinted, nothing is highlighted, and the reader has to fall back on reading the labels — which is exactly the work the design was supposed to do for them.",
      },
      {
        kind: "p",
        text: "None of this is glamorous, and none of it photographs well in a portfolio. It shows up in the aggregate instead: an application you can leave open all day without feeling drained by it. That is the whole ambition, and it is harder to reach than it sounds.",
      },
    ],
  },

  /* ----------------------------------------------------------- 2 hrs ---- */
  {
    id: "web-we-lost",
    title: "The Web We Lost, and the Web We Could Still Build",
    feedId: "commonplace",
    dek: "The enclosure of the open web was not a hostile takeover. It was a series of small, reasonable conveniences — which is exactly why it is so hard to reverse.",
    minutesAgo: 128,
    layout: "quote",
    pull: "We did not lose the open web to a competitor. We lost it to convenience, which is a much harder opponent to argue with.",
    byline: "Lila Okonjo",
    body: [
      {
        kind: "p",
        text: "The standard story about the enclosure of the web is a story about villains. A handful of enormous companies built walled gardens, made them irresistible, and the open web withered in their shade. It is a satisfying narrative and it is almost entirely untrue.",
      },
      {
        kind: "p",
        text: "What actually happened is that the open web asked users to make a series of small, individually reasonable trade-offs, and lost every one of them. You could host your own photos, or you could upload them somewhere that would show them to your friends immediately. You could run your own comment system, or you could let someone else deal with spam. Each decision was trivial. The aggregate was the web we have now.",
      },
      { kind: "h2", text: "A short history of convenience" },
      {
        kind: "p",
        text: "The important thing about convenience is that it is not a trick. The platforms genuinely were better — faster, easier, more reliable, and free at the point of use. Arguing against them on ideological grounds required asking people to accept a worse experience in exchange for an abstract good they would not notice for a decade.",
      },
      {
        kind: "p",
        text: "That is a losing argument, and it will keep losing. Any strategy for a more open web that depends on people voluntarily choosing the harder path is a strategy that has already failed. The only version that works is one where the open path is also the easier one.",
      },
      {
        kind: "quote",
        text: "We did not lose the open web to a competitor. We lost it to convenience, which is a much harder opponent to argue with.",
        cite: "from the essay",
      },
      {
        kind: "p",
        text: "Fortunately, that is no longer as fanciful as it sounds. A static site with a working feed, a comment system that costs nothing, a newsletter archive that also exists as HTML — this is now an afternoon of work for someone with basic technical confidence, and a genuinely pleasant afternoon for someone using modern tooling.",
      },
      { kind: "h2", text: "What is actually recoverable" },
      {
        kind: "list",
        items: [
          "Reading. Feeds still work, they are still trivially cheap to publish, and a reader that owns its own subscription list is a real alternative to an algorithmic timeline. This is the part that was never actually broken, only unfashionable.",
          "Writing. Owning the canonical version of your text is cheap and durable. Syndication to wherever the readers are is a distribution decision, not an architectural one.",
          "Conversation. This is the genuinely hard one. Decentralised discussion has been attempted many times and has mostly produced fragmentation rather than dialogue.",
          "Identity. Portable identity remains the unsolved problem underneath all of the others, and it is the one that most other things depend on.",
        ],
      },
      {
        kind: "p",
        text: "Notice that the recoverable list is ordered by difficulty, and that the two easiest items are also the two with the largest personal payoff. You do not need to solve decentralised identity to have a website and a feed. You just need a domain and an hour.",
      },
      { kind: "h2", text: "The case for boring infrastructure" },
      {
        kind: "p",
        text: "The most hopeful development of the last few years is how boring the good tools have become. There is no protocol war to win, no new standard to adopt, no startup to bet on. RSS, HTTP, HTML, and a text file are sufficient to publish something that will still resolve in twenty years.",
      },
      {
        kind: "figure",
        seed: 2,
        caption:
          "FIG. 03 — The share of a typical reader’s attention by acquisition channel. Nothing here needs to be replaced; it needs to be supplemented.",
      },
      {
        kind: "p",
        text: "That is a much less exciting story than the one about the villains, and it has the considerable advantage of being actionable. The web we lost was not taken. It was set down, gradually, by people who had somewhere more convenient to put it. Setting it back down again is a thing that individuals can do this weekend, without anyone’s permission.",
      },
      {
        kind: "p",
        text: "The web we could still build is smaller than the one we lost, and it will never have the reach. It might, however, be a better place to write — and that has always been the part that mattered.",
      },
    ],
  },

  /* ----------------------------------------------------------- 3 hrs ---- */
  {
    id: "local-ai-tools",
    title: "Inside the New Generation of Local AI Tools",
    feedId: "boringlayer",
    dek: "A tour of the apps that assume the model is already on your machine — and the surprising design constraints that follow from that assumption.",
    minutesAgo: 186,
    layout: "standard",
    plate: 1,
    byline: "Adrienne Cho",
    body: [
      {
        kind: "p",
        text: "The most interesting AI applications released this year have a feature in common that none of them advertise: they do not have a server. The model ships with the app, runs on your hardware, and the app works on a plane.",
      },
      {
        kind: "p",
        text: "This sounds like a technical detail. It is actually a design constraint, and it produces a recognisably different kind of product — smaller, faster, less ambitious, and considerably more pleasant to use than the chat windows it is replacing.",
      },
      { kind: "h2", text: "Latency changes what you build" },
      {
        kind: "p",
        text: "When inference takes three hundred milliseconds and costs nothing, you stop treating it as a transaction. You start calling it on every keystroke, on every selection change, on every file save. Features that would be absurd as a network request become obvious as a local one.",
      },
      {
        kind: "list",
        items: [
          "A commit message that writes itself as you stage files, with no spinner and no dialog.",
          "A search field that understands intent, filtered live against a local index that never leaves the machine.",
          "A note-taking app that suggests links between entries while you type, silently, and shows nothing when it has nothing to say.",
        ],
      },
      {
        kind: "p",
        text: "None of these are impressive as demos. All of them are the kind of thing you keep using after the novelty wears off. That is the tell.",
      },
      {
        kind: "quote",
        text: "The best local AI features are the ones you never notice, because they never make you wait.",
        cite: "an engineer at a small Mac app studio",
      },
      { kind: "h2", text: "Privacy is a side effect, not a pitch" },
      {
        kind: "p",
        text: "Almost none of these apps lead with privacy, which is a change from a few years ago. The pitch is speed and offline availability. Privacy arrives as a consequence — your documents never leave the device because there is nowhere for them to go.",
      },
      {
        kind: "p",
        text: "This is a healthier dynamic than the marketing-driven version. A feature that is true by construction is more durable than a promise in a privacy policy, and it survives a change of ownership.",
      },
      { kind: "h2", text: "What still does not work" },
      {
        kind: "p",
        text: "Long documents, multi-step reasoning, anything resembling an agent — these remain firmly in the cloud. The local models are excellent at transformation and poor at planning, and the tools that try to paper over that gap end up feeling unreliable in a way that is worse than being obviously limited.",
      },
      {
        kind: "p",
        text: "The makers who have figured this out ship narrow, sharp features and resist the temptation to add a chat box. The ones who have not ship a chat box, and it is slow, and it is worse than the website they are competing with.",
      },
      {
        kind: "p",
        text: "The shape of the category is becoming clear: a small number of excellent local utilities, a small number of excellent hosted services, and a great deal of confusion in between. The confusion will resolve. The utilities will stay.",
      },
    ],
  },

  /* ----------------------------------------------------------- 4 hrs ---- */
  {
    id: "infinite-scroll",
    title: "The Case Against the Infinite Feed",
    feedId: "presscheck",
    dek: "Scrolling is not reading. The formats that respect attention have endings, and endings are a design decision.",
    minutesAgo: 240,
    layout: "compact",
    byline: "Marta Villalba",
    body: [
      {
        kind: "p",
        text: "Every interface that removes its own ending is making an argument about what it thinks you are for. An infinite feed says: you are here to consume, and the correct amount of consumption is more.",
      },
      {
        kind: "p",
        text: "Endings are expensive to design. A last page means deciding what deserves to be last, which means deciding what matters, which means taking a position. Infinite scroll is what you build when you would rather not take one.",
      },
      {
        kind: "p",
        text: "The alternative is not austerity. Magazines end. Books end. A well-made anthology ends with something you did not expect and then stops. The stopping is part of the craft, and it is the part that almost every product team leaves out because it is the part that cannot be measured.",
      },
      {
        kind: "p",
        text: "A feed with an ending does something subtle to the reader: it turns browsing back into choosing. You finish, you close it, and you go do something else. That is not a metric a growth team will ever optimise for, which is precisely why it has to be a deliberate decision made by someone who is not on the growth team.",
      },
    ],
  },

  /* ----------------------------------------------------------- 5 hrs ---- */
  {
    id: "reading-technology",
    title: "Reading as a Technology, Not a Skill",
    feedId: "commonplace",
    dek: "Deep reading is a recent invention, maintained by a fragile set of environmental conditions that we are currently dismantling.",
    minutesAgo: 300,
    layout: "standard",
    plate: 7,
    byline: "Tomas Reinhardt",
    body: [
      {
        kind: "p",
        text: "We talk about reading as though it were a capacity, like eyesight — something you either have or lack, and which, once acquired, stays with you. It is better understood as a technology: a practice with prerequisites, maintained by an environment, and easy to lose.",
      },
      {
        kind: "p",
        text: "Sustained attention to a long text is not the default state of a human being. It is the product of a specific arrangement: a quiet room, a single object, a duration with no interruptions, and a social expectation that none of this is strange.",
      },
      { kind: "h2", text: "The prerequisites" },
      {
        kind: "list",
        items: [
          "Continuity of surface. One page at a time, in a fixed position, so that the eye learns where it is.",
          "Absence of choice. No decision about whether to continue, no feed to check, no notification waiting.",
          "A visible extent. You can see how much is left, which turns reading into a bounded act rather than an open-ended one.",
          "A single voice. One author, unimpeded, for as long as the argument takes.",
        ],
      },
      {
        kind: "p",
        text: "Every one of these is a property of the reading environment, not of the reader. Which means every one of them can be designed for, and every one of them is currently being designed away.",
      },
      {
        kind: "quote",
        text: "The page is not a container for text. It is the machine that makes concentrated reading possible.",
      },
      {
        kind: "p",
        text: "This is why the typography of a reading application is not decoration. Line length, leading, measure, contrast, the space above a heading — these are the parameters of the machine. Get them wrong and no amount of discipline on the reader’s part will fully compensate.",
      },
      {
        kind: "figure",
        seed: 7,
        caption:
          "FIG. 04 — A comfortable measure sits between 62 and 75 characters. Beyond that, the return sweep starts costing more than it gives back.",
      },
      {
        kind: "p",
        text: "The good news is that the conditions are cheap to restore. A single column. A serif with real optical sizing. Generous leading. No sidebar competing for the eye. A way to hide everything else.",
      },
      {
        kind: "p",
        text: "None of that is nostalgic. It is an engineering answer to an engineering problem, and the fact that it looks old is simply evidence that the problem was solved properly the first time.",
      },
    ],
  },

  /* ----------------------------------------------------------- 6 hrs ---- */
  {
    id: "when-models-get-cheap",
    title: "What Happens When Intelligence Gets Cheap",
    feedId: "uniteconomics",
    dek: "The cost curve is not the interesting part. The interesting part is what becomes rational to attempt once a capability stops being scarce.",
    minutesAgo: 372,
    layout: "standard",
    plate: 2,
    byline: "Arun Desai",
    body: [
      {
        kind: "p",
        text: "Every general-purpose technology follows a similar arc: it is expensive, therefore it is centralised; then it becomes cheap, and the centre of gravity moves outward to the edges where the specific knowledge lives.",
      },
      {
        kind: "p",
        text: "Electricity did this. Computing did this. And there is a reasonable case that inference is doing it now, faster than most incumbents have planned for.",
      },
      { kind: "h2", text: "The two-budget model" },
      {
        kind: "p",
        text: "The practical way to think about it is that every application now has two budgets instead of one. There is a compute budget, which is falling, and there is a context budget, which is the hard constraint. The winner in most categories will not be the team with the best model. It will be the team with the best access to the data the model needs.",
      },
      {
        kind: "p",
        text: "That is a meaningful shift. When capability is scarce, capability wins. When capability is abundant, the scarce input becomes proprietary context: the archive, the workflow history, the ten years of records nobody else has. Owning that is a different business than owning the model.",
      },
      { kind: "h2", text: "The integrator’s advantage" },
      {
        kind: "p",
        text: "This is also why the most defensible positions are appearing in unglamorous verticals rather than in general assistants. A tool that knows the specifics of a single industry’s documents, regulations, and exceptions is worth more than a general model that knows none of them — and it can be built on top of a model that costs almost nothing to run.",
      },
      {
        kind: "p",
        text: "The strategy follows directly. Do not compete on the model. Compete on the context you have assembled, the workflow you have learned, and the trust you have accumulated. Those are the assets that do not get commoditised by a cheaper checkpoint every six months.",
      },
      {
        kind: "p",
        text: "None of this is a prediction about which companies win. It is a statement about where the value sits along the stack, and that has been remarkably stable across every previous wave of this kind.",
      },
    ],
  },

  /* ----------------------------------------------------------- 7 hrs ---- */
  {
    id: "quiet-redesign",
    title: "A Redesign That Removed Four Hundred Elements",
    feedId: "roughdraft",
    dek: "What was left after the subtraction — and why the team says the product finally feels like theirs.",
    minutesAgo: 430,
    layout: "compact",
    byline: "Iris Lindqvist",
    body: [
      {
        kind: "p",
        text: "The brief was not “make it simpler”. It was “make it possible to explain in one sentence”. That constraint did most of the work: anything that could not be described in the sentence was removed, and by the end, four hundred and twelve interface elements had gone.",
      },
      {
        kind: "p",
        text: "What survived was a list, a detail view, and a single primary action. Everything else moved behind a search field, which turned out to be a better home for it anyway — a search field is honest about the fact that most features are used by a minority of people.",
      },
      {
        kind: "p",
        text: "The unexpected consequence was speed. With a fifth of the components, the interface stopped needing to negotiate with itself. States were fewer, transitions were shorter, and the whole product became legibly faster without a single performance project.",
      },
      {
        kind: "p",
        text: "The team’s own summary is the most useful part: the previous version had been designed for the people who asked for features. The new one is designed for the people who use it every day, most of whom had never asked for anything.",
      },
    ],
  },

  /* ----------------------------------------------------------- 9 hrs ---- */
  {
    id: "hallucination-product",
    title: "Hallucination Is a Product Problem",
    feedId: "longcontext",
    dek: "Confident wrongness is not a bug you wait out. It is a property you design around, the same way you design around latency.",
    minutesAgo: 520,
    layout: "brief",
    byline: "Dmitri Vance",
    body: [
      {
        kind: "p",
        text: "Every team shipping language model features eventually arrives at the same fork. Either you keep waiting for the model to stop being confidently wrong, or you accept that it will be and design the product so that being wrong is survivable.",
      },
      {
        kind: "p",
        text: "The second path is much more productive, because the requirement is usually not accuracy — it is verifiability. A user who can check an answer in three seconds is served just as well as one who never had to check.",
      },
      {
        kind: "p",
        text: "That means citations that actually resolve, diffs instead of rewrites, drafts instead of publishes, and a consistent refusal to present generated text in the same visual register as verified text. None of this is exotic. All of it is skipped, constantly, because it is less exciting than the demo.",
      },
      {
        kind: "p",
        text: "The teams doing this well have stopped thinking of the model as an oracle and started thinking of it as a fast, over-eager colleague whose work you still have to sign off on. That framing produces better interfaces than any amount of prompt engineering.",
      },
    ],
  },

  /* ---------------------------------------------------------- 10 hrs ---- */
  {
    id: "screen-typography",
    title: "Notes on Typography for Screens",
    feedId: "slowweb",
    dek: "Twelve small decisions that separate a page you can read for an hour from one you close after a paragraph.",
    minutesAgo: 640,
    layout: "compact",
    byline: "Nadia Ferrer",
    body: [
      {
        kind: "p",
        text: "Serif typefaces were designed for paper, and screens are not paper — but the differences matter far less than they did a decade ago. High-density displays and real optical sizing have made the classical text faces entirely viable on screen, and often more comfortable than the geometric sans that replaced them.",
      },
      {
        kind: "p",
        text: "What actually matters, in rough order of impact: measure, leading, contrast, and then everything else. A page with a 65-character measure and 1.7 leading set in a mediocre typeface will beat a page with beautiful type set 120 characters wide at 1.3 leading, every single time.",
      },
      {
        kind: "p",
        text: "After that come the details that produce the feeling of quality without being individually noticeable: hanging punctuation, slightly tighter tracking on large headings, a consistent optical margin, and a refusal to let any element — caption, byline, footnote — be set at the same size and weight as the body.",
      },
      {
        kind: "p",
        text: "The final one is the hardest and the most valuable: leave something out. A reading page with no navigation, no related-content rail, and no newsletter prompt is a page that trusts its reader to finish.",
      },
    ],
  },

  /* ---------------------------------------------------------- 13 hrs ---- */
  {
    id: "european-ai-stack",
    title: "The European AI Stack Is Quietly Assembling Itself",
    feedId: "boringlayer",
    dek: "Sovereignty talk is cheap. Compute, data and talent are not — and a real, if uneven, stack is taking shape across the continent.",
    minutesAgo: 800,
    layout: "standard",
    plate: 4,
    byline: "Adrienne Cho",
    body: [
      {
        kind: "p",
        text: "For two years, European AI policy was mostly a conversation about regulation. That conversation is still happening, but underneath it something more concrete has started to accumulate: actual capacity, in actual buildings, staffed by people who are not leaving.",
      },
      { kind: "h2", text: "What exists now" },
      {
        kind: "list",
        items: [
          "A small but real cluster of publicly subsidised compute, concentrated around three national research centres and heavily oversubscribed.",
          "Several capable open-weight model families, trained on modest budgets, that have found genuine adoption outside their home countries.",
          "A dense layer of applied companies building on top of imported models — the least glamorous layer, and the one that will determine whether any of this survives.",
        ],
      },
      {
        kind: "p",
        text: "The gaps are equally clear. No European lab is currently training at the frontier. The talent pipeline leaks steadily westward. And the investment environment remains hostile to the ten-year timescales that infrastructure requires.",
      },
      {
        kind: "quote",
        text: "Sovereignty is not a model you trained. It is the ability to keep operating when someone else’s model stops being available to you.",
      },
      {
        kind: "p",
        text: "That reframing is doing a lot of work in policy circles, because it points at a different set of investments: inference capacity, deployment tooling, and the boring middleware that lets a company switch model providers without rewriting its product.",
      },
      {
        kind: "figure",
        seed: 4,
        caption:
          "FIG. 05 — Announced versus operational compute capacity by region. The gap between the two bars is the entire story.",
      },
      {
        kind: "p",
        text: "Whether this adds up to a stack or a scatter of experiments is genuinely unclear. But the shift from arguing about rules to arguing about capacity is a healthy one, and it has made the conversation substantially more concrete.",
      },
    ],
  },

  /* ---------------------------------------------------------- 17 hrs ---- */
  {
    id: "agents-one-thing",
    title: "Agents That Do One Thing",
    feedId: "longcontext",
    dek: "The autonomous-agent pitch keeps stalling. The narrow, boring, single-purpose tools keep working.",
    minutesAgo: 1000,
    layout: "brief",
    byline: "Dmitri Vance",
    body: [
      {
        kind: "p",
        text: "General agents fail in a specific and instructive way: they are evaluated on tasks where the success criterion is obvious, and deployed on tasks where it is not. A coding agent that passes a benchmark is not the same artefact as a coding agent you leave running against your repository.",
      },
      {
        kind: "p",
        text: "The tools that have actually stuck are extremely narrow. Rename these variables. Write the changelog from these commits. Convert this document to that schema. Each has one input, one output, and one obvious way to check whether it worked.",
      },
      {
        kind: "p",
        text: "Narrow tools also fail better. When a single-purpose agent is wrong, the failure is visible and cheap. When a general agent is wrong, it has usually already done four other things, and now you are doing archaeology.",
      },
      {
        kind: "p",
        text: "This is not an argument that general agents will never work. It is an argument about sequencing: reliability has to be earned one scope at a time, and the products earning it are the ones that resisted the demo.",
      },
    ],
  },

  /* ---------------------------------------------------------- 20 hrs ---- */
  {
    id: "archive-product",
    title: "The Archive Is the Product",
    feedId: "uniteconomics",
    dek: "Subscription businesses are usually analysed as content plus distribution. The durable ones are analysed better as an accumulating asset.",
    minutesAgo: 1200,
    layout: "standard",
    plate: 5,
    byline: "Arun Desai",
    body: [
      {
        kind: "p",
        text: "A subscription business that produces perishable content has to keep running to stay in place. A subscription business that accumulates an archive gets stronger the longer it operates, and it does so without a corresponding increase in cost.",
      },
      { kind: "h2", text: "Two different curves" },
      {
        kind: "p",
        text: "The perishable model is a treadmill: this week’s output is worth roughly this week’s revenue, and last week’s output is worth almost nothing. The archive model compounds, because the back catalogue becomes the reason somebody subscribes in year five — often the primary reason, and one that costs nothing to serve.",
      },
      {
        kind: "p",
        text: "The strategic implication is that search, structure, and citation of your own back catalogue is not a nice-to-have. It is the mechanism by which the asset appreciates. A publication whose archive cannot be searched or linked to is paying to maintain an asset it cannot access.",
      },
      {
        kind: "list",
        items: [
          "Stable URLs, forever, and a stated policy that they will not change.",
          "Full-text search that includes the back catalogue rather than privileging the last thirty days.",
          "Structured metadata good enough that a citation can be generated automatically.",
          "A feed for the archive, not just for the new.",
        ],
      },
      {
        kind: "p",
        text: "Almost none of this is expensive, which is the frustrating part. It is simply less exciting than producing new work, so it gets deferred — and every year of deferral makes the eventual cleanup more costly than the original build would have been.",
      },
      {
        kind: "p",
        text: "Publication archives are one of the few genuinely compounding assets in media. Treating them as a cost centre rather than the product is the most common expensive mistake in the category.",
      },
    ],
  },

  /* ------------------------------------------------------- 1.1 days ----- */
  {
    id: "museums-servers",
    title: "Why Museums Are Buying Servers",
    feedId: "commonplace",
    dek: "The cultural sector’s quiet turn toward digital preservation is less about technology than about who gets to decide what survives.",
    minutesAgo: 1500,
    layout: "compact",
    byline: "Lila Okonjo",
    body: [
      {
        kind: "p",
        text: "A surprising number of cultural institutions have started running their own infrastructure. Not because it is cheaper — it usually is not — but because preservation requires control over the format, the migration path, and the timeline.",
      },
      {
        kind: "p",
        text: "Cloud storage is excellent until the pricing model changes, the vendor is acquired, or an account is suspended for reasons that are never fully explained. For an institution whose mandate is measured in centuries, a ten-year vendor commitment is not a plan.",
      },
      {
        kind: "p",
        text: "The deeper issue is format. A digital object is only preserved if the thing that renders it is also preserved, and the sector has learned — painfully, over thirty years of lost installations — that the software is the fragile part, not the file.",
      },
      {
        kind: "p",
        text: "So the servers are really an argument about agency. Someone has to decide what gets migrated, when, and into what. Institutions that have concluded they want to be that someone are buying hardware, and they are hiring archivists who can read a spec.",
      },
    ],
  },

  /* -------------------------------------------------------- 1.25 days --- */
  {
    id: "small-web-manifesto",
    title: "A Manifesto for the Small Web",
    feedId: "slowweb",
    dek: "Not a movement, not a protocol, not a startup. Just a few thousand people deciding to publish things that are theirs.",
    minutesAgo: 1800,
    layout: "quote",
    pull: "The small web does not need a standard. It needs a few thousand people who cannot be bothered to wait for one.",
    byline: "Nadia Ferrer",
    body: [
      {
        kind: "p",
        text: "Every few years someone proposes a new protocol for a better web, and every few years it acquires a specification, a working group, and a slow decline. Meanwhile, the small web keeps assembling itself out of HTML files and stubbornness.",
      },
      {
        kind: "p",
        text: "What defines it is not a technology but a stance: publish things that belong to you, link generously, keep a feed, and do not wait for permission or consensus. The bar for entry is a text editor and the willingness to be unimpressive in public.",
      },
      {
        kind: "p",
        text: "The results are not spectacular. They are, however, durable. Sites built this way have been running for twenty years, largely unattended, and will still resolve after most of the platforms that overshadowed them have been shut down or absorbed.",
      },
      {
        kind: "p",
        text: "That is the whole pitch, and it does not require a manifesto. Which is presumably why the people doing it have never written one.",
      },
    ],
  },

  /* -------------------------------------------------------- 1.5 days ---- */
  {
    id: "presence",
    title: "The Uncanny Valley of Presence",
    feedId: "boringlayer",
    dek: "Video avatars got good enough to be unsettling, which is a different problem than the one the industry was solving.",
    minutesAgo: 2100,
    layout: "compact",
    byline: "Adrienne Cho",
    body: [
      {
        kind: "p",
        text: "The technical achievement is genuine: real-time synthesis of a face, a voice, and matching lip movement, at a latency that permits conversation. What the demos do not resolve is the reason the effect lands so badly with almost everyone who experiences it.",
      },
      {
        kind: "p",
        text: "The problem is not realism. It is the absence of the small involuntary signals that make a face legible: the micro-pauses, the half-smile that does not complete, the way attention moves when someone is thinking about what you just said.",
      },
      {
        kind: "p",
        text: "Removing those signals produces a face that is recognisably a person and unmistakably not one. Audiences resolve the contradiction the only way available — by reading intent into it — and the intent they read is usually not flattering.",
      },
      {
        kind: "p",
        text: "There are real uses for the technology, mostly in asynchronous contexts where nobody expects a person to be present. In synchronous conversation, the honest conclusion so far is that a voice and an initial is less unsettling than a face that is almost right.",
      },
    ],
  },

  /* -------------------------------------------------------- 1.8 days ---- */
  {
    id: "color-of-print",
    title: "The Colour of Print, Translated",
    feedId: "presscheck",
    dek: "Risograph inks, newsprint yellows and press misregistration are being recreated on screens — and the results say something about how we read images.",
    minutesAgo: 2600,
    layout: "standard",
    plate: 6,
    byline: "Marta Villalba",
    body: [
      {
        kind: "p",
        text: "A generation of designers who have never worked with a printing press are building interfaces that look like they came off one. Registration that is slightly off, inks that multiply instead of covering, a grain that is not noise but paper.",
      },
      {
        kind: "p",
        text: "It would be easy to dismiss this as nostalgia. It is more useful to notice what these effects are doing functionally: they add the small irregularities that signal an object made by a person, which is a signal screens otherwise lack.",
      },
      { kind: "h2", text: "What the effects are actually for" },
      {
        kind: "list",
        items: [
          "Texture creates a sense of scale. Flat vector surfaces have no inherent size; grain gives the eye something physical to measure against.",
          "Misregistration creates depth. Two slightly offset layers read as two objects rather than one, which is why the effect survives being ported to motion.",
          "Limited ink makes hierarchy legible. When you have three colours, you are forced to decide what each one means.",
        ],
      },
      {
        kind: "p",
        text: "The failure mode is over-application. Grain applied uniformly becomes a filter; misregistration applied to everything becomes a style. The work that holds up uses one of these devices, in one place, for one reason.",
      },
      {
        kind: "figure",
        seed: 6,
        caption:
          "FIG. 06 — Three inks, multiplied. The constraint is the point: the palette forces the hierarchy before the layout does.",
      },
      {
        kind: "p",
        text: "What is being translated is not a look but a set of constraints. The interesting question for a designer is not how to make a screen look like paper, but which of paper’s restrictions produced good work — and whether any of them are worth keeping voluntarily.",
      },
    ],
  },
];

/* ------------------------------------------------------------------ derive */

/** The sample edition's stories, with reading times derived from the bodies. */
export const SAMPLE_STORIES: Story[] = ARTICLES.map((a) => ({
  ...a,
  minutes: readingTime(a.body),
}));
