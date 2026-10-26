# Learning design

How a Scriptorium book teaches. The aim: more understanding per page than a modern textbook. That means more worked maths, more pictures, more theory tied to real practice, and fewer words that do no work.

The bar comes from the best explanatory books. Philipp Dettmer's *Immune* (Random House, 2021) is the reference the project brief names: one illustrated idea after another, a consistent visual language, a story that pulls you to the next page, and simplifications that say they are simplifications. Scriptorium borrows those techniques, never its text or pictures, and adds what a popular-science book leaves out: derivations, worked problems, experiments and graded practice, every one checked by a test.

## The shape of a chapter

| Part | What it does | Where it lives |
|---|---|---|
| **Hook** | One or two sentences that make the reader want the chapter: a puzzle, a surprise, an everyday use | `chapter.hook` |
| **Goals** and **prerequisites** | What you will be able to do, and what you need to know first | `chapter.goals`, `chapter.prerequisites` |
| Sections, each in five layers | **In short** → **Intuition** (the picture, the analogy) → **The detail** (equations, derivations, worked problems) → **Limits** (where it breaks, common mistakes, practice) → **Key takeaways** | `section.layers` |
| **Summary** and **key equations** | A one-page recap | `chapter.summary`, `chapter.keyEquations` |
| **Practice** | Graded core → stretch → challenge, answers and full worked solutions at the back | `chapter.exercises` |

## The learning blocks

Each block has a fixed structure, so it can't be padded and can't skip a step.

| Block | Structure | Rule |
|---|---|---|
| `equation` | intuition sentence · the equation · every symbol with its unit · a worked numeric example · where it stops being valid | The example is re-computed by a test |
| `derivation` | goal · assumptions · steps (maths **and** the one law or move that justifies each) · checks (units, limits, special cases) · the equation it reaches | Re-derived symbolically by a test |
| `problem` (worked) | statement · given · find · **strategy before algebra** · steps · answer · check | Arithmetic re-done by a test |
| `experiment` | question · **safety** · what you need · what to do · **predict → observe → explain** · optional real data with its source | Hands-on only when low-risk; the domain's restricted-detail rules always apply |
| `misconception` | the mistake · why it's tempting · what's true · **a test that tells them apart** | — |
| `application` | where the idea is used for real · a worked number from practice | — |
| `explore` | a question to answer by dragging · 1–4 sliders · up to 3 curves · live numbers · **what to notice** | Readouts re-computed from the book's own expressions by a test |
| `quiz` (Check yourself) | one question · 2–5 answers, exactly one right · **why** for every answer, the wrong ones naming the slip | Exactly one right answer (schema) |
| `figure` / `model3d` | caption states the takeaway first · alt text · credit and provenance | Lifts off the page in the 3D Edition |
| Exercise | prompt · level · answer · full solution steps | Answer re-checked by a test |

The verification report at the back of every book lists every automated check: equations, derivations, worked problems, explorables and exercise answers.

## Explorables and self-checks

Reading that "doubling the voltage quadruples the energy" is one thing; dragging a slider and watching the parabola climb is another. An **explorable** gives the reader one to four sliders, a plot that redraws as they drag, and a few live numbers, around a question the sliders answer ("Which slider moves the 63.2 % crossing?"). *Pin* keeps an earlier curve for comparison; *Sweep* plays the first slider across its range.

The same block serves every edition:

| Edition | What the reader gets |
|---|---|
| Web | Live sliders, plot and numbers (one small script, `assets/viewer3d.js`); without script, the printed still |
| Print | A still with three curves (the first slider low, default and high) or three marked points, the slider ranges, the numbers at the defaults, what to notice, and a link and QR code to the live one |
| Ebook | The still and the link |
| 3D Edition | A **Try it** hotspot on the printed box opens the live version over the book |

Every expression uses the safe expression language of the code-drawn plots, so a model can propose an explorable without running code. The build drops one whose expressions use names that are not its sliders, and a Python test evaluates the book's own expressions (not a copy) at the defaults and checks them against the physics with Pint.

