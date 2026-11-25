import { describe, expect, it } from "vitest";
import { render } from "../../testing/render";
import { ReadOnlyGate, ReadOnlyProvider, useReadOnly } from "./ReadOnlyGate";

function Probe() {
  return <span>{useReadOnly() ? "read-only" : "writable"}</span>;
}

describe("ReadOnlyGate", () => {
  it("defaults to writable without a provider", () => {
    const { container } = render(
      <>
        <Probe />
        <ReadOnlyGate>
          <button type="button">Save</button>
        </ReadOnlyGate>
      </>
    );
    expect(container.textContent).toContain("writable");
    expect(container.querySelector(".read-only-gate")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
  });

  it("leaves the action area untouched when the server is writable", () => {
    const { container } = render(
      <ReadOnlyProvider value={false}>
        <ReadOnlyGate>
          <button type="button">Save</button>
        </ReadOnlyGate>
      </ReadOnlyProvider>
    );
    expect(container.querySelector(".read-only-gate")).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();
  });

  it("disables the action area and explains why when read-only", () => {
    const { container } = render(
      <ReadOnlyProvider value={true}>
        <ReadOnlyGate className="actions">
          <button type="button">Save</button>
          <input aria-label="name" />
        </ReadOnlyGate>
      </ReadOnlyProvider>
    );
    const gate = container.querySelector<HTMLDivElement>(".read-only-gate.actions");
    expect(gate?.title).toContain("SPARKDASH_MODE_READONLY");
    expect(container.querySelector(".read-only-badge")?.textContent).toContain("Read-only");
    expect(container.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("button")?.matches(":disabled")).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input")?.matches(":disabled")).toBe(true);
  });
});
