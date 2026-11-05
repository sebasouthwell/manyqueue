import { useLocation } from "react-router-dom";

/** A plain footer at the very bottom of every page. It sits after the page's
 * content, so it's below the fold (and under the phone's tab bar) until you
 * scroll down to it. Not on the TV, which is a fixed stage that never scrolls. */
export function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/tv")) return null;

  // Phone pages end under a fixed tab bar; leave room so the footer clears it.
  const bottomPad = pathname.startsWith("/r/") ? 84 : 20;

  return (
    <footer
      className="px-4 pt-6 text-center text-[11px] tracking-wide text-accent-300"
      style={{ paddingBottom: bottomPad }}
    >
      A Sebasouthwell Innovation
    </footer>
  );
}
