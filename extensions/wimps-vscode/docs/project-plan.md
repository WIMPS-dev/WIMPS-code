# WIMPS VS Code Extension Project Plan

## Project Goal

Build WIMPS into a native VS Code assembly-development workflow for MIPS and RISC-V. The extension should support the Codevium assembly suite/workspace, include the WIMPS simulator experience directly in VS Code, and preserve the old browser WIMPS page at `/classic`.

## Next-Week Deliverables

1. Finish basic extension implementation.
   - Keep MIPS assemble/run/step/reset/debug working.
   - Keep RISC-V assemble/run/step/reset/debug working through `@specy/risc-v`.
   - Verify diagnostics, output, input syscalls, breakpoints, tree views, and bitmap display.

2. Move the VS Code view into Codevium.
   - Decide whether Codevium launches a web VS Code shell, embeds a VS Code-like workspace, or links into a hosted VS Code environment.
   - Preinstall or bundle the WIMPS extension in the assembly workspace.
   - Add workspace defaults for assembly files, theme, keybindings, and example programs.

3. Preserve classic WIMPS.
   - Route the current browser WIMPS app under `/classic`.
   - Make the new VS Code workflow the primary/default route.
   - Keep classic mode discoverable for existing users and comparison screenshots.

4. Write the paper draft in LaTeX.
   - Draft the story before polishing implementation details.
   - Include screenshots of the native VS Code extension and Codevium workspace.
   - Include architecture diagrams for simulator flow, VS Code integration, and MIPS/RISC-V abstraction.
   - Include an AI assistance disclosure if AI was used for coding, writing, diagrams, or editing.

5. Prepare presentation path.
   - Pick one near-term undergraduate research venue.
   - Draft a 150-250 word abstract.
   - Draft a 5-8 minute project talk outline.

## Clean Implementation Path

1. Stabilize extension core.
   - Run `npm run compile`.
   - Smoke test MIPS and RISC-V sample programs.
   - Confirm diagnostics on invalid assembly.
   - Confirm native Tree Views update after assemble, step, run, memory edits, and register edits.

2. Add project examples.
   - `examples/mips/hello.asm`
   - `examples/mips/bitmap.asm`
   - `examples/riscv/hello.riscv`
   - `examples/riscv/loop.riscv`
   - One intentionally invalid file for diagnostics testing.

3. Prepare Codevium integration.
   - Add a Codevium assembly workspace template.
   - Preconfigure extension, language associations, and starter files.
   - Route legacy app to `/classic`.
   - Add screenshots once the embedded workflow is stable.

4. Paper draft structure.
   - Title: Native Assembly Development for Education with WIMPS in VS Code
   - Abstract
   - Introduction and motivation
   - Background: WIMPS, MIPS education, RISC-V education, VS Code workflows
   - System design
   - Implementation
   - Student workflow / usability goals
   - Current limitations
   - Future work
   - AI assistance disclosure
   - References

5. Presentation prep.
   - One-slide motivation
   - One-slide system architecture
   - One-slide demo workflow
   - One-slide MIPS and RISC-V support
   - One-slide evaluation/future work

## Conference / Presentation Targets

### Best Near-Term Targets

1. SCCUR 2026 at SDSU
   - Conference: Southern California Conference for Undergraduate Research 2026
   - Location: San Diego State University
   - Date: November 21, 2026
   - Final abstract deadline: October 9, 2026
   - Early abstract window: through July 31, 2026
   - Fit: strongest near-term local target because it is hosted at SDSU and accepts undergraduate research.
   - Source: https://research.sdsu.edu/sccur-2026

2. SDSU Student Symposium 2027
   - Location: SDSU
   - Date: February 26, 2027
   - Registration opens: Fall 2026
   - Fit: best SDSU-branded internal presentation venue.
   - Source: https://research.sdsu.edu/s3

3. SIGCSE TS 2027 Student Research Competition / Posters
   - Location: Sacramento, California
   - Date: February 17-20, 2027
   - Round two deadline: September 30, 2026
   - Fit: strong if the paper emphasizes computing education and assembly-learning workflows.
   - Source: https://2027.sigcse-ts.acm.org/

### Also Worth Watching

4. UC San Diego Summer Research Conference
   - Location: UC San Diego
   - 2026 date: August 12-13, 2026
   - 2026 student registration deadline: July 10, 2026
   - Fit: local undergraduate research venue, but 2026 student deadline has likely passed.
   - Source: https://ugresearch.ucsd.edu/conferences/src/index.html

5. Computer Science Conference for CSU Undergraduates
   - 2026 event: virtual, April 25, 2026
   - Fit: very relevant because it is CSU undergraduate CS-specific.
   - Action: watch for the 2027 call.
   - Source: https://cscsu-conference.github.io/

## Working Abstract Seed

WIMPS is an educational assembly programming environment originally designed for browser-based MIPS simulation. This project rebuilds WIMPS as a native VS Code extension and Codevium workspace for assembly language development, adding RISC-V support through the RARS-derived `@specy/risc-v` simulator package. The extension integrates assembly, execution, debugging, diagnostics, register and memory inspection, bitmap visualization, instruction analysis, symbol lookup, and cache analysis into standard VS Code workflows. The goal is to reduce tool friction for students learning low-level programming while preserving simulator transparency for instructors and researchers.

## Immediate Checklist

- [ ] Create representative MIPS examples.
- [ ] Create representative RISC-V examples.
- [ ] Smoke test extension in a real VS Code Extension Host.
- [ ] Capture screenshots for paper.
- [ ] Draw architecture diagram.
- [ ] Draft LaTeX paper skeleton.
- [ ] Add AI disclosure section.
- [ ] Decide Codevium route and `/classic` migration strategy.
- [ ] Draft SCCUR abstract.
- [ ] Ask professor whether to target SCCUR 2026, SDSU S3 2027, SIGCSE TS 2027, or all three.
