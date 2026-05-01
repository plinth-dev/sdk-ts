import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "../server/types.js";
import { useFormContext } from "./context.js";
import { FormField } from "./FormField.js";
import {
  type ActionFn,
  buildActionHandler,
  FormWrapper,
} from "./FormWrapper.js";

// React 19's `<form action={fn}>` machinery doesn't drive cleanly through
// happy-dom's submit-event path (happy-dom navigates instead of letting
// React's delegated listener intercept). The submission-flow logic is
// extracted into `buildActionHandler` and tested directly; the React
// component's job is rendering + context wiring, which is tested via
// render() against a controlled FormContext.

// ── buildActionHandler ───────────────────────────────────────────────

describe("buildActionHandler — toast hooks", () => {
  it("calls toast.onSuccess with the message on success", async () => {
    const onSuccess = vi.fn();
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
      message: "Saved.",
    }));

    const handler = buildActionHandler(action, { toast: { onSuccess } });
    await handler(null, new FormData());

    expect(onSuccess).toHaveBeenCalledWith("Saved.");
  });

  it("does not call toast.onSuccess when no message is set", async () => {
    const onSuccess = vi.fn();
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
    }));

    const handler = buildActionHandler(action, { toast: { onSuccess } });
    await handler(null, new FormData());

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls toast.onError with the error string on failure", async () => {
    const onError = vi.fn();
    const action: ActionFn<string> = vi.fn(async () => ({
      success: false,
      error: "DB blew up",
    }));

    const handler = buildActionHandler(action, { toast: { onError } });
    await handler(null, new FormData());

    expect(onError).toHaveBeenCalledWith("DB blew up");
  });

  it("toast=false suppresses both callbacks", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
      message: "Saved.",
    }));

    const handler = buildActionHandler(action, { toast: false });
    await handler(null, new FormData());

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("buildActionHandler — onSettled", () => {
  it("fires once per submission with the result on success", async () => {
    const onSettled = vi.fn();
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
    }));

    const handler = buildActionHandler(action, { onSettled });
    await handler(null, new FormData());

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({ success: true, data: "ok" });
  });

  it("fires once per submission with the failure result", async () => {
    const onSettled = vi.fn();
    const action: ActionFn<string> = vi.fn(async () => ({
      success: false,
      error: "boom",
    }));

    const handler = buildActionHandler(action, { onSettled });
    await handler(null, new FormData());

    expect(onSettled).toHaveBeenCalledWith({ success: false, error: "boom" });
  });
});

describe("buildActionHandler — action invocation", () => {
  it("forwards the FormData and prev result to the action", async () => {
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
    }));

    const handler = buildActionHandler(action, {});
    const fd = new FormData();
    fd.set("title", "hello");
    const prev: ActionResult<string> = { success: true, data: "previous" };
    await handler(prev, fd);

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(fd, prev);
  });

  it("returns the action's result unchanged", async () => {
    const result: ActionResult<string> = {
      success: true,
      data: "ok",
      message: "Saved.",
    };
    const action: ActionFn<string> = vi.fn(async () => result);

    const handler = buildActionHandler(action, {});
    const r = await handler(null, new FormData());
    expect(r).toBe(result);
  });
});

// ── FormWrapper component (render-side) ─────────────────────────────

function ResultProbe() {
  const ctx = useFormContext();
  return (
    <span data-testid="result">
      {ctx.result ? (ctx.result.success ? "ok" : "err") : "null"}
    </span>
  );
}

function PendingProbe() {
  const ctx = useFormContext();
  return <span data-testid="pending">{ctx.isPending ? "yes" : "no"}</span>;
}

describe("FormWrapper — render", () => {
  it("renders a <form> with the given className", () => {
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
    }));
    const { container } = render(
      <FormWrapper action={action} className="space-y-4">
        <button type="submit">Save</button>
      </FormWrapper>,
    );
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    expect(form?.className).toBe("space-y-4");
  });

  it("renders children inside a FormContext provider with initial null result", () => {
    const action: ActionFn<string> = vi.fn(async () => ({
      success: true,
      data: "ok",
    }));

    render(
      <FormWrapper action={action}>
        <ResultProbe />
        <PendingProbe />
        <FormField type="text" name="x" label="X" />
      </FormWrapper>,
    );

    expect(screen.getByTestId("result").textContent).toBe("null");
    expect(screen.getByTestId("pending").textContent).toBe("no");
    expect(screen.getByLabelText("X")).toBeTruthy();
  });
});
