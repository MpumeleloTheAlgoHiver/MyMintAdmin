# Admin Preview Mode — Mint App Changes

## What this does
When an admin opens a client's profile from the CRM (via "Open as [Name] in Mint"), the CRM generates a magic link that includes `?admin_preview=1` in the URL AND sends a `postMessage` into the iframe after it loads. The changes below make the Mint app detect both signals and disable all transactional buttons — invest, gift, save goal, edit goal, add/delete child, refund, cancel — while keeping the full app navigable and viewable.

> **Why two signals?** The `?admin_preview=1` URL param is the primary signal, but Supabase's client-side auth processing calls `router.replace()` to clean the hash/token from the URL, which strips query params BEFORE `useEffect` has a chance to read them. The CRM's `phone-preview.html` also sends a `postMessage({ type: 'MINT_ADMIN_PREVIEW' })` into the iframe every 2 seconds for 30 seconds as a reliable backup. The Mint app must listen for this message (see step 2 below) so admin preview mode activates even when the URL param is lost during auth.

---

## TASK FOR REPLIT AGENT

Apply the following changes to this codebase. Read each file listed, make only the changes described, and do not alter anything else.

---

## 1. CREATE this new file

**File path:** `lib/adminPreview.ts`  
(If your project uses `.js` files instead of `.ts`, save it as `lib/adminPreview.js` and remove the type annotations)

```ts
/**
 * Admin Preview Mode
 *
 * When the Mint CRM opens a client session via impersonation it signals this
 * app in two ways:
 *   1. Appends ?admin_preview=1 to the magic link redirect URL.
 *   2. Sends postMessage({ type: 'MINT_ADMIN_PREVIEW' }) into the iframe
 *      every 2 s for 30 s (because Supabase's router.replace() strips query
 *      params before useEffect can read them).
 *
 * initAdminPreview()            — call once on app load. Checks URL param and
 *                                 saves the flag to localStorage.
 * listenForAdminPreviewMessage() — call once on app load. Listens for the
 *                                  postMessage signal from the CRM iframe
 *                                  wrapper. Returns a cleanup function.
 * isAdminPreview()              — call in any component to check the flag.
 * clearAdminPreview()           — call on sign-out to reset the flag.
 */

export function initAdminPreview(): void {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(window.location.search).has('admin_preview')) {
    localStorage.setItem('mint_admin_preview', '1');
  }
}

export function listenForAdminPreviewMessage(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'MINT_ADMIN_PREVIEW') {
      localStorage.setItem('mint_admin_preview', '1');
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export function isAdminPreview(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('mint_admin_preview') === '1';
}

export function clearAdminPreview(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mint_admin_preview');
  }
}
```

---

## 2. EDIT the root layout or `_app` file

**File to find:** `app/layout.tsx` OR `pages/_app.tsx` — whichever exists in this project.

**Add this near the top of the file (with other imports):**
```ts
import { initAdminPreview, listenForAdminPreviewMessage } from '@/lib/adminPreview';
```

**Add this inside the root component (inside a `useEffect` that runs once):**
```ts
useEffect(() => {
  initAdminPreview();                       // catches ?admin_preview=1 in the URL
  const cleanup = listenForAdminPreviewMessage(); // catches postMessage from CRM iframe
  return cleanup;
}, []);
```

If there is already a `useEffect` that runs on mount (empty dependency array `[]`), add both calls inside that existing one and return `cleanup` from it instead of creating a duplicate.

> **Why both?** `initAdminPreview()` catches the flag if it survives in the URL (fast path). `listenForAdminPreviewMessage()` catches it via `postMessage` from the CRM's phone-preview wrapper (reliable path — the CRM sends this every 2 s for 30 s so it always arrives after auth settles).

---

## 3. EDIT the sign-out / logout function

**File to find:** Search the codebase for `signOut` or `logout` — find the function that signs the user out of Supabase (likely calls `supabase.auth.signOut()`).

**Add this import at the top of that file:**
```ts
import { clearAdminPreview } from '@/lib/adminPreview';
```

**Add this line immediately before or after the signOut call:**
```ts
clearAdminPreview();
```

---

## 4. DISABLE the invest / purchase button

