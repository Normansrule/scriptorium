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
| `figure` / `model3d` | caption states the takeaway first · alt text · credit and provenance | Lifts off the page in the 3D Edition |
| Exercise | prompt · level · answer · full solution steps | Answer re-checked by a test |

The verification report at the back of every book lists every automated check: equations, derivations, worked problems and exercise answers.

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
- **Living diagrams:** a process animates with a scrubbable timeline in the 3D Edition, and print gets numbered stills of the same steps.
- **The flagship chapter:** the transistor, with every block type and its scene kit.
