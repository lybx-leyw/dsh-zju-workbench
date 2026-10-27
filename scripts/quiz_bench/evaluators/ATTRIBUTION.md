# Third-party evaluator source

BenchMarker: <https://github.com/nbalepur/BenchMarker>

- Paper: *BenchMarker: An Education-Inspired Toolkit for Highlighting Flaws in Multiple-Choice Benchmarks*, ACL 2026, <https://aclanthology.org/2026.acl-long.719/>.
- Commit: `bcd34a531e7c15c6416732ff465f99129783cc6f`.
- License: MIT; full copyright and permission notice retained in `vendor/benchmarker/LICENSE`.
- Copied subset: the writing-flaw and shortcut scorers, both original prompt modules, empty package initializers, original README and original dependency metadata. The exact list, SHA-256 and upstream Git blob IDs are in `vendor.lock.json`.
- Permission basis: MIT permits copying and redistribution with the copyright and permission notice preserved. The selected upstream files are byte-identical, including examples and default judge mappings.
- Local code: `benchmarker.py` supplies our input bridge, explicit judge selection, provenance, request logging and accounting, and a fail-closed interpretation of exhausted upstream output parsing. It invokes the original Python scorer functions; it does not translate/rewrite their prompts or replace their semantic scoring logic.
- The unused upstream full CLI, contamination/web-search pipeline, IRT models, dataset files, and rewriting pipeline are not distributed in this subset. Only the pinned Inspect AI dependency needed by these entry points is installed in a separate environment.

QGEval (`9ba901b69043e6ddf874ce8802352f9ac0d368d3`) and SAQUET (`7a6d8e484bfe6a877b02ab3d4cfb848dedc4bd8c`) were checked for licensing. Neither has a root license covering its own evaluator implementation at those commits. QGEval's nested third-party licenses do not license its own code. No implementation or rubric from either project is copied here.
