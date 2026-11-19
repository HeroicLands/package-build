# Consumer compile proof

The **Consumer proof** workflow runs on explicit dispatch. Supply the full
package-build commit SHA as `candidate_sha` and dispatch the branch containing
that commit. The job packs that commit for a compatibility compile of the pinned
Kethira consumer, checking the installed package and its compiled outputs. It
fails if installing the candidate changes unrelated locked dependencies. The
workflow requires registry and consumer dependency access; it does not publish a
package or site.
