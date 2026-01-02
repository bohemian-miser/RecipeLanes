# Issue 69: Pivot Interaction Fix

## Problem
The user reported that the "Tap and Hold to Pivot" gesture on mobile works "sometimes but only as a glitch".
This was identified as a race condition:
If the user starts dragging *slightly* before the 300ms timer fires, the system enters "Standard Drag" mode (React Flow default).
However, if the timer subsequently fires *during* the drag (because it wasn't cancelled), the UI (blue outline) switches to "Pivot Mode" visual, confusing the user, while the behavior remains "Standard Drag".

## Fix
I modified `MinimalNode.tsx` to include `handleTouchMove`.
This handler tracks the touch start position. If the user moves their finger more than 10 pixels *before* the 300ms timer fires, the timer is explicitly cancelled.
This ensures that "lazy drags" (slow start) are treated decisively as standard drags, and the Pivot mode is only activated if the user holds relatively still for the full duration.

## Verification
This fix relies on Touch Events (`onTouchStart`, `onTouchMove`, `onTouchEnd`) which are difficult to simulate reliably in Playwright's current desktop-based mobile emulation without Chrome DevTools Protocol (CDP).
The created reproduction test `e2e/issue-69-pivot.spec.ts` failed to trigger the touch events (simulating mouse move instead).

Manual verification is recommended on a mobile device or responsive mode:
1. Tap and hold a node for >300ms until blue outline appears. Then drag. -> Should Pivot (move branch).
2. Tap and immediately drag (within <300ms). -> Should Move Node (standard).
3. Tap, wiggle finger slightly (jitter <10px), hold for 300ms. -> Should Pivot.
4. Tap, move finger >10px immediately. -> Should Move Node.
