# The terminal half of the README demo (docs/DOCS-SITE.md §3.2), recorded by demo.sh with VHS.
# A scripted, deterministic run: AA_DEMO_MODEL=scripted replays the coffee-roaster planner (no LLM).
Output "demo-terminal.mp4"

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 680
Set Padding 20
Set Theme "Builtin Solarized Dark"
Set TypingSpeed 35ms

Hide
Type "export PS1='$ ' AA_DEMO_MODEL=scripted AA_JOBS_DIR=/tmp/aa-demo/jobs PATH=/tmp/aa-demo/bin:$PATH && cd $AA_DEMO_ROOT && clear"
Enter
Show

Type "aa analyze examples/coffee-roaster --yes --currency USD --today 2026-07-01 --embedder hash --open"
Sleep 400ms
Enter
Sleep 9s
