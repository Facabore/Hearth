# Hearth documentation

This folder is Hearth's wiki. It is versioned with the code and reviewed in pull requests, so the docs and the system change together. It is also published as a site: https://facabore.github.io/Hearth/.

## What each folder holds

- **`product/`** is the functional overview: how each feature behaves, written so the owner can confirm it matches expectations.
- **`architecture/`** explains how the system works: the [overview](architecture/README.md) (deployment, request lifecycle, modules, dependency rules) and the [data model](architecture/data-model.md) (every table, column and foreign key).
- **`decisions/`** is the single [decisions index](decisions/README.md): the design decisions D1 to D23, the ADRs and every ruling P1 to P255, with where each one is recorded.
- **`adr/`** holds the architecture decision records, one file per technology choice.
- **`backlog/`** is the source of truth for the content of the epics and user stories. Status lives in the GitHub Project.
- **`operations/`** holds the guides for running Hearth, [deploying to a VPS](operations/deploy.md) and [backups and restore](operations/backups.md).
- **`specs/`** holds the design spec, the living document every decision refers back to.
- **`plans/`** holds one implementation plan per milestone, with the rulings made while planning and running it.
- **`stack-versions.md`** lists the pinned versions of the stack.

## Start here

If you are new, read in this order:

1. [Functional overview](product/functional-overview.md): what Hearth does and for whom.
2. [Architecture](architecture/README.md): how it is deployed and how the code is organised.
3. [Data model](architecture/data-model.md): the database, table by table.
4. [Decisions index](decisions/README.md): what was decided, and where to read the reasoning.
5. [Backlog](backlog/README.md): the epics and stories, and how to read them.

## Keeping these docs current

- A milestone's pull request updates the [decisions index](decisions/README.md) with its new rulings.
- A migration that changes tables updates [`architecture/data-model.md`](architecture/data-model.md) in the same pull request.
- A new technology choice gets an ADR in `adr/`, and a new design decision goes into the spec's decisions table; both are added to the decisions index.
- Links to anything outside `docs/` use an absolute GitHub URL (`https://github.com/Facabore/Hearth/blob/development/<path>`), because the published site serves only this folder.
