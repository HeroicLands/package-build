/*
 * This package's own formatting, taken from the configuration it publishes.
 *
 * It used to restate every option — the same twelve values plus the markdown
 * override — with a comment saying they were "matched to" the Song of Heroic
 * Lands repository. That was already the wrong authority by the time
 * `PRETTIER_BASE` existed here, and a restated copy is a copy: raising
 * `printWidth` to 100 changed the exported value and left this file formatting
 * this repository at 80, so the package that defines the shared style was the
 * one repository not written in it.
 *
 * Re-exported rather than spread, so there is nothing here to drift.
 */
export { PRETTIER_CONFIG as default } from "./engine/prose-config.mjs";
