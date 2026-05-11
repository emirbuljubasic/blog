# Architecture as Mitigation

Two local privilege escalation bugs in the Linux kernel landed recently:
**CopyFail** (CVE-2026-31431) and **DirtyFrag** (CVE-2026-43284,
CVE-2026-43500). Both got the usual treatment: disclosure write-ups,
proof-of-concepts, patches, and the customary scramble to roll updates
through fleets.

We were not vulnerable. Not because we patched first, but because four
independent properties of the platform's design, none of them added as
a response to these specific bugs, each individually prevent the
exploit chain from completing.

## The bugs, briefly

Both exploits are LPE (Local Privilege Escalation). An attacker who already
has shell access as an unprivileged user uses them to become root.
Both achieve this by corrupting the kernel's page cache, specifically 
by writing into the cached pages of a setuid-root binary like `/usr/bin/su`.
Once the cache is dirty, executing the binary runs the attacker's code with root's
privileges.

The two bugs use different primitives to reach the same end. CopyFail
exploits the AF_ALG cryptographic socket family (`algif_aead`) to
perform controlled writes into the page cache. DirtyFrag abuses the
kernel's IPsec ESP path (`esp4`, `esp6`), plus `rxrpc` on some
distributions, to do the same.

The interesting part is not the primitive. The interesting part is
everything an attacker needs to be true *simultaneously* for either
exploit to land:

1. The vulnerable kernel module is loadable.
2. The system contains a setuid-root binary that is also world-readable.
3. The targeted file's cache is reachable through the standard kernel page cache.
4. An unprivileged local user exists from which to launch the attack.

Remove any one and the exploit dies before it starts. SERVERware happens
to remove all four.

## Four independent defenses

### 1. The kernel doesn't carry what it doesn't need

The platform ships with a custom-built kernel rather than a generic
distribution kernel. Modules that have no role in our workloads aren't
compiled in, and the ones we keep available are loaded on demand rather
than autoloaded broadly.

For CopyFail, `algif_aead` is present in the build but is not loaded and
requires root to load. The exploit requires the module; the module
requires root; the exploit requires not being root. The chain doesn't
close.

DirtyFrag is more interesting. `esp4` and `esp6` are autoloaded by the
kernel when the right socket-family request arrives; an unprivileged
user can trigger that load. So this layer alone wouldn't stop DirtyFrag.
It narrows the attack surface but doesn't eliminate it.

### 2. The filesystem has no exploitable target

Both exploits need a binary that is **(a)** executable, **(b)** has the
setuid bit set, and **(c)** is world-readable. The page-cache write only
matters if executing the resulting file gains privilege (that's the
setuid bit), and the attack has to read the binary in order to dirty
its cache pages.

A standard Gentoo filesystem doesn't expose such a binary. `su`,
`passwd`, `mount`, and the rest are setuid-root, but their permissions
strip read access from *other*. Without a file that satisfies all three
conditions at once, there is no target.

### 3. ZFS won't honor a write it didn't originate

The storage backend is OpenZFS. ZFS keeps its primary cache outside the
kernel page cache, in its own Adaptive Replacement Cache (ARC). Ordinary
reads and writes are served from ARC.

The honest caveat is that exec uses mmap, and Linux mmap is fundamentally
page-cache-backed; when a ZFS-stored binary is executed, the kernel does
populate the page cache with copies of ARC content. So in principle a
page-cache poisoning primitive could land there. Empirically it doesn't.
Loading `algif_aead` manually and granting world-read on `/usr/bin/su`
is enough to let CopyFail run end to end, but `su` then executes
normally and asks for a password as if nothing happened. The same shape
holds for DirtyFrag against `/etc/passwd`. The exploit "succeeds" at the
kernel level; the file the kernel reads back is unchanged.

A ZFS DMU trace shows what's happening underneath: a transaction opens
in response to the dirty page, no `dmu_write` is ever issued, and the
transaction commits empty. The dirty page-cache page has no DMU object
backing it because it wasn't produced by ZFS's own write path. ARC
retains the clean content; the next read comes from ARC, and exec sees
the original binary. The integrity of the file is anchored where ZFS
controls it, not where the exploit can reach.

### 4. There is no unprivileged user to launch from

LPE assumes an unprivileged local account. The platform doesn't expose
one. A single administrative identity (`swadmin`) is the only user, and
it already has the privileges these bugs are trying to escalate to.
There is no lower rung from which to climb.

## Why this matters

Any one of those four properties stops both exploits. None of them was
introduced as a response to CopyFail or DirtyFrag. Each was chosen for
an unrelated reason (a smaller attack surface, conservative defaults,
a better filesystem, a single-tenant operational model), and each
turned out to also be the answer to a class of bugs that didn't yet
have names.

Patches are necessary but reactive. Each resolves a specific CVE and
leaves the surrounding shape of the system unchanged. Architecture is
the opposite: a small number of decisions, made once, that quietly
invalidate entire categories of attack the next time they appear.

The cost of an exploit chain is the conjunction of the conditions it
requires. The job of an architect is to make sure those conditions are
never simultaneously true on the system being designed. When that work
is done well, the next advisory is something you read about, not
something you respond to.

---

Built like this on purpose: [SERVERware](https://bicomsystems.com/serverware).
