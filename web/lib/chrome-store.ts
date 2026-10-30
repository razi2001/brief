// Brief Cloud on the Chrome Web Store. NOT the older standalone "Brief"
// extension (dbceddg…), which does not pair with this app - sending people
// there left them with an extension that could never connect.
export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/heekinkibhgbilagcdnmcjajijaalpcc";

/** Its id, to pair it from the page. An unpacked dev build has its own. */
export const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || "heekinkibhgbilagcdnmcjajijaalpcc";
