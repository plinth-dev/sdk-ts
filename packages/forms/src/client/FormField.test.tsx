import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormContext, type FormContextValue } from "./context.js";
import { FormField } from "./FormField.js";

function withCtx(ctx: Partial<FormContextValue>, ui: React.ReactNode) {
  const value: FormContextValue = {
    errors: ctx.errors ?? {},
    isPending: ctx.isPending ?? false,
    result: ctx.result ?? null,
  };
  return <FormContext.Provider value={value}>{ui}</FormContext.Provider>;
}

describe("FormField — basic rendering", () => {
  it("renders a text input with a label and the matching htmlFor/id", () => {
    render(withCtx({}, <FormField type="text" name="title" label="Title" />));

    const input = screen.getByLabelText("Title") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.name).toBe("title");
    expect(input.id).toBe("field-title");
  });

  it("marks required fields with an asterisk and the required attribute", () => {
    render(withCtx({}, <FormField type="text" name="x" label="X" required />));

    const input = screen.getByLabelText(/X/) as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(
      input.parentElement?.querySelector("[aria-hidden='true']")?.textContent,
    ).toBe("*");
  });

  it("renders a description with a stable id and links it via aria-describedby", () => {
    render(
      withCtx(
        {},
        <FormField type="text" name="x" label="X" description="Helper text" />,
      ),
    );

    const desc = screen.getByText("Helper text");
    expect(desc.id).toBe("field-x-desc");
    const input = screen.getByLabelText("X") as HTMLInputElement;
    expect(input.getAttribute("aria-describedby")).toContain("field-x-desc");
  });

  it("hidden inputs render without a label or wrapper div", () => {
    const { container } = render(
      withCtx({}, <FormField type="hidden" name="csrf" defaultValue="abc" />),
    );

    const input = container.querySelector(
      "input[type='hidden']",
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.name).toBe("csrf");
    expect(input.value).toBe("abc");
    expect(container.querySelector("label")).toBeNull();
  });
});

describe("FormField — input type variants", () => {
  it("renders a textarea for type='textarea'", () => {
    render(withCtx({}, <FormField type="textarea" name="bio" label="Bio" />));
    const ta = screen.getByLabelText("Bio");
    expect(ta.tagName).toBe("TEXTAREA");
  });

  it("renders a select with options", () => {
    render(
      withCtx(
        {},
        <FormField
          type="select"
          name="role"
          label="Role"
          options={[
            { value: "admin", label: "Admin" },
            { value: "viewer", label: "Viewer" },
          ]}
        />,
      ),
    );

    const select = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.options.length).toBe(2);
    expect(select.options[0].value).toBe("admin");
    expect(select.options[0].textContent).toBe("Admin");
    expect(select.options[1].value).toBe("viewer");
    expect(select.options[1].textContent).toBe("Viewer");
  });

  it("renders a checkbox", () => {
    render(
      withCtx(
        {},
        <FormField
          type="checkbox"
          name="agree"
          label="Agree"
          defaultValue={true}
        />,
      ),
    );
    const input = screen.getByLabelText("Agree") as HTMLInputElement;
    expect(input.type).toBe("checkbox");
    expect(input.defaultChecked).toBe(true);
  });

  it("renders a switch as a checkbox with role='switch'", () => {
    render(
      withCtx({}, <FormField type="switch" name="notify" label="Notify" />),
    );
    const input = screen.getByLabelText("Notify") as HTMLInputElement;
    expect(input.type).toBe("checkbox");
    expect(input.getAttribute("role")).toBe("switch");
  });

  it("forwards email/number/password/url/tel/date types directly", () => {
    const types = [
      "email",
      "number",
      "password",
      "url",
      "tel",
      "date",
    ] as const;
    for (const t of types) {
      const { unmount } = render(
        withCtx({}, <FormField type={t} name={`x_${t}`} label={t} />),
      );
      const input = screen.getByLabelText(t) as HTMLInputElement;
      expect(input.type).toBe(t);
      unmount();
    }
  });
});

describe("FormField — error state", () => {
  it("renders error messages from context for a matching field", () => {
    render(
      withCtx(
        { errors: { email: ["Required", "Must be an email"] } },
        <FormField type="email" name="email" label="Email" />,
      ),
    );

    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByText("Must be an email")).toBeTruthy();
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(
      "field-email-error",
    );
  });

  it("does not render the error list when there are no errors", () => {
    const { container } = render(
      withCtx({ errors: {} }, <FormField type="text" name="x" label="X" />),
    );
    expect(container.querySelector("[role='alert']")).toBeNull();
    const input = screen.getByLabelText("X") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("only shows errors for the matching field name", () => {
    render(
      withCtx(
        { errors: { other: ["nope"] } },
        <FormField type="text" name="x" label="X" />,
      ),
    );
    expect(screen.queryByText("nope")).toBeNull();
  });
});

describe("FormField — defaultValue normalisation", () => {
  it("number defaults are stringified", () => {
    render(
      withCtx(
        {},
        <FormField type="number" name="n" label="N" defaultValue={42} />,
      ),
    );
    const input = screen.getByLabelText("N") as HTMLInputElement;
    expect(input.defaultValue).toBe("42");
  });

  it("textarea string defaults are passed through", () => {
    render(
      withCtx(
        {},
        <FormField type="textarea" name="t" label="T" defaultValue="hello" />,
      ),
    );
    const ta = screen.getByLabelText("T") as HTMLTextAreaElement;
    expect(ta.defaultValue).toBe("hello");
  });
});

describe("FormField — context fallback", () => {
  it("returns empty errors when used outside a provider in production", () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { container } = render(
        <FormField type="text" name="x" label="X" />,
      );
      expect(container.querySelector("[role='alert']")).toBeNull();
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it("throws outside a provider in development", () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(<FormField type="text" name="x" label="X" />),
      ).toThrow(/useFormContext called outside/);
    } finally {
      process.env.NODE_ENV = orig;
      errSpy.mockRestore();
    }
  });
});
