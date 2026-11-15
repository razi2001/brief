// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SCENES } from "./index";

describe("every frame of every scene draws, with its cursor target", () => {
  for (const [key, def] of Object.entries(SCENES)) {
    it(key, () => {
      def.frames.forEach((f, i) => {
        const { container, unmount } = render(<def.View s={f.s} />);
        if (f.target) expect(container.querySelector(`[data-gd="${f.target.split(":")[0]}"]`), `${key} #${i} ${f.target}`).not.toBeNull();
        unmount();
      });
    });
  }
});
