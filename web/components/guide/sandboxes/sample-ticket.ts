/**
 * The demo ticket the Guide's editor sandbox plays with: paragraphs, each with
 * its rewrites written in advance. The sandbox never calls a model, never saves.
 */
export const DEMO_PARAGRAPHS: Array<{ text: string; improve: string; shorten: string }> = [
  {
    text: "Clicking Pay on checkout does nothing and the order is never placed. There is no error message, so people think they paid.",
    improve: "Paying at checkout fails without a message: the order is not placed, and nothing tells the shopper.",
    shorten: "Pay fails silently: no order, no error.",
  },
  {
    text: "It happened every time I tried, on two different carts, and also after I logged out and logged back in again to check if that was it.",
    improve: "It happens every time, on any cart, signed in or not.",
    shorten: "Always happens, on any cart.",
  },
  {
    text: "The payment request comes back with a 500 error that says payment service timeout, but the page ignores it.",
    improve: "The payment call returns 500 (payment service timeout), and the page ignores the error.",
    shorten: "Payment call: 500, ignored by the page.",
  },
];
