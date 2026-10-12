# Meshy → Native Three.js Football Character System

This folder contains the handoff documentation for building a procedural football player renderer using Meshy GLBs as measured references.

## Read in this order
1. [Architecture](01_ARCHITECTURE.md): full system design, body, face, equipment, runtime data, performance.
2. [Implementation roadmap](02_IMPLEMENTATION_ROADMAP.md): phases, deliverables, acceptance gates.
3. [Claude Code handoff](03_CLAUDE_CODE_HANDOFF.md): immediate instructions for inspecting existing project and Meshy assets.

## Central idea
**Use Meshy to establish what the character looks like; use Three.js to create lightweight, repeatable, procedural variants.** Retain the *exact* imported GLB for unique equipment when approximating it hurts fidelity.

Start with medium T-pose GLB analysis. Do not build full procedural generation or replace existing game rendering until the side-by-side medium-character comparison passes visual review.