A **Check yourself** question ends a section where a mistake is worth catching. Each wrong answer is a slip a real student makes, and choosing it shows why it is wrong; choosing the right one shows why it is right. On the web this is plain HTML and CSS; in print, the answers are in the back of the book with the exercise solutions.

## In the 3D Edition: pull out, keep, study

The 3D Edition turns the same blocks into things a reader handles. Each kind keeps one colour and one icon everywhere (hotspot, pop-up card, desk card, study card), from the colour-blind-safe Okabe–Ito set, and always with its name:

| Kind | Colour | What "pulling it out" does |
|---|---|---|
| Figure | sky blue | Lifts the printed figure off the page |
| 3D model / scene | green | Opens it in 3D; a scene can be played, cut away, exploded and X-rayed |
| Equation | orange | An equation card: intuition, every symbol with its unit, worked example, where it holds |
| Explorable | pink | Live sliders; if the explorable names a scene in `drives`, its sliders move the scene |
| Check yourself | yellow | The question; picking an answer explains it |
| Chapter | vermilion | The chapter's hook, goals, counts and everything inside, in reading order |

**Driving a scene** links the two most concrete things a section has: the explorable's numbers and the scene's picture. `drives` maps an expression of the sliders to a kit input (`R * C / 1000` → the RC kit's time constant in seconds), in the same safe expression language, and the build checks it.

**The desk and study mode** are a small version of retrieval practice. A kept item becomes a card that asks before it tells: an equation card shows its intuition and asks for the equation; a figure shows the picture and asks for its takeaway; a check asks its question and grades itself. *Again* brings a card back two cards later; *Got it* retires it; the end screen counts first-try answers and suggests coming back the next day. Practice testing and spaced (distributed) practice are the two techniques a large review of study methods rated most useful [Dunlosky et al. 2013, *Psychological Science in the Public Interest* 14(1):4–58, doi:10.1177/1529100612453266]. Study mode is deliberately light: no streaks, scores kept or schedules, and nothing leaves the reader's browser.

**Pop-ups** are for orientation, not decoration. When a spread opens, what can be pulled out stands up, so a reader sees at a glance what the spread offers; the chapter banner says how much is ahead. They fold flat the moment a page turns, and readers who ask their device for reduced motion start with them off.

## Concision rules

`src/core/concision.ts` checks every book and reports each finding with a fix. The command line, the pipeline report and the editor's *Tighten* list all show these findings. They never block a build.

| Rule | Limit |
|---|---|
| Filler phrases ("it is important to note that", "in order to", "basically"…) | Delete, or use the shorter word it suggests |
| Intensifiers ("very", "extremely"…) | Delete, or give a number |
| Stacked hedges ("may possibly") | One hedge, or a *consensus* / *debate* callout saying how sure we are |
| Sentence length | ≤ 32 words |
| Paragraph length | ≤ 110 words; otherwise split it, or turn it into a list, figure or worked example |
| Wall of text | A section with over 350 words of prose and nothing that shows the idea |
| Repeats | The same sentence twice in one section |
| **Density** | ≤ 300 words of prose per figure, derivation, worked problem or experiment, across the book |

The engineering sample (`examples/rc-circuits`) passes every rule at **92 words of prose per visual**.

## Writing, in one paragraph

Start from the concrete (a question, an everyday case), then the idea, then the equation, then where it breaks. Keep to one idea per paragraph. Label an analogy as an analogy and say where it stops working. Show instead of describing: a figure, a derivation, a worked problem. Tie every theory to how it is measured and where it is used. Mark every simplification. The drafting and review prompts (`src/llm/prompts.ts`) carry these rules to the model, and the reviewer re-does every derivation step and every answer.

## Next

- **A visual vocabulary per book:** each recurring concept keeps one colour and one mark in every figure, the way the best illustrated books give each actor a consistent look. Figures already share colour-blind-safe roles (`src/core/style.ts`); the next step makes the mapping from concept to role part of the book source.
- **Living diagrams:** a process animates with a scrubbable timeline in the 3D Edition (six scene kits do this today: transistor, capacitor, RC circuit, blood vessel, cell size, electron groups); next, print gets numbered stills of the same steps, the way explorables already print theirs.
- **The flagship chapter:** the transistor, with every block type and its scene kit.