**File to find:** Search the codebase for the component that renders the "Choose a method" modal or the invest/purchase confirmation flow. Look for text like `"Choose a method"`, `"Invest"`, `"Purchase"`, or `"Buy"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add this inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On every button that submits/confirms an investment or method selection, add:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**If the options are rendered as a list/cards (e.g. EFT, Card, Wallet), wrap them like this:**
```tsx
<div className={readOnly ? 'opacity-40 pointer-events-none select-none' : ''}>
  {/* existing method options here */}
</div>
```

---

## 5. DISABLE the gift invest button

**File to find:** Search for the gift screen component — look for text like `"Send a gift"`, `"Gift"`, or `"Invest as gift"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the gift invest/send button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

---

## 6. DISABLE save/edit goal buttons

**File to find:** Search for the goal creation and goal editing components — look for `"Save goal"`, `"Create goal"`, `"Update goal"`, or `"Edit goal"` in JSX files.

**Add this import to each file:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside each component:**
```ts
const readOnly = isAdminPreview();
```

**On the Save / Update / Create Goal button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**On goal input fields (to make them uneditable):**
```tsx
readOnly={readOnly}
className={readOnly ? 'pointer-events-none opacity-60' : ''}
```

---

## 7. DISABLE add child and delete child buttons

**File to find:** Search for the child account component — look for `"Add child"`, `"Create child"`, `"Minor"`, or `"Delete child"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the Add Child button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**On the Delete / Remove Child button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

---

## 8. DISABLE the "Invest Now" button inside child accounts

> **This is a separate component from the main invest flow (section 4).** Child accounts have their own invest/purchase button that renders inside the child profile or child strategy view. It must be disabled independently.

**File to find:** Search the codebase for the child account investment component — look for text like `"Invest Now"`, `"Invest for"`, `"Invest in"`, `"child"` combined with `"invest"` or `"purchase"` in JSX/TSX files. This is often a page like `children/[id]/invest`, `child-invest`, or a modal named something like `ChildInvestModal`, `InvestForChild`, or `ChildPurchase`.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the "Invest Now" / "Purchase" / "Confirm" button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**If the invest options or strategy cards are clickable (to open the invest flow), wrap their container:**
```tsx
<div className={readOnly ? 'opacity-40 pointer-events-none select-none' : ''}>
  {/* child invest option cards / strategy picker */}
</div>
```

**Also block any "Choose a method" step if it has its own child-specific modal:**
```tsx
disabled={readOnly}
onClick={readOnly ? undefined : handleInvest}
```

---

## 9. DISABLE refund and cancel buttons

**File to find:** Search for transaction detail or order management components — look for `"Refund"`, `"Cancel order"`, or `"Cancel investment"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the Refund button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**On the Cancel button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

---

## Summary of all files to change

| # | Action | File |
|---|---|---|
| 1 | Create new file | `lib/adminPreview.ts` |
| 2 | Call `initAdminPreview()` + `listenForAdminPreviewMessage()` on app load | `app/layout.tsx` or `pages/_app.tsx` |
| 3 | Call `clearAdminPreview()` on sign-out | Wherever `supabase.auth.signOut()` is called |
| 4 | Disable main invest/purchase buttons | Component with "Choose a method" / invest flow |
| 5 | Disable gift invest button | Gift screen component |
| 6 | Disable save/edit goal buttons | Goal creation + goal editing components |
| 7 | Disable add/delete child buttons | Child account management component |
| **8** | **Disable "Invest Now" inside child accounts** | **Child invest page/modal — separate from #4** |
| 9 | Disable refund/cancel buttons | Transaction detail / order component |

---

## How to verify it worked

1. Open the Mint CRM admin portal
2. Go to Studio, open any client with "Open as [Name] in Mint"
3. In the phone preview, navigate to the invest tab — the "Choose a method" options should be grayed out and unclickable
4. Navigate to goals — Save/Edit buttons should be grayed out
5. Navigate to gifting — the invest/send button should be grayed out
6. Navigate to child accounts — Add and Delete buttons should be grayed out
7. Scrolling, tab switching, viewing factsheets, PDFs, transaction history — all should work normally
